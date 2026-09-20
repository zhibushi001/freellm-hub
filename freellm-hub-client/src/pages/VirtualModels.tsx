import { useState, useEffect, useCallback } from 'react';
import { api, VirtualModel, ModelCandidate, Key } from '../api';
import {
  Plus, Trash2, X, ArrowLeft, Layers, Grip, Pin,
  ToggleLeft, ToggleRight, ChevronRight, Loader2,
} from 'lucide-react';

export default function VirtualModels() {
  const [models, setModels] = useState<VirtualModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<VirtualModel | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);
  const [form, setForm] = useState({ name: '', display_name: '', description: '', enabled: true });

  const load = useCallback(async () => {
    try { setModels(await api.getVirtualModels()); }
    catch (e) { setMessage({ type: 'error', text: '加载失败：' + (e as Error).message }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm({ name: '', display_name: '', description: '', enabled: true }); setShowForm(true); };
  const openEdit = (m: VirtualModel) => {
    setEditing(m);
    setForm({ name: m.name, display_name: m.display_name || '', description: m.description || '', enabled: !!m.enabled });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), display_name: form.display_name.trim() || null, description: form.description.trim() || null, enabled: form.enabled };
      if (editing) await api.updateVirtualModel(editing.id, payload);
      else await api.createVirtualModel(payload);
      await load();
      setMessage({ type: 'success', text: editing ? '虚拟模型已更新' : '虚拟模型已创建' });
      setShowForm(false);
    } catch (err) { setMessage({ type: 'error', text: (err as Error).message }); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此虚拟模型及其所有候选？')) return;
    try { await api.deleteVirtualModel(id); await load(); setMessage({ type: 'success', text: '已删除' }); }
    catch (e) { setMessage({ type: 'error', text: (e as Error).message }); }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;
  }

  if (detailId) {
    return <ModelDetail id={detailId} onBack={() => { setDetailId(null); load(); }} onChanged={() => load()} message={message} setMessage={setMessage} />;
  }

  return (
    <div className="space-y-4 md:space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">虚拟模型</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm md:text-base">一个模型名背后挂多个上游候选，按优先级/权重路由</p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2"><Plus size={18} />添加模型</button>
      </div>

      {message && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium ${
          message.type === 'success' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
        }`}>{message.text}</div>
      )}

      {models.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6 text-center py-12">
          <Layers size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-slate-500 dark:text-slate-400 mb-4">暂无虚拟模型</p>
          <button onClick={openCreate} className="btn-primary inline-flex items-center gap-2"><Plus size={16} />添加第一个</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
          {models.map((m) => (
            <div key={m.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6 hover:shadow-lg transition-shadow">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <button onClick={() => setDetailId(m.id)} className="flex items-center gap-2 group min-w-0">
                    <code className="font-semibold text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400" title={m.name}>{m.name}</code>
                    <ChevronRight size={16} className="text-slate-300 shrink-0 group-hover:text-indigo-400" />
                  </button>
                  {m.display_name && m.display_name !== m.name && (
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate">{m.display_name}</p>
                  )}
                  {m.description && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 break-words line-clamp-2">{m.description}</p>
                  )}
                </div>
                <button onClick={() => openEdit(m)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 shrink-0">
                  {m.enabled ? <ToggleRight size={20} className="text-emerald-500" /> : <ToggleLeft size={20} className="text-slate-300" />}
                </button>
              </div>
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/50">
                <span className="text-sm text-slate-500 dark:text-slate-400 inline-flex items-center gap-1.5">
                  <Grip size={14} />{m.candidate_count} 个候选
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setDetailId(m.id)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline px-2 py-1">管理候选</button>
                  <button onClick={() => openEdit(m)} className="text-slate-400 hover:text-indigo-600 p-1.5"><Layers size={15} /></button>
                  <button onClick={() => handleDelete(m.id)} className="text-slate-400 hover:text-red-500 p-1.5"><Trash2 size={15} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4 overflow-x-hidden">
          <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] border border-slate-200/50 dark:border-slate-700/50 overflow-hidden flex flex-col">
            <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-200/50 dark:border-slate-700/50 flex items-center justify-between shrink-0">
              <h3 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white truncate">{editing ? '编辑虚拟模型' : '添加虚拟模型'}</h3>
              <button type="button" onClick={() => setShowForm(false)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 shrink-0"><X size={18} /></button>
            </div>
            <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">模型名（API 调用时使用）</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none"
                  placeholder="例如：best-model" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">显示名称（可选）</label>
                <input type="text" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none"
                  placeholder="例如：最佳模型" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">描述</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none resize-none"
                  placeholder="用途说明" />
              </div>
              <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer">
                <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="w-4 h-4 rounded accent-indigo-600" />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">启用</span>
              </label>
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

function ModelDetail({ id, onBack, onChanged, message, setMessage }: {
  id: number;
  onBack: () => void;
  onChanged: () => void;
  message: { type: string; text: string } | null;
  setMessage: (m: { type: string; text: string } | null) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [model, setModel] = useState<VirtualModel | null>(null);
  const [candidates, setCandidates] = useState<ModelCandidate[]>([]);
  const [keys, setKeys] = useState<Key[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addForm, setAddForm] = useState({ key_id: 0, upstream_model: '', priority: 0, weight: 1 });

  const load = useCallback(async () => {
    try {
      const [res, ks] = await Promise.all([api.getVirtualModel(id), api.getAvailableKeys()]);
      setModel(res.model);
      setCandidates(res.candidates);
      setKeys(ks);
    } catch (e) { setMessage({ type: 'error', text: '加载失败：' + (e as Error).message }); }
    finally { setLoading(false); }
  }, [id, setMessage]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.key_id || !addForm.upstream_model.trim()) return;
    setSaving(true);
    try {
      await api.addModelCandidate(id, addForm);
      await load();
      setShowAdd(false);
      setAddForm({ key_id: 0, upstream_model: '', priority: 0, weight: 1 });
      setMessage({ type: 'success', text: '候选已添加' });
      onChanged();
    } catch (err) { setMessage({ type: 'error', text: (err as Error).message }); }
    finally { setSaving(false); }
  };

  const handleToggle = async (c: ModelCandidate, field: 'enabled' | 'pinned', value: boolean) => {
    try { await api.updateModelCandidate(c.id, { [field]: value }); await load(); onChanged(); }
    catch (e) { setMessage({ type: 'error', text: (e as Error).message }); }
  };

  const handleDelete = async (cid: number) => {
    if (!confirm('确定删除此候选？')) return;
    try { await api.deleteModelCandidate(cid); await load(); setMessage({ type: 'success', text: '已删除' }); onChanged(); }
    catch (e) { setMessage({ type: 'error', text: (e as Error).message }); }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;
  }

  if (!model) {
    return <div className="flex items-center justify-center h-64 text-slate-400">模型不存在</div>;
  }

  return (
    <div className="space-y-4 md:space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400">
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight truncate" title={model.name}>{model.name}</h1>
          {model.display_name && <p className="text-slate-500 dark:text-slate-400 text-sm truncate">{model.display_name}</p>}
        </div>
        <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap ${model.enabled ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-slate-100 text-slate-400 dark:bg-slate-700'}`}>
          {model.enabled ? '启用' : '停用'}
        </span>
      </div>

      {model.description && (
        <p className="text-slate-500 dark:text-slate-400 text-sm break-words">{model.description}</p>
      )}

      {message && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium ${
          message.type === 'success' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
        }`}>{message.text}</div>
      )}

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">候选列表（{candidates.length}）</h2>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2"><Plus size={16} />添加候选</button>
      </div>

      {candidates.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6 text-center py-12">
          <Grip size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-slate-500 dark:text-slate-400 mb-4">暂无候选。添加一个上游 Key + 模型组合。</p>
          <button onClick={() => setShowAdd(true)} className="btn-primary inline-flex items-center gap-2"><Plus size={16} />添加候选</button>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200/50 dark:border-slate-700/50">
                  <th className="text-left px-3 sm:px-6 py-3 font-medium text-slate-500 dark:text-slate-400">优先级</th>
                  <th className="text-left px-3 sm:px-6 py-3 font-medium text-slate-500 dark:text-slate-400">上游模型</th>
                  <th className="text-left px-3 sm:px-6 py-3 font-medium text-slate-500 dark:text-slate-400">Key / 渠道</th>
                  <th className="text-center px-3 sm:px-6 py-3 font-medium text-slate-500 dark:text-slate-400">权重</th>
                  <th className="text-center px-3 sm:px-6 py-3 font-medium text-slate-500 dark:text-slate-400">状态</th>
                  <th className="text-right px-3 sm:px-6 py-3 font-medium text-slate-500 dark:text-slate-400">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {candidates.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <td className="px-3 sm:px-6 py-4">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-semibold text-xs">P{c.priority}</span>
                    </td>
                    <td className="px-3 sm:px-6 py-4"><code className="text-slate-900 dark:text-white truncate block max-w-[100px] sm:max-w-xs" title={c.upstream_model}>{c.upstream_model}</code></td>
                    <td className="px-3 sm:px-6 py-4">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate text-slate-600 dark:text-slate-400" title={c.key_label || `Key #${c.key_id}`}>{c.key_label || `Key #${c.key_id}`}</span>
                        {c.pinned === 1 && <Pin size={12} className="text-amber-500 shrink-0" />}
                      </span>
                      <span className="text-xs text-slate-400 truncate block max-w-[120px] sm:max-w-xs">{c.provider_display_name || c.provider_name || ''}</span>
                    </td>
                    <td className="px-3 sm:px-6 py-4 text-center text-slate-600 dark:text-slate-300">{c.weight}</td>
                    <td className="px-3 sm:px-6 py-4 text-center">
                      <button onClick={() => handleToggle(c, 'enabled', c.enabled === 0)} title={c.enabled ? '点击停用' : '点击启用'}>
                        {c.enabled ? <ToggleRight size={22} className="text-emerald-500 mx-auto" /> : <ToggleLeft size={22} className="text-slate-300 mx-auto" />}
                      </button>
                    </td>
                    <td className="px-3 sm:px-6 py-4 text-right whitespace-nowrap">
                      <button onClick={() => handleToggle(c, 'pinned', c.pinned === 0)} title={c.pinned ? '取消置顶' : '置顶'} className={`p-1.5 ${c.pinned ? 'text-amber-500' : 'text-slate-400 hover:text-amber-500'}`}><Pin size={15} /></button>
                      <button onClick={() => handleDelete(c.id)} className="text-slate-400 hover:text-red-500 p-1.5"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4 overflow-x-hidden">
          <form onSubmit={handleAdd} className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] border border-slate-200/50 dark:border-slate-700/50 overflow-hidden flex flex-col">
            <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-200/50 dark:border-slate-700/50 flex items-center justify-between shrink-0">
              <h3 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white truncate">添加候选</h3>
              <button type="button" onClick={() => setShowAdd(false)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 shrink-0"><X size={18} /></button>
            </div>
            <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">选择 Key</label>
                <select value={addForm.key_id || ''} onChange={(e) => setAddForm({ ...addForm, key_id: parseInt(e.target.value) })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none min-w-0" required>
                  <option value="" disabled>选择 Key...</option>
                  {keys.map((k) => (
                    <option key={k.id} value={k.id}>{k.label || `Key #${k.id}`}</option>
                  ))}
                </select>
                {keys.length === 0 && <p className="text-xs text-amber-500 mt-1">没有可用的 Key（需启用且状态正常）</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">上游模型名</label>
                <input type="text" value={addForm.upstream_model} onChange={(e) => setAddForm({ ...addForm, upstream_model: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none"
                  placeholder="例如：sensenova-6.8-flash-lite" required />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">优先级（越小越优先）</label>
                  <input type="number" min={0} value={addForm.priority} onChange={(e) => setAddForm({ ...addForm, priority: parseInt(e.target.value) || 0 })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">权重</label>
                  <input type="number" min={0} step={0.5} value={addForm.weight} onChange={(e) => setAddForm({ ...addForm, weight: parseFloat(e.target.value) || 0 })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none" />
                </div>
              </div>
            </div>
            <div className="px-4 sm:px-6 py-4 sm:py-5 border-t border-slate-200/50 dark:border-slate-700/50 flex justify-end gap-3 shrink-0">
              <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary">取消</button>
              <button type="submit" disabled={saving || !addForm.key_id} className="btn-primary disabled:opacity-50">{saving ? <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />保存中...</span> : '添加'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
