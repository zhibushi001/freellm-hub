import { useState } from 'react';
import { api } from '../api';
import { Zap, Activity, Shield, RefreshCw, ArrowRight, Sparkles } from 'lucide-react';

interface LoginProps {
  onLogin: () => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.login(username, password);
      onLogin();
    } catch (err: any) {
      setError(err.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      {/* Left hero */}
      <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-indigo-700 to-purple-800" />
        
        {/* Decorative elements */}
        <div className="absolute top-0 left-0 w-full h-full">
          <div className="absolute top-20 left-20 w-72 h-72 bg-white/10 rounded-full blur-3xl" />
          <div className="absolute bottom-20 right-20 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-3xl" />
        </div>

        <div className="relative z-10 p-12 flex flex-col justify-center max-w-xl mx-auto">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-12">
            <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Zap size={24} className="text-white" />
            </div>
            <span className="text-2xl font-bold text-white tracking-tight">FreeLLM Hub</span>
          </div>

          <h1 className="text-5xl font-bold text-white mb-6 leading-tight tracking-tight">
            统一 LLM API<br />智能网关
          </h1>
          <p className="text-xl text-indigo-100 mb-10 leading-relaxed">
            OpenAI · Anthropic · Gemini 一站式接入<br />
            智能路由，实时监控，毫秒级故障转移
          </p>

          {/* Features */}
          <div className="space-y-4">
            {[
              { icon: Zap, title: '毫秒级故障转移', desc: '渠道不可用时自动切换备用 Key' },
              { icon: Activity, title: '实时用量分析', desc: '按渠道/模型/Key 多维度统计' },
              { icon: Shield, title: '安全可控', desc: 'Argon2 密码哈希 + 会话持久化' },
              { icon: RefreshCw, title: '协议互通', desc: 'OpenAI/Anthropic/Gemini 格式互转' },
            ].map((feature, i) => (
              <div
                key={i}
                className="flex items-start gap-4 p-4 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10"
              >
                <div className="p-2 rounded-xl bg-white/20">
                  <feature.icon size={18} className="text-white" />
                </div>
                <div>
                  <strong className="text-white font-semibold">{feature.title}</strong>
                  <p className="text-indigo-200 text-sm mt-0.5">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 flex items-center gap-2 text-indigo-200/60 text-sm">
            <Sparkles size={14} />
            <span>v2.0 · 自托管 · 开源</span>
          </div>
        </div>
      </div>

      {/* Right login form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-10 justify-center">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Zap size={20} className="text-white" />
            </div>
            <span className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">FreeLLM Hub</span>
          </div>

          <div className="mb-8">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-2 tracking-tight">
              欢迎回来
            </h2>
            <p className="text-slate-500 dark:text-slate-400">
              登录管理后台，开始配置你的 AI 网关
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="p-4 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm border border-red-100 dark:border-red-500/20">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                用户名
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none transition-all"
                placeholder="请输入用户名"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                密码
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none transition-all"
                placeholder="请输入密码"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary flex items-center justify-center gap-2 py-3 text-base"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  登录
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 text-center text-sm text-slate-400 dark:text-slate-500">
            自托管 · 安全 · 高性能
          </div>
        </div>
      </div>
    </div>
  );
}
