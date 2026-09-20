import { useState, useEffect } from 'react';
import { api, UsageLog, UsageDaily } from '../api';
import { BarChart3, Download, TrendingUp, Activity, Cpu, Server, AlertTriangle } from 'lucide-react';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell,
} from 'recharts';

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#6366f1'];

export default function Usage() {
  const [logs, setLogs] = useState<UsageLog[]>([]);
  const [trend, setTrend] = useState<Array<{ day: string; total: number; successes: number; errors: number; total_tokens: number; avg_latency_ms: number }>>([]);
  const [modelStats, setModelStats] = useState<Array<{ model: string; requests: number; totalTokens: number; promptTokens: number; completionTokens: number; successes: number; failures: number; avgLatency: number }>>([]);
  const [channelStats, setChannelStats] = useState<Array<{ channelId: number; providerName: string; requests: number; totalTokens: number; successes: number; failures: number; avgLatency: number }>>([]);
  const [errorStats, setErrorStats] = useState<Array<{ errorCode: number | null; errorType: string; count: number; percentage: number }>>([]);
  const [overview, setOverview] = useState<{ totalRequests: number; successes: number; failures: number; successRate: number; totalTokens: number; promptTokens: number; completionTokens: number; avgLatency: number; minLatency: number; maxLatency: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('7d');
  const [activeTab, setActiveTab] = useState<'overview' | 'models' | 'channels' | 'errors' | 'logs'>('overview');

  useEffect(() => {
    loadUsage();
  }, [dateRange]);

  const loadUsage = async () => {
    setLoading(true);
    try {
      const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
      const [logsData, trendData, overviewData, modelData, channelData, errorData] = await Promise.all([
        api.getUsageLogs(50).then(r => r.logs),
        api.getUsageTrend(days),
        api.getUsageOverview(days),
        api.getUsageModelStats(days),
        api.getUsageChannelStats(days),
        api.getUsageErrorStats(days),
      ]);
      setLogs(logsData);
      setTrend(trendData.data || []);
      setOverview(overviewData.overview);
      setModelStats(modelData.stats);
      setChannelStats(channelData.stats);
      setErrorStats(errorData.stats);
    } catch (err) {
      console.error('Failed to load usage:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    const headers = ['时间', '渠道', '模型', 'Prompt Tokens', 'Completion Tokens', '延迟(ms)', '状态'];
    const rows = logs.map(log => [
      new Date(log.created_at).toLocaleString(),
      `渠道 #${log.channel_id || '-'}`,
      log.model,
      log.tokens_prompt,
      log.tokens_completion,
      log.latency_ms,
      log.status === 1 ? '成功' : '失败',
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `usage-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
  
  // Model stats for chart
  const modelChartData = modelStats.slice(0, 10).map(m => ({
    name: m.model.length > 15 ? m.model.slice(0, 15) + '...' : m.model,
    fullModel: m.model,
    requests: m.requests,
    tokens: m.totalTokens,
  }));
  
  // Error stats for pie chart
  const errorChartData = errorStats.map(e => ({
    name: e.errorType === 'unknown' ? '其他' : e.errorType,
    value: e.count,
    code: e.errorCode,
  }));

  return (
    <div className="space-y-4 md:space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">用量统计</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">查看 API 使用情况和趋势分析</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
          >
            <option value="7d">最近 7 天</option>
            <option value="30d">最近 30 天</option>
            <option value="90d">最近 90 天</option>
          </select>
          <button onClick={handleExport} className="btn-secondary flex items-center gap-2">
            <Download size={16} />
            导出
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 sm:gap-2 border-b border-slate-200 dark:border-slate-700 overflow-x-auto -mx-1 px-1">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-3 sm:px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
            activeTab === 'overview'
              ? 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 border-b-transparent text-indigo-600 dark:text-indigo-400'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          <Activity size={16} />
          概览
        </button>
        <button
          onClick={() => setActiveTab('models')}
          className={`px-3 sm:px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
            activeTab === 'models'
              ? 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 border-b-transparent text-indigo-600 dark:text-indigo-400'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          <Cpu size={16} />
          模型统计
        </button>
        <button
          onClick={() => setActiveTab('channels')}
          className={`px-3 sm:px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
            activeTab === 'channels'
              ? 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 border-b-transparent text-indigo-600 dark:text-indigo-400'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          <Server size={16} />
          渠道统计
        </button>
        <button
          onClick={() => setActiveTab('errors')}
          className={`px-3 sm:px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
            activeTab === 'errors'
              ? 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 border-b-transparent text-indigo-600 dark:text-indigo-400'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          <AlertTriangle size={16} />
          错误分析
        </button>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-5">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-500/10 shrink-0">
                  <Activity size={18} className="text-blue-600 dark:text-blue-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 dark:text-slate-400">总请求数</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white truncate" title={String(overview?.totalRequests ?? 0)}>{overview?.totalRequests.toLocaleString() || 0}</p>
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-5">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 shrink-0">
                  <TrendingUp size={18} className="text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 dark:text-slate-400">成功率</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white truncate">{overview?.successRate || 0}%</p>
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-5">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2.5 rounded-xl bg-violet-50 dark:bg-violet-500/10 shrink-0">
                  <BarChart3 size={18} className="text-violet-600 dark:text-violet-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 dark:text-slate-400">总 Tokens</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white truncate" title={String(overview?.totalTokens ?? 0)}>{overview?.totalTokens.toLocaleString() || 0}</p>
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-5">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2.5 rounded-xl bg-orange-50 dark:bg-orange-500/10 shrink-0">
                  <BarChart3 size={18} className="text-orange-600 dark:text-orange-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 dark:text-slate-400">平均延迟</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white truncate">{overview?.avgLatency || 0}ms</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 sm:mb-5">请求趋势</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                    <XAxis dataKey="day" className="text-xs text-slate-500 dark:text-slate-400" tick={{ fontSize: 10 }} />
                    <YAxis className="text-xs text-slate-500 dark:text-slate-400" tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
                      formatter={(value: number, name: string) => [value.toLocaleString(), name === 'total' ? '请求数' : name === 'successes' ? '成功' : '失败']}
                    />
                    <Legend formatter={(value) => value === 'total' ? '请求数' : value === 'successes' ? '成功' : '失败'} />
                    <Line type="monotone" dataKey="total" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="successes" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="errors" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 sm:mb-5">Token 用量趋势</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                    <defs>
                      <linearGradient id="colorTokens" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                    <XAxis dataKey="day" className="text-xs text-slate-500 dark:text-slate-400" tick={{ fontSize: 10 }} />
                    <YAxis className="text-xs text-slate-500 dark:text-slate-400" tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
                      formatter={(value: number) => [value.toLocaleString(), 'Tokens']}
                    />
                    <Area type="monotone" dataKey="total_tokens" stroke="#8b5cf6" strokeWidth={2} fillOpacity={1} fill="url(#colorTokens)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Models Tab */}
      {activeTab === 'models' && (
        <div className="space-y-4 md:space-y-6">
          {modelStats.length > 0 && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 sm:mb-5">Top 10 模型请求量</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={modelChartData} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                    <XAxis dataKey="name" className="text-xs text-slate-500 dark:text-slate-400" tick={{ fontSize: 10 }} />
                    <YAxis className="text-xs text-slate-500 dark:text-slate-400" tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }} />
                    <Legend formatter={(value) => value === 'requests' ? '请求数' : 'Tokens'} />
                    <Line type="monotone" dataKey="requests" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="tokens" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
            <div className="p-4 sm:p-6 border-b border-slate-200/50 dark:border-slate-700/50">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">模型详细统计</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 dark:bg-slate-700/30">
                  <tr>
                    <th className="text-left px-3 sm:px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">模型</th>
                    <th className="text-left px-3 sm:px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">请求数</th>
                    <th className="text-left px-3 sm:px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Tokens</th>
                    <th className="text-left px-3 sm:px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">成功率</th>
                    <th className="text-left px-3 sm:px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">平均延迟</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {modelStats.map((stat, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-3 sm:px-6 py-4">
                        <span className="px-2.5 py-1 text-xs font-medium rounded-full whitespace-nowrap bg-indigo-100 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300">
                          {stat.model}
                        </span>
                      </td>
                      <td className="px-3 sm:px-6 py-4 text-sm text-slate-600 dark:text-slate-400">{stat.requests.toLocaleString()}</td>
                      <td className="px-3 sm:px-6 py-4 text-sm text-slate-600 dark:text-slate-400">{stat.totalTokens.toLocaleString()}</td>
                      <td className="px-3 sm:px-6 py-4">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          stat.successes / stat.requests > 0.99
                            ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                            : stat.successes / stat.requests > 0.95
                            ? 'bg-yellow-100 text-yellow-600 dark:bg-yellow-500/10 dark:text-yellow-400'
                            : 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400'
                        }`}>
                          {stat.requests > 0 ? Math.round((stat.successes / stat.requests) * 100) : 0}%
                        </span>
                      </td>
                      <td className="px-3 sm:px-6 py-4 text-sm text-slate-600 dark:text-slate-400">{stat.avgLatency}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Channels Tab */}
      {activeTab === 'channels' && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
          <div className="p-4 sm:p-6 border-b border-slate-200/50 dark:border-slate-700/50">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">渠道统计</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-700/30">
                <tr>
                  <th className="text-left px-3 sm:px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">渠道 ID</th>
                  <th className="text-left px-3 sm:px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">提供商</th>
                  <th className="text-left px-3 sm:px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">请求数</th>
                  <th className="text-left px-3 sm:px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Tokens</th>
                  <th className="text-left px-3 sm:px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">成功率</th>
                  <th className="text-left px-3 sm:px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">平均延迟</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {channelStats.map((stat) => (
                  <tr key={stat.channelId} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                    <td className="px-3 sm:px-6 py-4 text-sm font-medium text-slate-900 dark:text-white">#{stat.channelId}</td>
                    <td className="px-3 sm:px-6 py-4">
                      <span className="px-2.5 py-1 text-xs font-medium rounded-full whitespace-nowrap bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                        {stat.providerName}
                      </span>
                    </td>
                    <td className="px-3 sm:px-6 py-4 text-sm text-slate-600 dark:text-slate-400">{stat.requests.toLocaleString()}</td>
                    <td className="px-3 sm:px-6 py-4 text-sm text-slate-600 dark:text-slate-400">{stat.totalTokens.toLocaleString()}</td>
                    <td className="px-3 sm:px-6 py-4">
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                        {stat.requests > 0 ? Math.round((stat.successes / stat.requests) * 100) : 0}%
                      </span>
                    </td>
                    <td className="px-3 sm:px-6 py-4 text-sm text-slate-600 dark:text-slate-400">{stat.avgLatency}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Errors Tab */}
      {activeTab === 'errors' && (
        <div className="space-y-4 md:space-y-6">
          {errorStats.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 sm:mb-5">错误分布</h3>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={errorChartData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, value }) => `${name}: ${value}`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {errorChartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 sm:mb-5">错误详情</h3>
                <div className="space-y-3">
                  {errorStats.map((err, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/30 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                        <div>
                          <p className="text-sm font-medium text-slate-900 dark:text-white">
                            {err.errorCode ? `HTTP ${err.errorCode}` : err.errorType}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{err.errorType}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">{err.count}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{err.percentage}%</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
            <div className="p-4 sm:p-6 border-b border-slate-200/50 dark:border-slate-700/50">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">最近失败请求</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 dark:bg-slate-700/30">
                  <tr>
                    <th className="text-left px-3 sm:px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">时间</th>
                    <th className="text-left px-3 sm:px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">模型</th>
                    <th className="text-left px-3 sm:px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">错误码</th>
                    <th className="text-left px-3 sm:px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">错误类型</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {logs.filter(l => l.status === 0).slice(0, 10).map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-3 sm:px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="px-3 sm:px-6 py-4">
                        <span className="px-2.5 py-1 text-xs font-medium rounded-full whitespace-nowrap bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                          {log.model}
                        </span>
                      </td>
                      <td className="px-3 sm:px-6 py-4 text-sm text-red-600 dark:text-red-400">
                        {log.error_code ? `HTTP ${log.error_code}` : '-'}
                      </td>
                      <td className="px-3 sm:px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                        <span title={log.error_message || ''}>
                          {log.error_type || '未知'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
