import { useState, useEffect, useCallback } from 'react';
import { api, FallbackConfig } from '../api';
import { Plus, Trash2, ToggleLeft, ToggleRight, X, GitBranch, ArrowRight, Grip } from 'lucide-react';

export default function Fallback() {
  const [configs, setConfigs] = useState<FallbackConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<FallbackConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);
  const [form, setForm] = useState({
    primaryModel: '',
    fallbackModels: [] as string[],
    strategy: 'sequential' as FallbackConfig['strategy'],
    enabled: true,
    maxRetries: 2,
    retryDelayMs: 1000,
  });
  const [models, setModels] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const data = await api.getFallbackConfigs();
      setConfigs(data);
    } catch (e) {
      setMessage({ type: 'error', text: '加载失败：' + (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    api.getGlobalModels().then(setModels).catch(() => {});
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ primaryModel: '', fallbackModels: [], strategy: 'sequential', enabled: true, maxRetries: 2, retryDelayMs: 1000 });
    setShowForm(true);
  };

  const openEdit = (c: FallbackConfig) => {
    setEditing(c);
    setForm({
      primaryModel: c.primaryModel,
      fallbackModels: c.fallbackModels,
      strategy: c.strategy,
      enabled: c.enabled,
      maxRetries: c.maxRetries,
      retryDelayMs: c.retryDelayMs,
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.primaryModel.trim()) return;
    setSaving(true);
    try {
      await api.createFallback({
        primary_model: form.primaryModel.trim(),
        fallback_models: form.fallbackModels.filter((m) => m.trim()),
        strategy: form.strategy,
        enabled: form.enabled,
        max_retries: form.maxRetries,
        retry_delay_ms: form.retryDelayMs,
      });
      await load();
      setMessage({ type: 'success', text: editing ? '回退配置已更新' : '回退配置已创建' });
      setShowForm(false);
    } catch (err) {
      setMessage({ type: 'error', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此回退配置？')) return;
    try {
      await api.deleteFallback(id);
      await load();
      setMessage({ type: 'success', text: '已删除' });
    } catch (e) {
      setMessage({ type: 'error', text: (e as Error).message });
    }
  };

  const toggleModel = (m: string) => {
    setForm((f) => ({
      ...f,
      fallbackModels: f.fallbackModels.includes(m) ? f.fallbackModels.filter((x) => x !== m) : [...f.fallbackModels, m],
    }));
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;
  }

  return (
    <div className="space-y-4 md:space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">故障转移</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm md:text-base">主模型不可用时自动切换到备用模型链</p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2"><Plus size={18} />添加规则</button>
      </div>

      {message && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium ${
          message.type === 'success' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
        }`}>{message.text}</div>
      )}

      {configs.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6 text-center py-12">
          <GitBranch size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-slate-500 dark:text-slate-400 mb-4">暂无回退配置</p>
          <button onClick={openCreate} className="btn-primary inline-flex items-center gap-2"><Plus size={16} />添加第一条规则</button>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/50">
          {configs.map((c) => (
            <div key={c.id} className="p-3 sm:p-4 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
              <div className="flex items-center gap-3">
                <button onClick={() => openEdit(c)} className="text-slate-400 hover:text-slate-600 shrink-0" title="编辑">
                  {c.enabled ? <ToggleRight size={28} className="text-emerald-500" /> : <ToggleLeft size={28} className="text-slate-300" />}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <code className="font-semibold text-slate-900 dark:text-white truncate" title={c.primaryModel}>{c.primaryModel}</code>
                    <ArrowRight size={14} className="text-slate-400 shrink-0" />
                    {c.fallbackModels.length > 0 ? (
                      <span className="flex items-center gap-1.5 flex-wrap min-w-0">
                        {c.fallbackModels.map((m, i) => (
                          <span key={i} className="inline-flex items-center gap-1">
                            {i > 0 && <Grip size={10} className="text-slate-300" />}
                            <code className="text-sm text-slate-600 dark:text-slate-400 truncate" title={m}>{m}</code>
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-sm text-slate-400">无备用</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                      {c.strategy === 'sequential' ? '顺序' : c.strategy === 'weighted' ? '加权' : '优先级'}
                    </span>
                    <span className="text-xs text-slate-400">重试 {c.maxRetries} 次</span>
                    <span className="text-xs text-slate-400">间隔 {c.retryDelayMs}ms</span>
                  </div>
                </div>

                <button onClick={() => openEdit(c)} className="text-slate-400 hover:text-indigo-600 p-2 shrink-0">
                  <GitBranch size={18} />
                </button>
                <button onClick={() => handleDelete(c.id)} className="text-slate-400 hover:text-red-500 p-2 shrink-0">
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4 overflow-x-hidden">
          <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] border border-slate-200/50 dark:border-slate-700/50 overflow-hidden flex flex-col">
            <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-200/50 dark:border-slate-700/50 flex items-center justify-between shrink-0">
              <h3 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white truncate">{editing ? '编辑回退规则' : '添加回退规则'}</h3>
              <button type="button" onClick={() => setShowForm(false)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 shrink-0"><X size={18} /></button>
            </div>
            <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">主模型</label>
                <input type="text" value={form.primaryModel} onChange={(e) => setForm({ ...form, primaryModel: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none"
                  placeholder="例如：gpt-4o" required />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">备用模型（按顺序尝试）</label>
                <input type="text" value={form.primaryModel ? '' : ''} onChange={() => {}} className="hidden" />
                <div className="space-y-2">
                  {form.fallbackModels.map((m, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 w-5 shrink-0">{i + 1}.</span>
                      <input type="text" value={m} onChange={(e) => {
                        const arr = [...form.fallbackModels]; arr[i] = e.target.value; setForm({ ...form, fallbackModels: arr });
                      }} className="flex-1 min-w-0 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none"
                        placeholder="模型 ID" />
                      <button type="button" onClick={() => setForm({ ...form, fallbackModels: form.fallbackModels.filter((_, j) => j !== i) })} className="text-slate-400 hover:text-red-500 shrink-0"><X size={16} /></button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setForm({ ...form, fallbackModels: [...form.fallbackModels, ''] })} className="mt-2 text-sm text-indigo-600 hover:text-indigo-700 flex items-center gap-1"><Plus size={14} />添加备用模型</button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">策略</label>
                  <select value={form.strategy} onChange={(e) => setForm({ ...form, strategy: e.target.value as FallbackConfig['strategy'] })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none min-w-0">
                    <option value="sequential">顺序（逐个尝试）</option>
                    <option value="weighted">加权（按权重）</option>
                    <option value="priority">优先级（按优先级）</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">最大重试次数</label>
                  <input type="number" min={0} max={10} value={form.maxRetries} onChange={(e) => setForm({ ...form, maxRetries: parseInt(e.target.value) || 0 })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">重试间隔 (ms)</label>
                  <input type="number" min={0} value={form.retryDelayMs} onChange={(e) => setForm({ ...form, retryDelayMs: parseInt(e.target.value) || 0 })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none" />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer w-full">
                    <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="w-4 h-4 rounded accent-indigo-600" />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">启用</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="px-4 sm:px-6 py-4 sm:py-5 border-t border-slate-200/50 dark:border-slate-700/50 flex justify-end gap-3 shrink-0">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">取消</button>
              <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">{saving ? '保存中...' : '保存'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
