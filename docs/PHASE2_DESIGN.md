# Phase 2 路由算法规格（最终版）

> 融合 one-api 路由 + freellmapi 状态机 + 我们自己的简单性要求  
> 写于收到两套源码研究后, 这是 v2 的真实实现依据

## 设计原则

1. **简单优先** — 个人用 5-10 个 key, 不上 Thompson sampling bandit
2. **状态机驱动** — Key 状态 (healthy/failed/cooldown/disabled) 是唯一真理
3. **请求级隔离** — 失败不污染全局, 同请求内 skipKeys/skipModels/skipPlatforms 三层
4. **可降级** — 极端情况(全网挂)能进 degraded 模式, 只用确认好的

## 0. 数据模型 (DB schema 已基本到位)

```
providers      (上游厂商: minimax / openrouter / anthropic)
channels       (同 provider 的分组/地域, 一对一实际够用)
keys           (api_key_enc, status, status_reason, weight, avg_latency_ms, success_count, failure_count)
discovered_models (key_id, upstream_id) -- Key 支持的模型
virtual_models (Phase 3)
model_candidates (Phase 3)  -- virtual_model → [(provider, key_id, upstream_model)]
cooldowns      (key_id, reason, source, upstream_model, recoverable, started_at, expires_at, cleared_at, cleared_reason)
usage_logs     (记录每次调用)
```

## 1. Key 状态机

```
                  ┌──────────┐
                  │  unknown │  (刚创建, 未探测)
                  └────┬─────┘
                       │ probe 2xx
                       ▼
        ┌──────────────────────────┐
        │       healthy            │ ◄──── probe 2xx (从 cooldown / failed 恢复)
        └─┬───┬───────┬─────┬──────┘
          │   │       │     │
          │   │ 429   │ 5xx │ 401
          │   ▼       ▼     ▼
          │ cooldown  cooldown  failed
          │ (90s)    (30s)    (永久)
          │   │       │       ▲
          │   │ 2xx   │ 2xx   │ 任何调用
          │   └───────┴───────┘
          │
          │ 402 / insufficient_quota
          ▼
    quota_exhausted (24h, authoritative, 不可探测)
```

**状态值** (`keys.status`):
- `unknown` — 刚创建
- `healthy` — 正常
- `failed` — 永久失败 (401, decryption error)
- `disabled` — 用户手动禁用 (注意: 用 `keys.enabled=0` 表示, 不混进 status)

**Cooldown 4 类 source** (`cooldowns.source`):
- `heuristic` (默认) — 429, 5xx, 网络错; **可被探测早恢复清掉**
- `authoritative` — provider 给了 Retry-After, 必须等到期
- `credit` — 402 / insufficient_quota, 24h, 不可探测
- `tier` — 403 model 不在 key 等级, 24h, 不可探测

## 2. Cooldown 时长与 ladder

| 触发 | duration | source | recoverable |
|---|---|---|---|
| 429 (无 Retry-After) | **90s** | heuristic | ✅ |
| 429 (有 Retry-After > 90s) | Retry-After (cap 24h) | authoritative | ❌ |
| 5xx | **30s** | heuristic | ✅ |
| 网络错误/超时 | **30s** | heuristic | ✅ |
| 402 / insufficient_quota | **24h** | credit | ❌ |
| 403 model 等级 | **24h** | tier | ❌ |
| 401 / 解密失败 | (不入 cooldown, 直接 status=failed) | — | — |
| Local endpoint (RFC1918) | **5s** (特例, 绝不进 ladder) | heuristic | ✅ |

**Escalation ladder** (heuristic 连续失败时升级, freellmapi ratelimit.ts 设计):
- 1st 24h 内: 2 min
- 2nd: 10 min
- 3rd: 1 h
- 4th+: 24 h
- **成功 (2xx) 清空 hit 计数** (reversibility contract)

**Operator ceiling** (routing_cooldown_ceiling_ms, 默认 24h) — 防止 ladder 失控

## 3. 路由算法 (one-api 思路 + 我们简化)

**输入**: 客户端请求 `model` 字段, 可能是:
- `M3` (纯 model 名)
- `minimax/M3` (provider/model)
- `minimax/A1-主力/M3` (provider/key-label/model) — 强制指定, 跳过候选池

**Step 1: 解析** — `resolveModel()` 把 model 字段拆成 (provider, keyLabel, upstreamModel)

**Step 2: 强制指定路径** (3 段):
- 直接用指定 key
- 校验 enabled+healthy+无 cooldown
- 失败 → 立即 404/503 (不 failover)

**Step 3: 候选池路径** (1-2 段):
```
candidatePool = selectCandidatePool(upstreamModel) {
  // 1. 找所有 discovered_models 包含 upstreamModel 的 enabled+healthy key
  // 2. 按 score 排序 (见 §4)
  // 3. 分两层: available / unavailable
}
```

**Step 4: 选候选 + 调上游** (在 `runFallbackLoop` 主循环里):
```
for attempt in 0..maxCandidates (默认 5):
  if clientGone && attempt > 0: return
  if attempt > 1 && budgetSpent: return 504
  
  pick = candidatePool.available[0]
  if !pick: break  // 池空了
  if pick.key.id in state.skipKeys: continue  // 本请求内已跳过
  
  try {
    result = await dispatch(pick.key, upstreamModel, req, attempt)
    if 2xx: return success
  } catch (err) {
    if clientAbort: return  // 客户端走了, 静默
    if hedgeAbort: return    // hedge 计时到, 流已发
    if isKeyAuthError(err):  // 401
      skipKeys.add(pick.key.id)
      setCooldown('auth', 5min)  // 5min heuristic
      continue
    
    if isModelError(err):    // 404 model not found, 403 model not allowed, 413 context too large
      skipModels.add(upstreamModel)  // 整个 model 跳过本请求
      // (不写 cooldown - 是请求问题不是 key 问题)
    
    if isProviderError(err):  // 5xx, timeout, transport
      skipPlatforms.add(pick.key.provider)  // 整 provider 跳过
    
    // 任何 4xx (非 401/403/404) → onFatal, 立即返回不重试
    if isClientError(err) && !isKeyAuthError(err):
      return error
    
    if isRetryableError(err):  // 429, 5xx, timeout (经上面分类后)
      // 写 cooldown (按 source)
      setCooldown(pick.key, err, upstreamModel)
      continue
    
    skipKeys.add(pick.key.id)  // 兜底
    continue
  }
  finally: pick.lease?.release()  // 释放 in-flight lease
```

**返回**: 5 个候选内解决, 否则 503/504

## 4. 评分 (freellmapi scoring.ts 公式, 简化)

**所有信号归一 [0, 1]**, 加权和, guardrail 乘法:

```
score = base × headroom × rateLimit

base = (w_r × reliability + w_s × speed + w_i × intel) / wSum
  wSum = w_r + w_s + w_i  // 必须归 1
  reliability = success / (success + failure)   // [0, 1]
  speed       = 1 - exp(-avg_latency_ms / 3000)  // 0.1s → 0.97, 3s → 0.63
  intel       = 1.0  // Phase 2 暂不区分 (v3 引入 model tier)

headroom = min(monthlyHeadroom, windowHeadroom)  // **min 不是乘**
  monthlyHeadroom = remaining_monthly_quota   (Phase 3 接, Phase 2 简化为 1)
  windowHeadroom  = headroomRamp(1 - usedFraction)
    usedFraction = max(rpm/rpm_lim, rpd/rpd_lim, tpm/tpm_lim, tpd/tpd_lim)
    ramp: remaining ≥ 0.2 → 1, remaining = 0 → 0.1, 中间线性

rateLimit = rateWindowHeadroomFactor(current_429_penalty)  // [0.4, 1.0]
  // Phase 2 简化为 1.0
```

**Phase 2 实施**: reliability + speed 已可用, intel=1, headroom=1, rateLimit=1  
**Phase 3 接上**: 真实 headroom 跟踪 (provider-quota.ts 读 response headers + ratelimit 表)

**稳定排序**: 同分按 `key.id ASC` 升序 (调试可复现)

## 5. 并发控制 (in-flight lease, 必抄)

**问题**: N 个并发请求都看到 rpd=0/已用=0, 都发出去打爆上游  
**解决**: `selectKeyForModel` 选完 key 后 **预扣** 一次计数, finally 释放

```typescript
function acquireLease(platform, modelId, keyId, estimatedTokens): number {
  leases.set(id, { platform, modelId, keyId, tokens: estimatedTokens, createdAt: Date.now() });
  return id;
}
function releaseLease(id): void { leases.delete(id); }
function inFlightRequests(platform, modelId, keyId): number {
  let total = 0;
  for (const l of leases.values()) {
    if (l.platform === platform && l.modelId === modelId && l.keyId === keyId) total++;
  }
  return total;
}
```

`canMakeRequest(platform, modelId, keyId, rpm)`:
```
persisted = requestCount(platform, modelId, keyId)
inFlight  = inFlightRequests(platform, modelId, keyId)
return persisted + inFlight < rpm
```

**Phase 2 简版**: 因为我们还没接 rpm/rpd 跟踪, lease 只用来标记"这个 key 正在被多少请求占用", 给后面的 §6 探测调度用  
**Phase 3**: 真正接上, 关键防击穿

## 6. 探测调度 (健康检查 + cooldown-probe)

### 6a. 周期健康检查 (每 5 min ± 20% jitter)

```
for each enabled key:
  send GET /v1/models (key.base_url + key.models_path)
  if 2xx:
    clearDiscoveredModelsForKey(key.id)
    for each model in response.data: upsertDiscoveredModel(key.id, model.id)
    transitionKeyStatus(key.id, healthy)  // 同时清所有 heuristic cooldown
  if 401/403:
    transitionKeyStatus(key.id, failed)  // 永久
  if other:
    transitionKeyStatus(key.id, ...)  // 必要时进 cooldown

after batch: updateDegradationState()  // 重新评估
```

**Phase 2 简版**: 启动时跑一次, 然后每 5 min

### 6b. Cooldown 早恢复 (每 1 min, 仿 freellmapi cooldown-probe.ts)

```
candidates = getProbeableCooldowns(limit=3) {
  WHERE
    cleared_at IS NULL
    AND source = 'heuristic'        -- 只探这 1 种
    AND expires_at > now
    AND k.enabled = 1
    AND (now - started_at) >= (expires_at - started_at) * 0.5  -- 已过半
    AND (expires_at - now) > 60000  -- 还剩 > 1min
  ORDER BY expires_at ASC
  LIMIT 3
}

for each c in candidates:
  result = GET {key.base_url + key.models_path}  -- 走 HTTP 客户端
  if 2xx:
    clearCooldown(c, 'probe_success')  -- 标记 "探测成功清掉"
  else:
    log debug, **不延长 cooldown**  -- (重置下次探测时间在 Phase 3)
```

**关键**: cooldown-probe 永远不延长 cooldown, 只"早清"

### 6c. Degradation 评估 (freellmapi degradation.ts)

```
after health check pass:
  updateDegradationState(now)
  
  if total_enabled_keys < 3: return  // 太少不做判定
  
  if ratio < 0.5:
    if state == 'normal' && now - belowSince >= 60s:
      state = 'degraded'
  else:
    if state == 'degraded' && now - recoveredSince >= 120s:
      state = 'normal'
```

**Degraded 模式对路由的影响**:
- scorer 不给 'unknown' 状态的 key 加分 (减少探索)
- 选择器优先 'healthy' 状态
- 实际效果是 chain 自然短, 不需双套代码

## 7. 错误码 → 处置 (合并 one-api + freellmapi)

| HTTP | error type | 处置 | cooldown | state |
|---|---|---|---|---|
| 200-299 | — | 成功, 清 cooldown, 清 hit 计数 | (清) | (可能 healthy) |
| 400 | invalid_request_error | 客户端错, **不重试**, 立即返回 | (无) | (不变) |
| 401 | invalid_api_key | 换 key, **5min heuristic cooldown** | heuristic 5m | (可能 failed) |
| 402 | insufficient_quota | 换 key, **24h credit cooldown** | credit 24h | failed |
| 403 | model_not_allowed | skip model (整 model 跳), 24h tier cooldown | tier 24h | (不变) |
| 404 | model_not_found | skip model, **不写 cooldown** (请求问题) | (无) | (不变) |
| 413 | context_too_large | skip model, **不写 cooldown** | (无) | (不变) |
| 429 | rate_limit | 换 key, 90s heuristic (或 Retry-After authoritative) | heuristic 90s / authoritative cap 24h | (不变) |
| 500-599 | server_error | 同 key 重试 1 次, 换 key, 30s heuristic | heuristic 30s | (不变) |
| 0 / network | upstream_error | 同 key 重试 1 次, 换 key, 30s heuristic | heuristic 30s | (不变) |

**client_disconnect** (用户关 tab): 不写 cooldown, 不扣 stats, 静默返回

## 8. 实现顺序 (Phase 2 落地)

| Step | 文件 | 工作量 |
|---|---|---|
| ✅ 2.1 | `cooldowns.ts` repo | 1h (已完成) |
| ✅ 2.2 | `keyHealth.ts` + source 字段迁移 | 30min |
| ✅ 2.3 | `scorer.ts` (reliability+speed, base+guardrail 乘法) | 1h |
| ✅ 2.4 | `selector.ts` KeyPool / Candidate | 30min |
| ✅ 2.5 | `failover.ts` 主循环 + 三层 skip | 2h |
| ⬜ 2.6 | in-flight lease | 30min |
| ⬜ 2.7 | escalation ladder + 成功清 hit | 30min |
| ⬜ 2.8 | local endpoint 特例 | 15min |
| ⬜ 2.9 | `degradation.ts` 状态机 | 已完成 |
| ⬜ 2.10 | `backgroundJobs.ts` (health check + cooldown probe) | 已完成 |
| ⬜ 2.11 | header observation (provider-quota.ts) | 2h — Phase 3 |
| ⬜ 2.12 | unit tests | 2h |

## 9. 不抄的 (避坑)

❌ one-api 的 `RetryTimes` 全局配置 → 我们 per-request pool  
❌ one-api 的 `MemoryCacheEnabled` 二选一 → always-cache, 30s sync  
❌ one-api 的 `Channel.Weight` → 我们直接用 priority 字段  
❌ one-api 的 `User.Quota` 双层预扣 → 我们是个人用, 不需要  
❌ one-api 的 4xx 默认 retry → 4xx 不 retry (除 401/429)  
❌ freellmapi 的两层 Thompson bandit → 我们用 priority + reliability 够用  
❌ freellmapi 的 20 次重试 + 45s budget → 我们 5 次 + 60s 更保守
