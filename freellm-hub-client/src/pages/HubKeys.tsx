import { useState, useEffect } from 'react';
import { api, HubKey } from '../api';
import { Plus, Trash2, RefreshCw, Copy, Eye, EyeOff, Power, PowerOff, X, Key, Globe, CheckCircle2 } from 'lucide-react';
import { copyToClipboard } from '../utils/copy';

export default function HubKeys() {
  const [keys, setKeys] = useState<HubKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [plainKeyModal, setPlainKeyModal] = useState<{ id: number; name: string; plain_key: string; copied?: boolean } | null>(null);

  useEffect(() => {
    loadKeys();
  }, []);

  const loadKeys = async () => {
    try {
      const data = await api.getHubKeys();
      setKeys(data);
    } catch (err) {
      console.error('Failed to load keys:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (name: string, allowedModels?: string[] | null) => {
    try {
      const result = await api.createHubKey({ name, allowed_models: allowedModels ?? null });
      await loadKeys();
      setShowCreate(false);
      if (result.plain_key) {
        setPlainKeyModal({ id: result.id, name: result.name, plain_key: result.plain_key });
      }
    } catch (err: any) {
      alert(`创建失败: ${err.message}`);
    }
  };

  const handleRegenerate = async (id: number, name: string) => {
    if (!confirm('确定要重新生成此 Key 吗？旧 Key 将立即失效。')) return;
    try {
      const result = await api.regenerateHubKey(id);
      await loadKeys();
      if (result.plain_key) {
        setPlainKeyModal({ id: result.id, name, plain_key: result.plain_key });
      }
    } catch (err: any) {
      alert(`操作失败: ${err.message}`);
    }
  };

  const handleToggle = async (id: number) => {
    try {
      await api.toggleHubKey(id);
      await loadKeys();
    } catch (err: any) {
      alert(`操作失败: ${err.message}`);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除此 Key 吗？')) return;
    try {
      await api.deleteHubKey(id);
      await loadKeys();
    } catch (err: any) {
      alert(`删除失败: ${err.message}`);
    }
  };

  const handleShowPlain = async (id: number, name: string) => {
    try {
      const result = await api.getHubKeyPlain(id);
      setPlainKeyModal({ id, name, plain_key: result.plain_key });
    } catch (err: any) {
      alert(`获取失败: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Hub Keys</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">管理客户端访问密钥</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={18} />
          创建 Key
        </button>
      </div>

      {/* API 地址 */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-500/10">
            <Globe size={18} className="text-blue-500 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">API 地址</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">将以下地址和 Key 配置到你的客户端中</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ApiEndpointRow
            label="OpenAI 兼容"
            path="/v1"
            hint="适用于 ChatGPT、Claude API 等客户端"
          />
          <ApiEndpointRow
            label="Anthropic 兼容"
            path="/v1"
            hint="适用于 Claude Code、Anthropic SDK"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
        {keys.map((key, index) => (
          <div
            key={key.id}
            className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6 card-hover animate-slide-up"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shrink-0">
                    <Key size={16} className="text-white" />
                  </div>
                  <h3 className="font-semibold text-slate-900 dark:text-white truncate">{key.name}</h3>
                </div>
                <p className="text-xs text-slate-400 font-mono mt-2 ml-9 truncate">{key.prefix}••••••••</p>
                <div className="mt-2 ml-9">
                  <ModelScopeBadge models={key.allowed_models_parsed} />
                </div>
              </div>
              <span
                className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                  key.enabled
                    ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                    : 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400'
                }`}
              >
                {key.enabled ? '启用' : '禁用'}
              </span>
            </div>

            <div className="space-y-3 mb-4 sm:mb-5">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500 dark:text-slate-400">最后使用</span>
                <span className="text-sm text-slate-900 dark:text-white">
                  {key.last_used_at ? new Date(key.last_used_at).toLocaleString() : '从未'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500 dark:text-slate-400">创建时间</span>
                <span className="text-sm text-slate-900 dark:text-white">
                  {new Date(key.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-4 border-t border-slate-100 dark:border-slate-700/50">
              <button
                onClick={() => handleShowPlain(key.id, key.name)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 rounded-xl transition-colors"
                title="查看完整 Key"
              >
                <Eye size={14} />
                查看
              </button>
              <button
                onClick={() => handleToggle(key.id)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 rounded-xl transition-colors"
                title={key.enabled ? '禁用' : '启用'}
              >
                {key.enabled ? <PowerOff size={14} /> : <Power size={14} />}
                {key.enabled ? '禁用' : '启用'}
              </button>
              <button
                onClick={() => handleRegenerate(key.id, key.name)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 rounded-xl transition-colors"
                title="重新生成"
              >
                <RefreshCw size={14} />
                重置
              </button>
              <button
                onClick={() => handleDelete(key.id)}
                className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                title="删除"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {keys.length === 0 && (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center mx-auto mb-4">
            <Key size={24} className="text-slate-400" />
          </div>
          <p className="text-slate-500 dark:text-slate-400">暂无 Hub Keys</p>
          <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">点击"创建 Key"开始</p>
        </div>
      )}

      {showCreate && (
        <CreateKeyModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />
      )}

      {plainKeyModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md animate-scale-in border border-slate-200/50 dark:border-slate-700/50">
            <div className="p-4 sm:p-6 border-b border-slate-200/50 dark:border-slate-700/50 flex items-center justify-between">
              <h3 className="text-xl font-semibold text-slate-900 dark:text-white">Key 已生成</h3>
              <button onClick={() => setPlainKeyModal(null)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-sm font-medium mb-2">
                  ⚠️ 请立即保存此 Key
                </div>
                <p className="text-sm text-amber-600/80 dark:text-amber-400/80">此 Key 不会再次显示，请妥善保管。</p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-700/30 border border-slate-200 dark:border-slate-600">
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Key: {plainKeyModal.name}</div>
                <code className="text-sm font-mono text-slate-900 dark:text-white break-all">{plainKeyModal.plain_key}</code>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={async () => {
                    const success = await copyToClipboard(plainKeyModal.plain_key);
                    if (success) {
                      setPlainKeyModal({ ...plainKeyModal, copied: true });
                      setTimeout(() => {
                        setPlainKeyModal((prev) => prev ? { ...prev, copied: false } : null);
                      }, 2000);
                    }
                  }}
                  className="btn-secondary flex items-center gap-2"
                >
                  <Copy size={14} />
                  {plainKeyModal.copied ? '已复制' : '复制'}
                </button>
                <button onClick={() => setPlainKeyModal(null)} className="btn-primary">
                  我已保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ApiEndpointRow({ label, path, hint }: { label: string; path: string; hint: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const url = window.location.origin + path;

  const handleCopy = async () => {
    const success = await copyToClipboard(url);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setError(true);
      setTimeout(() => setError(false), 2000);
    }
  };

  return (
    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-700/30 border border-slate-200 dark:border-slate-600">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-900 dark:text-white">{label}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:text-indigo-600 hover:border-indigo-200"
        >
          {copied ? (
            <CheckCircle2 size={12} className="text-emerald-500" />
          ) : error ? (
            <X size={12} className="text-red-500" />
          ) : (
            <Copy size={12} />
          )}
          {copied ? '已复制' : error ? '失败' : '复制'}
        </button>
      </div>
      <code className="block text-xs font-mono text-slate-600 dark:text-slate-300 break-all mb-2">{url}</code>
      <p className="text-xs text-slate-400 dark:text-slate-500">{hint}</p>
    </div>
  );
}

function CreateKeyModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, allowedModels?: string[] | null) => void;
}) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [restrict, setRestrict] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    api.getGlobalModels().then(setModels).catch(() => setModels([]));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const allowed = restrict && selected.size > 0 ? Array.from(selected) : null;
    await onCreate(name, allowed);
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] animate-scale-in border border-slate-200/50 dark:border-slate-700/50 overflow-hidden flex flex-col">
        <div className="p-4 sm:p-6 border-b border-slate-200/50 dark:border-slate-700/50 flex items-center justify-between shrink-0">
          <h3 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white truncate">创建 Hub Key</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 shrink-0">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Key 名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
              placeholder="例如: My App Key"
              required
            />
          </div>

          <div>
            <label className="flex items-center justify-between cursor-pointer mb-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">限制可调用的模型</span>
              <input
                type="checkbox"
                checked={restrict}
                onChange={(e) => setRestrict(e.target.checked)}
                className="w-4 h-4 rounded accent-indigo-600"
              />
            </label>
            <p className="text-xs text-slate-400 mb-2">
              {restrict
                ? '该 Key 只能调用勾选的模型，调用其他模型会返回 403'
                : '不勾选 = 该 Key 可调用全部模型'}
            </p>

            {restrict && (
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-700/40 border-b border-slate-200 dark:border-slate-700">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {models.length === 0 ? '暂无模型' : `已选 ${selected.size} / ${models.length}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelected(selected.size === models.length ? new Set() : new Set(models))}
                    className="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                  >
                    {selected.size === models.length && models.length > 0 ? '清空' : '全选'}
                  </button>
                </div>
                {models.length === 0 ? (
                  <div className="px-4 py-4 text-xs text-slate-400">
                    没有可用模型。请先在「渠道」页面配置并启用渠道。
                  </div>
                ) : (
                  <div className="max-h-56 overflow-y-auto py-1">
                    {models.map((m) => (
                      <label
                        key={m}
                        className="flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(m)}
                          onChange={() => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(m)) next.delete(m); else next.add(m);
                              return next;
                            });
                          }}
                          className="w-4 h-4 rounded accent-indigo-600"
                        />
                        <code className="text-xs text-slate-700 dark:text-slate-300 font-mono truncate">{m}</code>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="btn-secondary">
              取消
            </button>
            <button type="submit" disabled={loading || (restrict && selected.size === 0)} className="btn-primary">
              {loading ? '创建中...' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** 展示 Hub Key 的模型权限范围 */
function ModelScopeBadge({ models }: { models?: string[] | null }) {
  const count = Array.isArray(models) && models.length > 0 ? models.length : 0;
  if (count === 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400 text-xs font-medium" title="不限制，可调用全部模型">
        全部模型
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400 text-xs font-medium"
      title={`只能调用: ${models!.join(', ')}`}
    >
      仅 {count} 个模型
      {count <= 2 && <span className="font-mono opacity-80">（{models!.join(', ')}）</span>}
    </span>
  );
}
