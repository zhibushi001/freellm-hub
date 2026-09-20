import { useState, useEffect, useCallback } from 'react';
import { api, GuardrailConfig } from '../api';
import { Shield, Save, Plus, X, Trash2 } from 'lucide-react';

export default function Guardrails() {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<GuardrailConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);
  const [newKeyword, setNewKeyword] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.getGuardrails();
      setConfig(data);
    } catch (e) {
      setMessage({ type: 'error', text: '加载失败：' + (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const patch = (p: Partial<GuardrailConfig>) => setConfig((c) => (c ? { ...c, ...p } : c));
  const patchRules = (p: Partial<GuardrailConfig['rules']>) =>
    setConfig((c) => (c ? { ...c, rules: { ...c.rules, ...p } } : c));

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await api.updateGuardrails({
        enabled: config.enabled,
        input_filter: config.inputFilter,
        output_filter: config.outputFilter,
        rules: config.rules,
        description: config.description,
      });
      await load();
      setMessage({ type: 'success', text: '护栏配置已保存' });
    } catch (e) {
      setMessage({ type: 'error', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const addKeyword = () => {
    const kw = newKeyword.trim();
    if (!kw) return;
    if (config?.rules.blocked_keywords.includes(kw)) { setNewKeyword(''); return; }
    patchRules({ blocked_keywords: [...(config?.rules.blocked_keywords || []), kw] });
    setNewKeyword('');
  };

  const removeKeyword = (kw: string) => {
    patchRules({ blocked_keywords: (config?.rules.blocked_keywords || []).filter((k) => k !== kw) });
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;
  }

  if (!config) {
    return <div className="flex items-center justify-center h-64 text-slate-400">暂无护栏配置</div>;
  }

  return (
    <div className="space-y-4 md:space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">内容护栏</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm md:text-base">过滤输入输出内容，拦截敏感词与 PII</p>
        </div>
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
          <Save size={16} />
          {saving ? '保存中...' : '保存配置'}
        </button>
      </div>

      {message && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium ${
          message.type === 'success' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
        }`}>
          {message.text}
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">基本设置</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 break-words">
              {config.description || '未填写描述'}
            </p>
          </div>
          <div className={`p-3 rounded-xl shrink-0 ${config.enabled ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
            <Shield size={22} />
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">描述</label>
          <input
            type="text"
            value={config.description || ''}
            onChange={(e) => patch({ description: e.target.value })}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none"
            placeholder="例如：生产环境内容安全策略"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5">
          <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/30">
            <input type="checkbox" checked={config.enabled} onChange={(e) => patch({ enabled: e.target.checked })} className="w-4 h-4 rounded accent-indigo-600" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">启用护栏</span>
          </label>
          <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/30">
            <input type="checkbox" checked={config.inputFilter} onChange={(e) => patch({ inputFilter: e.target.checked })} className="w-4 h-4 rounded accent-indigo-600" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">过滤输入</span>
          </label>
          <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/30">
            <input type="checkbox" checked={config.outputFilter} onChange={(e) => patch({ outputFilter: e.target.checked })} className="w-4 h-4 rounded accent-indigo-600" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">过滤输出</span>
          </label>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 sm:mb-5">过滤规则</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">最大输入长度 (字符)</label>
            <input
              type="number" min={0}
              value={config.rules.max_input_length}
              onChange={(e) => patchRules({ max_input_length: parseInt(e.target.value) || 0 })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">最大输出长度 (字符)</label>
            <input
              type="number" min={0}
              value={config.rules.max_output_length}
              onChange={(e) => patchRules({ max_output_length: parseInt(e.target.value) || 0 })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none"
            />
          </div>
        </div>

        <div className="mt-5">
          <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/30">
            <input type="checkbox" checked={config.rules.pii_detection} onChange={(e) => patchRules({ pii_detection: e.target.checked })} className="w-4 h-4 rounded accent-indigo-600" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">PII 检测（手机号 / 邮箱 / 身份证等）</span>
          </label>
        </div>

        <div className="mt-5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">拦截关键词</label>
          <div className="flex flex-wrap gap-2 mb-3">
            {(config.rules.blocked_keywords || []).map((kw) => (
              <span key={kw} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm font-medium">
                {kw}
                <button onClick={() => removeKeyword(kw)} className="hover:text-red-800 dark:hover:text-red-200"><X size={14} /></button>
              </span>
            ))}
            {(config.rules.blocked_keywords || []).length === 0 && (
              <span className="text-sm text-slate-400">暂无关键词</span>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
              placeholder="输入关键词后回车或点添加"
              className="flex-1 min-w-0 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none"
            />
            <button onClick={addKeyword} className="btn-primary flex items-center gap-2 shrink-0"><Plus size={16} />添加</button>
          </div>
        </div>
      </div>

      <div className="bg-amber-50 dark:bg-amber-900/20 rounded-2xl p-4 sm:p-6 border border-amber-200/50 dark:border-amber-700/50">
        <p className="text-sm text-amber-700 dark:text-amber-300">
          <strong>注意：</strong>拦截的请求会返回 400 错误。关键词区分大小写；PII 检测使用正则匹配常见格式。保存后立即生效。
        </p>
      </div>
    </div>
  );
}
