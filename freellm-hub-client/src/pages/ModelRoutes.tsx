import { useState, useEffect } from 'react';
import { api, ModelRoute } from '../api';
import { Plus, Trash2, ToggleLeft, ToggleRight, X, GitBranch } from 'lucide-react';

export default function ModelRoutes() {
  const [routes, setRoutes] = useState<ModelRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<ModelRoute | null>(null);

  useEffect(() => {
    loadRoutes();
  }, []);

  const loadRoutes = async () => {
    try {
      const data = await api.getModelRoutes();
      setRoutes(data);
    } catch (err) {
      console.error('Failed to load routes:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除此路由规则吗？')) return;
    try {
      await api.deleteModelRoute(id);
      await loadRoutes();
    } catch (err: any) {
      alert(`删除失败: ${err.message}`);
    }
  };

  const handleToggle = async (route: ModelRoute) => {
    try {
      await api.updateModelRoute(route.id, { enabled: route.enabled === 1 ? 0 : 1 });
      await loadRoutes();
    } catch (err: any) {
      alert(`操作失败: ${err.message}`);
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
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">模型路由</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1 md:mt-2 text-sm md:text-base">配置模型路由规则，将请求定向到指定渠道</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={18} />
          添加规则
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
        {routes.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center mx-auto mb-4">
              <GitBranch size={24} className="text-slate-400" />
            </div>
            <p className="text-slate-500 dark:text-slate-400">暂无路由规则</p>
            <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">点击"添加规则"创建第一个</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {routes.map((route) => (
              <div key={route.id} className="p-3 sm:p-4 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleToggle(route)}
                    className="text-slate-400 hover:text-slate-600 shrink-0"
                  >
                    {route.enabled === 1 ? (
                      <ToggleRight size={28} className="text-emerald-500" />
                    ) : (
                      <ToggleLeft size={28} className="text-slate-300" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-slate-900 dark:text-white truncate" title={route.model_pattern || route.request_model}>{route.model_pattern || route.request_model}</span>
                      <span className="text-sm text-slate-400 shrink-0">→</span>
                      <span className="text-sm text-slate-600 dark:text-slate-400 truncate">
                        {route.target_channel_id ? `渠道 #${route.target_channel_id}` : '任意渠道'}
                      </span>
                    </div>
                    {(route.description || route.notes) && (
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 break-words">{route.description || route.notes}</p>
                    )}
                  </div>

                  <div className="hidden sm:block text-right shrink-0">
                    <span className="text-sm text-slate-500 dark:text-slate-400">优先级</span>
                    <div className="font-medium text-slate-900 dark:text-white">{route.priority}</div>
                  </div>

                  <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                    <button
                      onClick={() => setEditing(route)}
                      className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors"
                      title="编辑"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(route.id)}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                      title="删除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateRouteModal
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await loadRoutes();
          }}
        />
      )}

      {editing && (
        <EditRouteModal
          route={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await loadRoutes();
          }}
        />
      )}
    </div>
  );
}

function CreateRouteModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    model_pattern: '',
    target_channel_id: 1,
    target_key_id: '',
    priority: 0,
    description: '',
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.createModelRoute({
        model_pattern: form.model_pattern,
        target_channel_id: form.target_channel_id,
        target_key_id: form.target_key_id ? parseInt(form.target_key_id) : undefined,
        priority: form.priority,
        description: form.description,
      });
      onCreated();
    } catch (err: any) {
      alert(`创建失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] animate-scale-in border border-slate-200/50 dark:border-slate-700/50 overflow-hidden flex flex-col">
        <div className="p-4 sm:p-6 border-b border-slate-200/50 dark:border-slate-700/50 flex items-center justify-between shrink-0">
          <h3 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white truncate">添加路由规则</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 shrink-0">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">模型匹配模式</label>
            <input
              type="text"
              value={form.model_pattern}
              onChange={(e) => setForm({ ...form, model_pattern: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
              placeholder="gpt-4o 或 gpt-*"
              required
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">目标渠道 ID</label>
              <input
                type="number"
                value={form.target_channel_id}
                onChange={(e) => setForm({ ...form, target_channel_id: parseInt(e.target.value) || 1 })}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">目标 Key ID (可选)</label>
              <input
                type="number"
                value={form.target_key_id}
                onChange={(e) => setForm({ ...form, target_key_id: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
                placeholder="留空表示自动"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">优先级</label>
            <input
              type="number"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">描述</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
              placeholder="可选描述"
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="btn-secondary">
              取消
            </button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? '创建中...' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditRouteModal({
  route,
  onClose,
  onSaved,
}: {
  route: ModelRoute;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    model_pattern: route.model_pattern,
    target_channel_id: route.target_channel_id ?? 1,
    target_key_id: route.target_key_id?.toString() || '',
    priority: route.priority,
    description: route.description || '',
    enabled: route.enabled,
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.updateModelRoute(route.id, {
        model_pattern: form.model_pattern,
        target_channel_id: form.target_channel_id,
        target_key_id: form.target_key_id ? parseInt(form.target_key_id) : undefined,
        priority: form.priority,
        description: form.description,
        enabled: form.enabled,
      });
      onSaved();
    } catch (err: any) {
      alert(`更新失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] animate-scale-in border border-slate-200/50 dark:border-slate-700/50 overflow-hidden flex flex-col">
        <div className="p-4 sm:p-6 border-b border-slate-200/50 dark:border-slate-700/50 flex items-center justify-between shrink-0">
          <h3 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white truncate">编辑路由规则</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 shrink-0">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">模型匹配模式</label>
            <input
              type="text"
              value={form.model_pattern}
              onChange={(e) => setForm({ ...form, model_pattern: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
              required
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">目标渠道 ID</label>
              <input
                type="number"
                value={form.target_channel_id}
                onChange={(e) => setForm({ ...form, target_channel_id: parseInt(e.target.value) || 1 })}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">目标 Key ID (可选)</label>
              <input
                type="number"
                value={form.target_key_id}
                onChange={(e) => setForm({ ...form, target_key_id: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
                placeholder="留空表示自动"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">优先级</label>
            <input
              type="number"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">描述</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="btn-secondary">
              取消
            </button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
