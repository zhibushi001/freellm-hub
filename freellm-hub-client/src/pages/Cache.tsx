import { useState, useEffect, useCallback } from 'react';
import { api, CacheStats } from '../api';
import { Database, PlayCircle, Trash2, ToggleLeft, ToggleRight, Timer } from 'lucide-react';

export default function Cache() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [ttl, setTtl] = useState(300);
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getCacheStats();
      setEnabled(res.enabled);
      setTtl(res.ttl_seconds);
      setStats(res.stats);
    } catch (e) {
      setMessage({ type: 'error', text: '加载失败：' + (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async () => {
    setSaving(true);
    try {
      await api.setCacheEnabled(!enabled, ttl);
      await load();
      setMessage({ type: 'success', text: enabled ? '缓存已关闭' : '缓存已开启' });
    } catch (e) {
      setMessage({ type: 'error', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTtl = async () => {
    setSaving(true);
    try {
      await api.setCacheEnabled(enabled, ttl);
      await load();
      setMessage({ type: 'success', text: `TTL 已更新为 ${ttl} 秒` });
    } catch (e) {
      setMessage({ type: 'error', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const handleCleanup = async () => {
    setCleaning(true);
    try {
      const res = await api.cleanupCache();
      await load();
      setMessage({ type: 'success', text: `已清理 ${res.cleaned} 条过期缓存` });
    } catch (e) {
      setMessage({ type: 'error', text: (e as Error).message });
    } finally {
      setCleaning(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;
  }

  return (
    <div className="space-y-4 md:space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">响应缓存</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm md:text-base">缓存相同请求的响应，降低延迟与上游费用</p>
      </div>

      {message && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2 ${
          message.type === 'success' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
        }`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-500 dark:text-slate-400">缓存状态</p>
              <p className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white mt-1">
                {enabled ? '已开启' : '已关闭'}
              </p>
            </div>
            <div className={`p-3 rounded-xl shrink-0 ${enabled ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
              <Database size={22} />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-500 dark:text-slate-400">缓存条目</p>
              <p className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white mt-1 truncate" title={String(stats?.totalEntries ?? 0)}>{stats?.totalEntries ?? 0}</p>
            </div>
            <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-500 shrink-0"><Database size={22} /></div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-500 dark:text-slate-400">命中率</p>
              <p className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white mt-1">{((stats?.hitRate ?? 0) * 100).toFixed(1)}%</p>
            </div>
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500 shrink-0"><PlayCircle size={22} /></div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-500 dark:text-slate-400">命中 / 未命中</p>
              <p className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white mt-1">
                <span className="text-emerald-500">{stats?.hitCount ?? 0}</span>
                <span className="text-slate-400 text-lg"> / </span>
                <span className="text-red-400">{stats?.missCount ?? 0}</span>
              </p>
            </div>
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-500 shrink-0"><Timer size={22} /></div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 sm:mb-5">缓存配置</h3>

        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <button
            onClick={handleToggle}
            disabled={saving}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-colors ${
              enabled
                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'
            } disabled:opacity-50`}
          >
            {enabled ? <ToggleRight size={18} className="text-emerald-500" /> : <ToggleLeft size={18} className="text-slate-400" />}
            {enabled ? '关闭缓存' : '开启缓存'}
          </button>

          <div className="flex items-center gap-3 min-w-0">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 shrink-0">TTL (秒)</label>
            <input
              type="number"
              min={1}
              max={86400}
              value={ttl}
              onChange={(e) => setTtl(Math.max(1, parseInt(e.target.value) || 300))}
              className="w-28 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none"
            />
            <button onClick={handleSaveTtl} disabled={saving} className="btn-secondary shrink-0 disabled:opacity-50">保存</button>
          </div>
        </div>

        <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">
          TTL 为缓存过期时间（秒）。相同 model + messages 的请求在 TTL 内直接返回缓存，不调用上游。
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={handleCleanup} disabled={cleaning} className="btn-secondary flex items-center gap-2 disabled:opacity-50">
          <Trash2 size={16} />
          {cleaning ? '清理中...' : '清理过期缓存'}
        </button>
      </div>
    </div>
  );
}
