import { useState, useEffect, useCallback } from 'react';
import { api, ModelMapping } from '../api';
import { Plus, Trash2, X, ArrowRight, GitCommitHorizontal, Eye } from 'lucide-react';

export default function ModelMappings() {
  const [mappings, setMappings] = useState<ModelMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ModelMapping | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);
  const [form, setForm] = useState({ from_model: '', to_model: '', enabled: true });
  const [previewModel, setPreviewModel] = useState('');
  const [previewResult, setPreviewResult] = useState<{ original: string; mapped: string | null; chain?: string[]; error?: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const load = useCallback(async () => {
    try { setMappings(await api.getModelMappings()); }
    catch (e) { setMessage({ type: 'error', text: '加载失败：' + (e as Error).message }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm({ from_model: '', to_model: '', enabled: true }); setShowForm(true); };
  const openEdit = (m: ModelMapping) => { setEditing(m); setForm({ from_model: m.from_model, to_model: m.to_model, enabled: !!m.enabled }); setShowForm(true); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.from_model.trim() || !form.to_model.trim()) return;
    setSaving(true);
    try {
      const payload = { from_model: form.from_model.trim(), to_model: form.to_model.trim(), enabled: form.enabled };
      if (editing) await api.updateModelMapping(editing.id, payload);
      else await api.createModelMapping(payload);
      await load();
      setMessage({ type: 'success', text: editing ? '映射已更新' : '映射已创建' });
      setShowForm(false);
    } catch (err) { setMessage({ type: 'error', text: (err as Error).message }); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此映射？')) return;
    try { await api.deleteModelMapping(id); await load(); setMessage({ type: 'success', text: '已删除' }); }
    catch (e) { setMessage({ type: 'error', text: (e as Error).message }); }
  };

  const handlePreview = async () => {
    if (!previewModel.trim()) return;
    setPreviewing(true);
    try { setPreviewResult(await api.previewModelMapping(previewModel.trim())); }
    catch (e) { setMessage({ type: 'error', text: (e as Error).message }); }
    finally { setPreviewing(false); }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;
  }

  return (
    <div className="space-y-4 md:space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">模型映射</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm md:text-base">将请求模型名映射到实际上游模型（支持链式）</p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2"><Plus size={18} />添加映射</button>
      </div>

      {message && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium ${
          message.type === 'success' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
        }`}>{message.text}</div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 sm:mb-5 flex items-center gap-2"><Eye size={18} />映射预览</h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <input type="text" value={previewModel} onChange={(e) => { setPreviewModel(e.target.value); setPreviewResult(null); }}
            onKeyDown={(e) => e.key === 'Enter' && handlePreview()}
            placeholder="输入模型名，例如 gpt-4o"
            className="flex-1 min-w-0 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none" />
          <button onClick={handlePreview} disabled={previewing} className="btn-secondary shrink-0 disabled:opacity-50">
            {previewing ? '查询中...' : '预览'}
          </button>
        </div>
        {previewResult && (
          <div className="mt-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-700/30 text-sm">
            {previewResult.error ? (
              <span className="text-red-600 dark:text-red-400">{previewResult.error}</span>
            ) : previewResult.mapped ? (
              <span className="flex items-center gap-2 flex-wrap">
                <code className="text-slate-500 line-through">{previewResult.original}</code>
                <ArrowRight size={14} className="text-slate-400" />
                <code className="font-semibold text-emerald-600 dark:text-emerald-400">{previewResult.mapped}</code>
                {previewResult.chain && previewResult.chain.length > 2 && (
                  <span className="text-xs text-slate-400 w-full mt-1 flex items-center gap-1 flex-wrap">
                    <GitCommitHorizontal size={12} />
                    映射链：
                    {previewResult.chain.map((c, i) => (
                      <span key={i} className="inline-flex items-center gap-1">
                        {i > 0 && <ArrowRight size={10} />}
                        <code>{c}</code>
                      </span>
                    ))}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-slate-400">「{previewResult.original}」无映射，将直接透传</span>
            )}
          </div>
        )}
      </div>

      {mappings.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6 text-center py-12">
          <GitCommitHorizontal size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-slate-500 dark:text-slate-400 mb-4">暂无模型映射</p>
          <button onClick={openCreate} className="btn-primary inline-flex items-center gap-2"><Plus size={16} />添加第一条映射</button>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200/50 dark:border-slate-700/50">
                  <th className="text-left px-3 sm:px-6 py-3 font-medium text-slate-500 dark:text-slate-400">请求模型</th>
                  <th className="text-left px-3 sm:px-6 py-3 font-medium text-slate-500 dark:text-slate-400">映射到</th>
                  <th className="text-center px-3 sm:px-6 py-3 font-medium text-slate-500 dark:text-slate-400">状态</th>
                  <th className="text-right px-3 sm:px-6 py-3 font-medium text-slate-500 dark:text-slate-400">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {mappings.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <td className="px-3 sm:px-6 py-4"><code className="text-slate-900 dark:text-white truncate block max-w-[120px] sm:max-w-xs" title={m.from_model}>{m.from_model}</code></td>
                    <td className="px-3 sm:px-6 py-4">
                      <span className="flex items-center gap-1.5">
                        <ArrowRight size={12} className="text-slate-300 shrink-0" />
                        <code className="text-emerald-600 dark:text-emerald-400 truncate" title={m.to_model}>{m.to_model}</code>
                      </span>
                    </td>
                    <td className="px-3 sm:px-6 py-4 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap ${m.enabled ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-slate-100 text-slate-400 dark:bg-slate-700'}`}>
                        {m.enabled ? '启用' : '停用'}
                      </span>
                    </td>
                    <td className="px-3 sm:px-6 py-4 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(m)} className="text-slate-400 hover:text-indigo-600 p-1.5"><GitCommitHorizontal size={16} /></button>
                      <button onClick={() => handleDelete(m.id)} className="text-slate-400 hover:text-red-500 p-1.5"><Trash2 size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4 overflow-x-hidden">
          <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] border border-slate-200/50 dark:border-slate-700/50 overflow-hidden flex flex-col">
            <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-200/50 dark:border-slate-700/50 flex items-center justify-between shrink-0">
              <h3 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white truncate">{editing ? '编辑映射' : '添加映射'}</h3>
              <button type="button" onClick={() => setShowForm(false)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 shrink-0"><X size={18} /></button>
            </div>
            <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">请求模型名（from）</label>
                <input type="text" value={form.from_model} onChange={(e) => setForm({ ...form, from_model: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none"
                  placeholder="例如：gpt-4o" required />
              </div>
              <div className="flex items-center justify-center">
                <ArrowRight size={20} className="text-slate-300 rotate-90" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">上游模型名（to）</label>
                <input type="text" value={form.to_model} onChange={(e) => setForm({ ...form, to_model: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none"
                  placeholder="例如：sensenova-6.8-flash-lite" required />
              </div>
              <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer">
                <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="w-4 h-4 rounded accent-indigo-600" />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">启用映射</span>
              </label>
              <p className="text-xs text-slate-400 break-words">支持链式映射：A→B、B→C，请求 A 将最终解析为 C。</p>
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
