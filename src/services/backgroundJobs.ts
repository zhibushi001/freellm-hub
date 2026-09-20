/**
 * 后台任务调度
 * 详见 docs/DESIGN.md §4 + freellmapi cooldown-probe.ts
 *
 * 五个任务:
 *   1. health-check     (每 5 min)  探测所有 enabled key, 更新 status
 *   2. cooldown-probe   (每 1 min)  探测 heuristic cooldown 早恢复
 *   3. degradation-update(每 5 min)  更新全局降级状态
 *   4. db-backup        (每 24h)    VACUUM INTO 备份 + 清理过期
 *   5. log-cleanup      (每 24h)    清理过期 usage_logs / media_tasks
 */
import { listKeys } from '../db/repos/keys.js';
import { getDecryptedApiKey } from '../db/repos/keys.js';
import { httpSend } from '../adapters/client.js';
import { transitionKeyStatus } from './keyHealth.js';
import { upsertDiscoveredModel, clearDiscoveredModelsForKey } from '../db/repos/discoveredModels.js';
import { getProbeableCooldowns, clearCooldown } from '../db/repos/cooldowns.js';
import { updateDegradationState } from './degradation.js';
import { backupDatabase, pruneBackups } from './backupService.js';
import { getDb } from '../db/connection.js';
import { logger } from '../util/logger.js';
import { parseJsonSafe } from '../util/json.js';

// 模拟 setInterval 包装, 便于测试时关闭
const timers: NodeJS.Timeout[] = [];

const LOG_RETENTION_DAYS = parseInt(process.env.HUB_LOG_RETENTION_DAYS || '90', 10);

export function startBackgroundJobs(): void {
  // 健康检查 - 5 分钟
  timers.push(setInterval(runHealthCheck, 5 * 60 * 1000));
  // Cooldown 探测 - 1 分钟
  timers.push(setInterval(runCooldownProbe, 60 * 1000));
  // Degradation 更新 - 5 分钟 (跟 health-check 错开, 共用结果)
  timers.push(setInterval(() => updateDegradationState(), 5 * 60 * 1000));
  // DB 备份 - 24 小时
  timers.push(setInterval(runBackup, 24 * 60 * 60 * 1000));
  // 日志清理 - 24 小时
  timers.push(setInterval(runLogCleanup, 24 * 60 * 60 * 1000));

  // 启动时先跑一次
  setTimeout(() => {
    runHealthCheck().catch(e => logger.error({ e }, 'health check startup failed'));
    runCooldownProbe().catch(e => logger.error({ e }, 'cooldown probe startup failed'));
    updateDegradationState();
  }, 5_000);
  logger.info('Background jobs started');
}

export function stopBackgroundJobs(): void {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
}

async function runHealthCheck(): Promise<void> {
  const keys = listKeys().filter(k => k.enabled === 1);
  logger.info({ count: keys.length }, 'Health check starting');
  for (const key of keys) {
    try {
      const apiKey = getDecryptedApiKey(key.id);
      const url = `${key.base_url.replace(/\/$/, '')}${key.models_path}`;
      const res = await httpSend(url, apiKey, { method: 'GET', timeoutMs: 15_000 });
      transitionKeyStatus(key.id, { status: res.status, body: parseJsonSafe(res.body) });
      if (res.status >= 200 && res.status < 300) {
        const models = parseModels(res.body);
        clearDiscoveredModelsForKey(key.id);
        for (const m of models) upsertDiscoveredModel(key.id, m);
      }
    } catch (e: any) {
      transitionKeyStatus(key.id, { status: 0, error: e.message });
    }
  }
  // 跑完后更新 degradation
  updateDegradationState();
  logger.info('Health check done');
}

/**
 * Cooldown 早恢复 - 探测式
 *
 * 规则 (照搬 freellmapi cooldown-probe.ts):
 *   - 只探测 recoverable=1 (heuristic) 的 cooldown
 *   - 跳过 authoritative (quota_exhausted, auth_invalid)
 *   - 已过半 + 还剩 > 1min
 *   - 单次最多 3 个探测 (防 thundering herd)
 *   - 探测失败**不延长** cooldown, 只把下次探测延后 (我们 Phase 2 简化: 不实现 backoff 调度, 失败就放过)
 */
const PROBE_BUDGET_PER_PASS = 3;

async function runCooldownProbe(): Promise<void> {
  const candidates = getProbeableCooldowns(PROBE_BUDGET_PER_PASS);
  if (candidates.length === 0) return;
  logger.info({ count: candidates.length }, 'Cooldown probe starting');

  for (const c of candidates) {
    try {
      const apiKey = getDecryptedApiKey(c.key_id);
      const url = `${c.key_base_url.replace(/\/$/, '')}${c.key_models_path ?? c.key_api_path ?? '/models'}`;
      const res = await httpSend(url, apiKey, { method: 'GET', timeoutMs: 10_000 });
      if (res.status >= 200 && res.status < 300) {
        // 探测成功 - 清掉 cooldown
        clearCooldown(c.key_id, c.reason, c.upstream_model, 'probe_success');
        logger.info({ keyId: c.key_id, reason: c.reason, model: c.upstream_model }, 'Cooldown cleared by probe');
      } else {
        // 探测失败 - 不延长 cooldown, 只是记录
        logger.debug({ keyId: c.key_id, status: res.status }, 'Cooldown probe failed, leaving cooldown');
      }
    } catch (e: any) {
      logger.debug({ keyId: c.key_id, error: e.message }, 'Cooldown probe error, leaving cooldown');
    }
  }
}

function parseModels(body: string): string[] {
  const j = parseJsonSafe(body);
  if (!j) return [];
  if (Array.isArray(j.data)) return j.data.map((m: any) => m.id).filter((x: any) => typeof x === 'string');
  if (Array.isArray(j)) return j.map((m: any) => m.id ?? m.name ?? m).filter((x: any) => typeof x === 'string');
  return [];
}

/**
 * 数据库备份: VACUUM INTO 生成干净副本 + 清理过期/超量备份
 */
function runBackup(): void {
  try {
    backupDatabase();
    const pruned = pruneBackups();
    if (pruned > 0) logger.info({ pruned }, 'Old backups pruned');
  } catch (e: any) {
    logger.error({ e }, 'Database backup failed');
  }
}

/**
 * 日志清理: 删除超过保留期的 usage_logs / media_tasks / request_attempts
 */
function runLogCleanup(): void {
  try {
    const db = getDb();
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const r1 = db.prepare('DELETE FROM usage_logs WHERE created_at < ?').run(cutoff);
    const r2 = db.prepare('DELETE FROM media_tasks WHERE created_at < ?').run(cutoff);
    const r3 = db.prepare('DELETE FROM request_attempts WHERE created_at < ?').run(cutoff);
    const total = Number(r1.changes) + Number(r2.changes) + Number(r3.changes);
    if (total > 0) {
      logger.info({ usage_logs: r1.changes, media_tasks: r2.changes, request_attempts: r3.changes, retention_days: LOG_RETENTION_DAYS }, 'Old logs cleaned');
    }
  } catch (e: any) {
    logger.error({ e }, 'Log cleanup failed');
  }
}
