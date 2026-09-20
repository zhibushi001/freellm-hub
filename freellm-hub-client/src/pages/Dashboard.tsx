import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, DashboardStats } from '../api';
import { Activity, Radio, Key, Zap, TrendingUp, Clock, ArrowRight } from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, AreaChart, Area,
} from 'recharts';

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [bars24h, setBars24h] = useState<Array<{ hour: string; total: number; ok: number; err: number }>>([]);
  const [trend, setTrend] = useState<Array<{ day: string; total: number; successes: number; errors: number; total_tokens: number; avg_latency_ms: number }>>([]);
  const [strategy, setStrategy] = useState('balanced');
  const [savingStrategy, setSavingStrategy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
    loadStrategy();
  }, []);

  const loadStats = async () => {
    try {
      const [statsData, barsData, trendData] = await Promise.all([
        api.getDashboardStats(),
        api.getDashboard24hBars(),
        api.getUsageTrend(7),
      ]);
      setStats(statsData);
      setBars24h(barsData.buckets || []);
      setTrend(trendData.data || []);
    } catch (err) {
      console.error('Failed to load stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadStrategy = async () => {
    try {
      const data = await api.getRoutingStrategy();
      setStrategy(data.strategy);
    } catch (err) {
      console.error('Failed to load strategy:', err);
    }
  };

  const handleStrategyChange = async (val: string) => {
    setStrategy(val);
    setSavingStrategy(true);
    try {
      await api.setRoutingStrategy(val);
    } catch (err) {
      console.error('Failed to save strategy:', err);
    } finally {
      setSavingStrategy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  const cards = [
    {
      title: '总请求数',
      value: stats?.totalRequests?.toLocaleString() || '0',
      icon: Activity,
      gradient: 'from-blue-500 to-blue-600',
      bgLight: 'bg-blue-50',
    },
    {
      title: '活跃渠道',
      value: stats?.activeChannels?.toString() || '0',
      icon: Radio,
      gradient: 'from-emerald-500 to-emerald-600',
      bgLight: 'bg-emerald-50',
    },
    {
      title: '活跃 Keys',
      value: stats?.activeKeys?.toString() || '0',
      icon: Key,
      gradient: 'from-violet-500 to-violet-600',
      bgLight: 'bg-violet-50',
    },
    {
      title: '成功率',
      value: stats?.successRate ? `${stats.successRate.toFixed(1)}%` : '0%',
      icon: Zap,
      gradient: 'from-amber-500 to-orange-500',
      bgLight: 'bg-amber-50',
    },
    {
      title: '总 Tokens',
      value: stats?.totalTokens?.toLocaleString() || '0',
      icon: TrendingUp,
      gradient: 'from-indigo-500 to-indigo-600',
      bgLight: 'bg-indigo-50',
    },
    {
      title: '平均延迟',
      value: stats?.avgLatency ? `${stats.avgLatency.toFixed(0)}ms` : '0ms',
      icon: Clock,
      gradient: 'from-rose-500 to-rose-600',
      bgLight: 'bg-rose-50',
    },
  ];

  return (
    <div className="space-y-5 md:space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">总览</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-2">系统运行状态和关键指标</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
        {cards.map((card, index) => (
          <div
            key={card.title}
            className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6 card-hover animate-slide-up"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 truncate">{card.title}</p>
                <p className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight truncate">{card.value}</p>
              </div>
              <div className={`p-3 rounded-xl ${card.bgLight} dark:bg-opacity-20 shrink-0`}>
                <div className={`bg-gradient-to-br ${card.gradient} p-2 rounded-lg`}>
                  <card.icon size={18} className="text-white" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 路由策略设置 */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">路由策略</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">切换评分引擎的权重偏好，立即生效</p>
          </div>
          <div className="flex items-center gap-3 min-w-0">
            <select
              value={strategy}
              onChange={(e) => handleStrategyChange(e.target.value)}
              disabled={savingStrategy}
              className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none min-w-0 flex-1"
            >
              <option value="balanced">均衡 (可靠性 0.5 / 速度 0.25 / 智能 0.25)</option>
              <option value="fastest">最快 (速度 0.55 / 可靠性 0.35 / 智能 0.1)</option>
              <option value="reliable">最可靠 (可靠性 0.7 / 速度 0.15 / 智能 0.15)</option>
              <option value="smartest">最智能 (智能 0.55 / 可靠性 0.35 / 速度 0.1)</option>
              <option value="priority">手动排序 (按用户优先级)</option>
            </select>
            {savingStrategy && (
              <div className="w-5 h-5 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">24h 请求趋势</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bars24h} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                <XAxis dataKey="hour" className="text-xs text-slate-500 dark:text-slate-400" tick={{ fontSize: 10 }} />
                <YAxis className="text-xs text-slate-500 dark:text-slate-400" tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
                  formatter={(value: number, name: string) => [value, name === 'ok' ? '成功' : name === 'err' ? '失败' : '总计']}
                />
                <Legend formatter={(value) => value === 'ok' ? '成功' : value === 'err' ? '失败' : '总计'} />
                <Bar dataKey="ok" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="err" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">7 天用量趋势</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                <defs>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                <XAxis dataKey="day" className="text-xs text-slate-500 dark:text-slate-400" tick={{ fontSize: 10 }} />
                <YAxis className="text-xs text-slate-500 dark:text-slate-400" tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
                  formatter={(value: number) => [value.toLocaleString(), 'Tokens']}
                />
                <Area type="monotone" dataKey="total_tokens" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorTotal)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 sm:mb-5">快速操作</h3>
          <div className="space-y-3">
            {[
              { to: '/admin/channels', icon: Radio, color: 'text-blue-500', bg: 'bg-blue-50', title: '管理渠道', desc: '配置 API 渠道和密钥' },
              { to: '/admin/hub-keys', icon: Key, color: 'text-violet-500', bg: 'bg-violet-50', title: '管理 Hub Keys', desc: '创建和管理访问密钥' },
              { to: '/admin/routes', icon: TrendingUp, color: 'text-emerald-500', bg: 'bg-emerald-50', title: '模型路由', desc: '配置模型路由规则' },
            ].map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="flex items-center gap-4 p-4 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-all group"
              >
                <div className={`p-2.5 rounded-xl ${item.bg} dark:bg-opacity-20 shrink-0`}>
                  <item.icon size={20} className={item.color} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                    {item.title}
                  </div>
                  <div className="text-sm text-slate-500 dark:text-slate-400">{item.desc}</div>
                </div>
                <ArrowRight size={16} className="text-slate-300 dark:text-slate-600 group-hover:text-indigo-500 transition-colors shrink-0" />
              </Link>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 sm:mb-5">系统信息</h3>
          <div className="space-y-4">
            {[
              { label: '版本', value: 'v2.0' },
              { label: '运行时', value: 'Node.js + TypeScript' },
              { label: '数据库', value: 'SQLite' },
              { label: '协议支持', value: 'OpenAI + Anthropic + Gemini' },
              { label: '安全', value: 'Argon2 + Session' },
            ].map((item, i) => (
              <div key={i} className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-700/50 last:border-0">
                <span className="text-slate-500 dark:text-slate-400">{item.label}</span>
                <span className="font-medium text-slate-900 dark:text-white">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
