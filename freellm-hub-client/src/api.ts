const BASE = '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const hasBody = options?.body != null;
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  });
  if (res.status === 401) {
    if (!window.location.pathname.includes('/login')) {
      window.location.href = '/login';
    }
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || err.message || 'Request failed');
  }
  return res.json();
}

function unwrap<T>(res: any, key?: string): T {
  if (key && res && Array.isArray(res[key])) return res[key] as T;
  if (Array.isArray(res)) return res as T;
  if (key && res && res[key] !== undefined) return res[key] as T;
  return res as T;
}

export interface DashboardStats {
  totalRequests: number;
  totalTokens: number;
  activeChannels: number;
  activeKeys: number;
  successRate: number;
  avgLatency: number;
}

export interface Provider {
  id: number;
  name: string;
  display_name: string | null;
  base_url: string;
  protocol: string;
  api_path: string;
  models_path: string;
  extra_config: string | null;
  signup_url: string | null;
  notes: string | null;
  enabled: number;
  is_free: number;
  category: string | null;
  docs_url: string | null;
}

export interface Channel {
  id: number;
  name: string;
  label?: string;
  base_url: string;
  provider_id: number;
  provider_name?: string;
  provider_display_name?: string;
  models: string;
  status: number;
  enabled: number;
  priority: number;
  weight: number;
  test_model?: string;
  tag?: string;
  key_count?: number;
  protocol?: string;
  capabilities?: string | null;
  support_vision?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Key {
  id: number;
  channel_id: number;
  channel_name?: string;
  label: string;
  api_key: string;
  api_key_hint?: string;
  enabled: number;
  status: number;
  priority: number;
  weight: number;
  success_count: number;
  failure_count: number;
  avg_latency_ms: number;
  last_used_at?: string;
  created_at: string;
  /** 允许服务的模型列表; null/空 = 不限制 */
  allowed_models?: string[] | null;
  allowed_models_parsed?: string[] | null;
  plain_key?: string | null;
}

export interface HubKey {
  id: number;
  name: string;
  prefix: string;
  enabled: number;
  notes?: string | null;
  rate_limit_rpm?: number | null;
  expires_at?: number | null;
  created_at: string | number;
  last_used_at?: string | number | null;
  plain_key?: string;
  /** 允许调用的模型列表; null/空 = 不限制 */
  allowed_models_parsed?: string[] | null;
}

export interface ModelRoute {
  id: number;
  model_pattern: string;
  request_model?: string;
  target_channel_id?: number;
  channel_ids?: string;
  target_key_id?: number;
  priority: number;
  enabled: number;
  description?: string;
  notes?: string;
  created_at: string;
}

export interface UsageLog {
  id: number;
  hub_key_id?: number;
  channel_id?: number;
  model: string;
  tokens_prompt: number;
  tokens_completion: number;
  latency_ms: number;
  status: number;
  error_code?: number | null;
  error_type?: string | null;
  error_message?: string | null;
  created_at: string;
}

export interface UsageDaily {
  date: string;
  total_requests: number;
  total_tokens: number;
  success_count: number;
  failure_count: number;
  avg_latency_ms: number;
}

export interface FallbackConfig {
  id: number;
  primaryModel: string;
  fallbackModels: string[];
  strategy: 'sequential' | 'weighted' | 'priority';
  enabled: boolean;
  maxRetries: number;
  retryDelayMs: number;
  createdAt: number;
  updatedAt: number;
}

export interface GuardrailConfig {
  id: number;
  name: string;
  description: string | null;
  enabled: boolean;
  inputFilter: boolean;
  outputFilter: boolean;
  rules: {
    blocked_keywords: string[];
    pii_detection: boolean;
    max_input_length: number;
    max_output_length: number;
  };
  createdAt: number;
  updatedAt: number;
}

export interface CacheStats {
  totalEntries: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
}

export interface ModelMapping {
  id: number;
  from_model: string;
  to_model: string;
  enabled: number;
  created_at: number;
}

export interface VirtualModel {
  id: number;
  name: string;
  display_name: string | null;
  description: string | null;
  enabled: number;
  candidate_count: number;
  created_at: number;
  updated_at: number;
}

export interface ModelCandidate {
  id: number;
  virtual_model_id: number;
  key_id: number;
  upstream_model: string;
  priority: number;
  weight: number;
  enabled: number;
  pinned: number;
  key_label: string | null;
  key_status: string;
  provider_name: string | null;
  provider_display_name: string | null;
}

// 请求体类型 (后端用 snake_case + boolean)
export interface FallbackInput {
  primary_model: string;
  fallback_models?: string[];
  strategy?: 'sequential' | 'weighted' | 'priority';
  enabled?: boolean;
  max_retries?: number;
  retry_delay_ms?: number;
}

export interface ModelMappingInput {
  from_model: string;
  to_model: string;
  enabled?: boolean;
}

export interface VirtualModelInput {
  name: string;
  display_name?: string | null;
  description?: string | null;
  enabled?: boolean;
}

export interface ModelCandidateInput {
  key_id: number;
  upstream_model: string;
  priority?: number;
  weight?: number;
  enabled?: boolean;
  pinned?: boolean;
}

export interface GuardrailInput {
  enabled?: boolean;
  input_filter?: boolean;
  output_filter?: boolean;
  rules?: GuardrailConfig['rules'];
  description?: string | null;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ ok: boolean; username?: string; redirect?: string }>('/api/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  logout: () => request<{ ok: boolean }>('/api/admin/auth/logout', { method: 'POST' }),

  getProfile: () => request<{ ok: boolean; username: string }>('/api/admin/auth/me'),

  getDashboardStats: () => request<DashboardStats>('/api/admin/dashboard/stats'),
  getDashboard24hBars: () => request<{ ok: boolean; buckets: Array<{ hour: string; total: number; ok: number; err: number }> }>('/api/admin/dashboard/24h-bars'),
  getUsageTrend: (days?: number) => request<{ days: number; data: Array<{ day: string; total: number; successes: number; errors: number; total_tokens: number; avg_latency_ms: number }> }>(`/api/admin/usage/trend${days ? `?days=${days}` : ''}`),
  
  // 用量统计增强
  getUsageOverview: (days = 7) => request<{ ok: boolean; overview: { totalRequests: number; successes: number; failures: number; successRate: number; totalTokens: number; promptTokens: number; completionTokens: number; avgLatency: number; minLatency: number; maxLatency: number } }>(`/api/admin/usage/overview?days=${days}`),
  getUsageModelStats: (days = 7) => request<{ ok: boolean; stats: Array<{ model: string; requests: number; totalTokens: number; promptTokens: number; completionTokens: number; successes: number; failures: number; avgLatency: number }> }>(`/api/admin/usage/model-stats?days=${days}`),
  getUsageChannelStats: (days = 7) => request<{ ok: boolean; stats: Array<{ channelId: number; providerName: string; requests: number; totalTokens: number; successes: number; failures: number; avgLatency: number }> }>(`/api/admin/usage/channel-stats?days=${days}`),
  getUsageErrorStats: (days = 7) => request<{ ok: boolean; stats: Array<{ errorCode: number | null; errorType: string; count: number; percentage: number }> }>(`/api/admin/usage/error-stats?days=${days}`),
  getUsageDaily: (days = 30) => request<{ ok: boolean; daily: Array<{ day: string; total_requests: number; total_tokens: number; success_count: number; failure_count: number; avg_latency_ms: number }> }>(`/api/admin/usage/daily?days=${days}`),
  getUsageLogs: (limit = 50, offset = 0, status?: string, model?: string) => request<{ ok: boolean; logs: any[]; total: number }>(`/api/admin/usage/logs?limit=${limit}&offset=${offset}${status ? `&status=${status}` : ''}${model ? `&model=${model}` : ''}`),

  // 路由策略
  getRoutingStrategy: () => request<{ strategy: string }>('/api/admin/settings/routing'),
  setRoutingStrategy: (strategy: string) => request<{ ok: boolean; strategy: string }>('/api/admin/settings/routing', { method: 'POST', body: JSON.stringify({ strategy }) }),

  getProviders: async () => {
    const res = await request<{ ok?: boolean; providers: Provider[] } | Provider[]>('/api/admin/providers');
    return unwrap<Provider[]>(res, 'providers');
  },

  getChannels: async () => {
    const res = await request<{ ok: boolean; channels: Channel[] }>('/api/admin/channels');
    return res.channels || [];
  },
  createChannel: (data: Partial<Channel> & { api_key?: string; api_keys_batch?: string; multi_key_mode?: string }) =>
    request<any>('/api/admin/channels', { method: 'POST', body: JSON.stringify(data) }),
  updateChannel: (id: number, data: Partial<Channel>) =>
    request<{ ok: boolean; channel: Channel }>(`/api/admin/channels/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteChannel: (id: number) =>
    request<{ ok: boolean }>(`/api/admin/channels/${id}`, { method: 'DELETE' }),
  testChannel: (id: number) =>
    request<{ ok: boolean; latency?: number; error?: string }>(`/api/admin/channels/${id}/test`, { method: 'POST' }),
  fetchModels: (id: number) =>
    request<{ ok: boolean; models: string[] }>(`/api/admin/channels/${id}/fetch-models`, { method: 'POST' }),
  probeChannel: (id: number) =>
    request<{ ok: boolean; reasoning: boolean | null; tool_calls: boolean | null; vision: boolean | null; latencyMs: number; error?: string }>(`/api/admin/channels/${id}/probe`, { method: 'POST' }),
  
  // 批量操作
  batchEditChannels: (channelIds: number[], updates: Partial<Channel>) =>
    request<{ ok: boolean; results: any[]; updated_count: number }>('/api/admin/channels/batch-edit', { method: 'POST', body: JSON.stringify({ channel_ids: channelIds, updates }) }),
  batchDeleteChannels: (channelIds: number[]) =>
    request<{ ok: boolean; results: any[]; deleted_count: number }>('/api/admin/channels/batch-delete', { method: 'POST', body: JSON.stringify({ channel_ids: channelIds }) }),
  batchTestChannels: (channelIds: number[]) =>
    request<{ ok: boolean; results: any[]; success_count: number; failed_count: number }>('/api/admin/channels/batch-test', { method: 'POST', body: JSON.stringify({ channel_ids: channelIds }) }),
  batchStatusChannels: (channelIds: number[], enabled: boolean) =>
    request<{ ok: boolean; results: any[]; count: number }>('/api/admin/channels/batch-status', { method: 'POST', body: JSON.stringify({ channel_ids: channelIds, enabled }) }),
  copyChannel: (id: number, label?: string) =>
    request<{ ok: boolean; channel: Channel; copied_keys: any[] }>(`/api/admin/channels/${id}/copy`, { method: 'POST', body: JSON.stringify({ label }) }),

  // 标签管理
  getTags: async () => {
    const res = await request<{ ok: boolean; tags: any[] }>('/api/admin/tags');
    return res.tags || [];
  },
  createTag: (data: { name: string; description?: string; color?: string }) =>
    request<{ ok: boolean; tag: any }>('/api/admin/tags', { method: 'POST', body: JSON.stringify(data) }),
  updateTag: (id: number, data: { name?: string; description?: string; color?: string }) =>
    request<{ ok: boolean; tag: any }>(`/api/admin/tags/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTag: (id: number) =>
    request<{ ok: boolean }>(`/api/admin/tags/${id}`, { method: 'DELETE' }),
  getChannelTags: async (channelId: number) => {
    const res = await request<{ ok: boolean; tags: any[] }>(`/api/admin/channels/${channelId}/tags`);
    return res.tags || [];
  },
  setChannelTags: (channelId: number, tagIds: number[]) =>
    request<{ ok: boolean; tags: any[] }>(`/api/admin/channels/${channelId}/tags`, { method: 'PUT', body: JSON.stringify({ tag_ids: tagIds }) }),
  addChannelTag: (channelId: number, tagId: number) =>
    request<{ ok: boolean; tags: any[] }>(`/api/admin/channels/${channelId}/tags`, { method: 'POST', body: JSON.stringify({ tag_id: tagId }) }),
  removeChannelTag: (channelId: number, tagId: number) =>
    request<{ ok: boolean; tags: any[] }>(`/api/admin/channels/${channelId}/tags/${tagId}`, { method: 'DELETE' }),
  getChannelsByTag: async (tagId: number) => {
    const res = await request<{ ok: boolean; channels: Channel[] }>(`/api/admin/tags/${tagId}/channels`);
    return res.channels || [];
  },
  batchSetChannelTags: (channelIds: number[], tagIds: number[]) =>
    request<{ ok: boolean; count: number }>('/api/admin/channels/batch-tags', { method: 'POST', body: JSON.stringify({ channel_ids: channelIds, tag_ids: tagIds }) }),

  getChannelKeys: async (channelId: number) => {
    const res = await request<{ ok?: boolean; keys: Key[] } | Key[]>(`/api/admin/channels/${channelId}/keys`);
    return unwrap<Key[]>(res, 'keys');
  },
  createKey: async (channelId: number, data: { api_key: string; key_label?: string; models?: string[] | null }) => {
    const res = await request<{ ok: boolean; key_id: number }>(
      `/api/admin/channels/${channelId}/keys`,
      { method: 'POST', body: JSON.stringify(data) }
    );
    return res;
  },
  updateKey: (keyId: number, data: { label?: string; enabled?: number; allowed_models?: string[] | null }) =>
    request<{ ok: boolean; key: Key }>(`/api/admin/keys/${keyId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getKey: (keyId: number) =>
    request<{ ok: boolean; key: Key }>(`/api/admin/keys/${keyId}`),
  getKeyPlain: (keyId: number) =>
    request<{ ok: boolean; api_key: string }>(`/api/admin/keys/${keyId}/plain`),
  deleteKey: (keyId: number) =>
    request<{ ok: boolean }>(`/api/admin/keys/${keyId}`, { method: 'DELETE' }),
  getChannelAvailableModels: async (channelId: number) => {
    const res = await request<{ ok: boolean; models: string[] } | string[]>(
      `/api/admin/channels/${channelId}/available-models`
    );
    return unwrap<string[]>(res, 'models');
  },

  // 模型测试相关
  testChannelModels: (channelId: number) =>
    request<{
      ok: boolean;
      channel_id: number;
      channel_label: string;
      results: Array<{
        key_id: number;
        key_label: string | null;
        upstream_id: string;
        ok: boolean;
        latency_ms: number;
        error?: string;
      }>;
      summary: { total: number; ok: number; error: number; untested: number };
    }>(`/api/admin/channels/${channelId}/models-test`, { method: 'POST' }),
  getChannelModelsSummary: (channelId: number) =>
    request<{
      ok: boolean;
      total: number;
      okCount: number;
      errorCount: number;
      untested: number;
    }>(`/api/admin/channels/${channelId}/models-summary`),
  deleteFailedModels: (channelId: number) =>
    request<{ ok: boolean; deleted_count: number }>(`/api/admin/channels/${channelId}/models-failed`, { method: 'DELETE' }),

  getHubKeys: async () => {
    const res = await request<{ ok: boolean; keys: HubKey[] }>('/api/admin/hub-keys');
    return res.keys || [];
  },
  createHubKey: (data: { name: string; allowed_models?: string[] | null; notes?: string; rate_limit_rpm?: number; expires_in_days?: number | string }) =>
    request<HubKey>('/api/admin/hub-keys', { method: 'POST', body: JSON.stringify(data) }),
  updateHubKey: (id: number, data: { name?: string; notes?: string | null; allowed_models?: string[] | null; rate_limit_rpm?: number | null; expires_in_days?: number | string | null }) =>
    request<{ ok: boolean; key: HubKey }>(`/api/admin/hub-keys/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  regenerateHubKey: (id: number) =>
    request<HubKey>(`/api/admin/hub-keys/${id}/regenerate`, { method: 'POST' }),
  toggleHubKey: (id: number) =>
    request<HubKey>(`/api/admin/hub-keys/${id}/toggle`, { method: 'POST' }),
  deleteHubKey: (id: number) =>
    request<{ ok: boolean }>(`/api/admin/hub-keys/${id}`, { method: 'DELETE' }),
  getHubKeyPlain: (id: number) =>
    request<{ ok: boolean; plain_key: string }>(`/api/admin/hub-keys/${id}/plain`),

  /** 全局可用模型列表 (跨所有启用渠道) */
  getGlobalModels: async () => {
    const res = await request<{ data: Array<{ id: string; owned_by?: string }> }>('/api/admin/chat/models');
    return (res.data || []).map((m) => m.id).sort();
  },

  getModelRoutes: async () => {
    const res = await request<{ ok: boolean; routes: ModelRoute[] }>('/api/admin/model-routes');
    return res.routes || [];
  },
  createModelRoute: (data: Partial<ModelRoute>) =>
    request<ModelRoute>('/api/admin/model-routes', { method: 'POST', body: JSON.stringify(data) }),
  updateModelRoute: (id: number, data: Partial<ModelRoute>) =>
    request<ModelRoute>(`/api/admin/model-routes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteModelRoute: (id: number) =>
    request<{ ok: boolean }>(`/api/admin/model-routes/${id}`, { method: 'DELETE' }),

  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/api/admin/auth/profile', {
      method: 'POST',
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    }),

  // ─── 故障转移 ───
  getFallbackConfigs: async () => {
    const res = await request<{ ok: boolean; configs: FallbackConfig[] }>('/api/admin/fallback');
    return res.configs || [];
  },
  createFallback: (data: FallbackInput) =>
    request<{ ok: boolean; config: FallbackConfig }>('/api/admin/fallback', { method: 'POST', body: JSON.stringify(data) }),
  deleteFallback: (id: number) =>
    request<{ ok: boolean }>(`/api/admin/fallback/${id}`, { method: 'DELETE' }),

  // ─── 内容护栏 ───
  getGuardrails: async () => {
    const res = await request<{ ok: boolean; config: GuardrailConfig | null }>('/api/admin/guardrails');
    return res.config;
  },
  updateGuardrails: (data: GuardrailInput) =>
    request<{ ok: boolean; config: GuardrailConfig }>('/api/admin/guardrails', { method: 'PUT', body: JSON.stringify(data) }),

  // ─── 响应缓存 ───
  getCacheStats: () =>
    request<{ ok: boolean; enabled: boolean; ttl_seconds: number; stats: CacheStats }>('/api/admin/cache/stats'),
  setCacheEnabled: (enabled: boolean, ttlSeconds: number) =>
    request<{ ok: boolean; enabled: boolean; ttl_seconds: number }>('/api/admin/cache/enable', { method: 'POST', body: JSON.stringify({ enabled, ttl_seconds: ttlSeconds }) }),
  cleanupCache: () =>
    request<{ ok: boolean; cleaned: number }>('/api/admin/cache/cleanup', { method: 'POST' }),

  // ─── 模型映射 ───
  getModelMappings: async () => {
    const res = await request<{ ok: boolean; mappings: ModelMapping[] }>('/api/admin/model-mappings');
    return res.mappings || [];
  },
  createModelMapping: (data: ModelMappingInput) =>
    request<{ ok: boolean; mapping: ModelMapping }>('/api/admin/model-mappings', { method: 'POST', body: JSON.stringify(data) }),
  updateModelMapping: (id: number, data: ModelMappingInput) =>
    request<{ ok: boolean; mapping: ModelMapping }>(`/api/admin/model-mappings/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteModelMapping: (id: number) =>
    request<{ ok: boolean }>(`/api/admin/model-mappings/${id}`, { method: 'DELETE' }),
  previewModelMapping: (model: string) =>
    request<{ ok: boolean; original: string; mapped: string | null; chain?: string[]; error?: string }>(`/api/admin/model-mappings/preview?model=${encodeURIComponent(model)}`),

  // ─── 虚拟模型 ───
  getVirtualModels: async () => {
    const res = await request<{ ok: boolean; models: VirtualModel[] }>('/api/admin/virtual-models');
    return res.models || [];
  },
  getVirtualModel: async (id: number) => {
    const res = await request<{ ok: boolean; model: VirtualModel; candidates: ModelCandidate[] }>(`/api/admin/virtual-models/${id}`);
    return res;
  },
  createVirtualModel: (data: VirtualModelInput) =>
    request<{ ok: boolean; model: VirtualModel }>('/api/admin/virtual-models', { method: 'POST', body: JSON.stringify(data) }),
  updateVirtualModel: (id: number, data: VirtualModelInput) =>
    request<{ ok: boolean; model: VirtualModel }>(`/api/admin/virtual-models/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteVirtualModel: (id: number) =>
    request<{ ok: boolean }>(`/api/admin/virtual-models/${id}`, { method: 'DELETE' }),
  addModelCandidate: (modelId: number, data: ModelCandidateInput) =>
    request<{ ok: boolean; candidate: ModelCandidate }>(`/api/admin/virtual-models/${modelId}/candidates`, { method: 'POST', body: JSON.stringify(data) }),
  updateModelCandidate: (id: number, data: Partial<ModelCandidateInput>) =>
    request<{ ok: boolean; candidate: ModelCandidate }>(`/api/admin/model-candidates/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteModelCandidate: (id: number) =>
    request<{ ok: boolean }>(`/api/admin/model-candidates/${id}`, { method: 'DELETE' }),
  getAvailableKeys: async () => {
    const res = await request<{ ok: boolean; keys: Key[] }>('/api/admin/virtual-models/available-keys');
    return res.keys || [];
  },
};
