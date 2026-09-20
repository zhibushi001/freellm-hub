/**
 * Phase 5: Channel test + 详情 + 更新服务
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { getChannel, updateChannel } from '../db/repos/channels.js';
import { listKeysByChannel, getDecryptedApiKey, recordKeyUsage } from '../db/repos/keys.js';
import { getDiscoveredModelsForKey } from '../db/repos/discoveredModels.js';
import { buildUpstreamRequest, buildUpstreamUrl } from '../adapters/openai.js';
import { httpSend } from '../adapters/client.js';
import { transitionKeyStatus } from './keyHealth.js';
import { inflightStart, inflightEnd } from './inflightTracker.js';
import { parseJsonSafe } from '../util/json.js';

export async function testChannel(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const channelId = parseInt((req.params as any).id, 10);
  const channel = getChannel(channelId);
  if (!channel) {
    reply.code(404).send({ ok: false, error: 'Channel not found' });
    return;
  }

  // 该 channel 第一个 enabled key
  const keys = listKeysByChannel(channelId).filter((k) => k.enabled);
  if (keys.length === 0) {
    reply.code(400).send({ ok: false, error: '该 channel 没有 enabled key' });
    return;
  }
  const key = keys[0];

  const body = (req.body ?? {}) as { model?: string; message?: string };
  // 优先: 请求体 model → 渠道 test_model → 第一个已发现模型 → 兜底 gpt-4o-mini
  let model = body.model || channel.test_model || 'gpt-4o-mini';
  if (!body.model && !channel.test_model) {
    const discovered = getDiscoveredModelsForKey(key.id);
    if (discovered.length > 0) model = discovered[0].upstream_id;
  }
  const message = body.message || 'hi';

  // model_mapping: { user_model: actual_upstream_model }
  let upstreamModel = model;
  const modelMap = parseJsonSafe(channel.model_mapping) || {};
  if (modelMap[model]) upstreamModel = modelMap[model];

  // param_override: 强制覆盖请求参数
  const paramOverride = parseJsonSafe(channel.param_override) || {};

  // header_override: 自定义 header
  const headerOverride = parseJsonSafe(channel.header_override, {});

  // status_code_mapping: { "400": "500" } 错误码重写
  const statusCodeMap = parseJsonSafe(channel.status_code_mapping, {}) || {};

  const url = buildUpstreamUrl(key);
  const apiKey = getDecryptedApiKey(key.id);
  const reqBody = buildUpstreamRequest({
    model: upstreamModel,
    messages: [{ role: 'user', content: message }],
    max_tokens: 20,
    temperature: 0,
    ...paramOverride,
  } as any, upstreamModel);

  const start = Date.now();
  inflightStart(key.id, upstreamModel);
  try {
    const res = await httpSend(url, apiKey, {
      method: 'POST',
      body: JSON.stringify(reqBody),
      timeoutMs: 30_000,
      headers: Object.keys(headerOverride).length > 0 ? headerOverride : undefined,
    }, key.id);
    const latencyMs = Date.now() - start;
    let body: any;
    try { body = JSON.parse(res.body); } catch { body = res.body; }
    const success = res.status >= 200 && res.status < 300;
    transitionKeyStatus(key.id, { status: res.status, body, upstreamModel });
    recordKeyUsage(key.id, success, latencyMs);

    let finalStatus = res.status;
    if (statusCodeMap[String(res.status)]) {
      finalStatus = statusCodeMap[String(res.status)];
    }

    reply.send({
      ok: success,
      status: finalStatus,
      original_status: res.status,
      latencyMs,
      key_id: key.id,
      key_name: key.label || `key#${key.id}`,
      model,
      upstream_model: upstreamModel,
      body,
    });
  } catch (e: any) {
    const latencyMs = Date.now() - start;
    inflightEnd(key.id, upstreamModel, latencyMs);
    transitionKeyStatus(key.id, { status: 0, error: e.message, upstreamModel });
    recordKeyUsage(key.id, false, latencyMs);
    reply.code(502).send({ ok: false, error: e.message, latencyMs });
  } finally {
    inflightEnd(key.id, upstreamModel, Date.now() - start);
  }
}

export function getChannelFull(channelId: number): any {
  const channel = getChannel(channelId);
  if (!channel) return { ok: false, error: 'not found' };
  const keys = listKeysByChannel(channelId);
  // 可用模型: 所有 key 的 discovered_models 合并, 去掉 excluded
  const discoveredSet = new Set<string>();
  for (const k of keys) {
    const models = getDiscoveredModelsForKey(k.id);
    for (const m of models) discoveredSet.add(m.upstream_id);
  }
  let excluded: string[] = [];
  try { excluded = channel.excluded_models ? JSON.parse(channel.excluded_models) : (channel.excluded_models || '').split(',').map(s => s.trim()).filter(Boolean); } catch { /* intentional empty */ }
  const excludedSet = new Set(excluded);
  const models = Array.from(discoveredSet).filter(m => !excludedSet.has(m)).sort();
  return {
    ok: true,
    channel: {
      ...channel,
      model_mapping: parseJsonSafe(channel.model_mapping, {}),
      status_code_mapping: parseJsonSafe(channel.status_code_mapping, {}),
      param_override: parseJsonSafe(channel.param_override, {}),
      header_override: parseJsonSafe(channel.header_override, {}),
      capabilities: parseJsonSafe(channel.capabilities, {}),
    },
    keys,
    models,
    key_count: keys.length,
    enabled_key_count: keys.filter((k) => k.enabled).length,
  };
}

export function updateChannelSettings(channelId: number, patch: any): any {
  const allowed: Array<keyof typeof patch> = [
    'label', 'enabled', 'weight', 'priority',
    'models', 'model_mapping', 'status_code_mapping', 'param_override', 'header_override',
    'multi_key_mode', 'test_model', 'auto_ban', 'tag', 'capabilities',
  ];
  const clean: any = {};
  const jsonFields = new Set(['model_mapping', 'status_code_mapping', 'param_override', 'header_override', 'capabilities']);
  const intFields = new Set(['auto_ban', 'enabled']);
  for (const k of allowed) {
    if (patch[k] !== undefined) {
      if (jsonFields.has(k as string)) {
        clean[k] = typeof patch[k] === 'string' ? patch[k] : JSON.stringify(patch[k]);
      } else if (intFields.has(k as string)) {
        clean[k] = patch[k] ? 1 : 0;
      } else {
        clean[k] = patch[k];
      }
    }
  }
  return updateChannel(channelId, clean);
}
