import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect, ReactNode } from 'react';
import { api } from '../api';
import {
  LayoutDashboard,
  Radio,
  Key,
  GitBranch,
  Layers,
  GitCommitHorizontal,
  Repeat,
  BarChart3,
  Shield,
  Database,
  User,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  ChevronRight,
  Zap,
  ExternalLink,
  Play,
  MessageSquare,
  Code,
} from 'lucide-react';

interface LayoutProps {
  children: ReactNode;
  onLogout: () => void;
}

const navItems = [
  { path: '/admin/dashboard', label: '总览', icon: LayoutDashboard, group: '概览' },
  { path: '/admin/channels', label: '渠道管理', icon: Radio, group: '管理' },
  { path: '/admin/routes', label: '模型路由', icon: GitBranch, group: '管理' },
  { path: '/admin/virtual-models', label: '虚拟模型', icon: Layers, group: '管理' },
  { path: '/admin/mappings', label: '模型映射', icon: GitCommitHorizontal, group: '管理' },
  { path: '/admin/hub-keys', label: 'Hub Keys', icon: Key, group: '管理' },
  { path: '/admin/fallback', label: '故障转移', icon: Repeat, group: '管理' },
  { path: '/admin/usage', label: '用量统计', icon: BarChart3, group: '运营' },
  { path: '/admin/playground', label: '测试场', icon: Play, group: '工具' },
  { path: '/admin/chat', label: '聊天', icon: MessageSquare, group: '工具' },
  { path: '/admin/api', label: 'API 测试', icon: Code, group: '工具' },
  { path: '/admin/guardrails', label: '内容护栏', icon: Shield, group: '系统' },
  { path: '/admin/cache', label: '响应缓存', icon: Database, group: '系统' },
  { path: '/admin/profile', label: '个人资料', icon: User, group: '系统' },
];

export default function Layout({ children, onLogout }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    // 移动端默认关闭，桌面端默认打开
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 768;
    }
    return true;
  });
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('darkMode') === 'true';
  });
  const [username, setUsername] = useState('A');
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('darkMode', String(darkMode));
  }, [darkMode]);

  useEffect(() => {
    api.getProfile().then((p) => setUsername(p.username?.[0]?.toUpperCase() || 'A')).catch(() => {});
  }, []);

  const handleLogout = async () => {
    await api.logout().catch(() => {});
    onLogout();
    navigate('/login');
  };

  const groups = navItems.reduce<Record<string, typeof navItems>>((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {});

  const currentLabel = navItems.find((item) => location.pathname.startsWith(item.path))?.label || '总览';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-50 to-indigo-50/30 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 flex">
      {/* Sidebar Overlay for Mobile */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col transition-all duration-300 ease-out ${
          sidebarOpen ? 'translate-x-0 w-[260px]' : '-translate-x-full md:translate-x-0 md:w-[72px]'
        }`}
      >
        <div className="absolute inset-0 bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl border-r border-slate-200/50 dark:border-slate-700/50" />
        
        <div className="relative flex flex-col h-full">
          <div className="h-16 flex items-center px-5 border-b border-slate-200/50 dark:border-slate-700/50">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700/50 text-slate-500 dark:text-slate-400 transition-colors"
            >
              {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            {sidebarOpen ? (
              <a
                href="https://www.zhibushi.com"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-3 flex items-center gap-2.5 group min-w-0"
                title="访问作者主页"
              >
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0">
                  <Zap size={16} className="text-white" />
                </div>
                <div className="min-w-0">
                  <span className="font-semibold text-slate-900 dark:text-white text-sm flex items-center gap-1">
                    FreeLLM Hub
                    <ExternalLink size={10} className="text-slate-400 group-hover:text-indigo-500 transition-colors shrink-0" />
                  </span>
                  <span className="block text-[10px] text-slate-400 dark:text-slate-500 -mt-0.5 truncate">zhibushi.com</span>
                </div>
              </a>
            ) : (
              <a
                href="https://www.zhibushi.com"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-3 w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center hover:from-indigo-600 hover:to-purple-700 transition-colors"
                title="访问作者主页"
              >
                <Zap size={16} className="text-white" />
              </a>
            )}
          </div>

          <nav className="flex-1 overflow-y-auto py-4 px-3">
            {Object.entries(groups).map(([group, items]) => (
              <div key={group} className="mb-5">
                {sidebarOpen && (
                  <div className="px-3 mb-2 text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    {group}
                  </div>
                )}
                <div className="space-y-1">
                  {items.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={() => {
                        // 移动端点击后关闭侧边栏
                        if (typeof window !== 'undefined' && window.innerWidth < 768) {
                          setSidebarOpen(false);
                        }
                      }}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                          isActive
                            ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 shadow-sm shadow-indigo-100 dark:shadow-indigo-500/10'
                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                        } ${!sidebarOpen ? 'justify-center' : ''}`
                      }
                    >
                      <item.icon size={20} strokeWidth={1.8} />
                      {sidebarOpen && <span className="text-sm font-medium">{item.label}</span>}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="p-3 border-t border-slate-200/50 dark:border-slate-700/50">
            {sidebarOpen && (
              <a
                href="https://www.zhibushi.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 w-full px-3 py-2 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors mb-1 group"
                title="访问作者主页"
              >
                <ExternalLink size={16} strokeWidth={1.8} className="text-slate-400 group-hover:text-indigo-500" />
                <span className="text-xs font-medium truncate">zhibushi.com</span>
              </a>
            )}
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors mb-1 ${
                !sidebarOpen ? 'justify-center' : ''
              }`}
            >
              {darkMode ? <Sun size={18} strokeWidth={1.8} /> : <Moon size={18} strokeWidth={1.8} />}
              {sidebarOpen && <span className="text-sm font-medium">{darkMode ? '浅色模式' : '深色模式'}</span>}
            </button>
            <button
              onClick={handleLogout}
              className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 transition-colors ${
                !sidebarOpen ? 'justify-center' : ''
              }`}
            >
              <LogOut size={18} strokeWidth={1.8} />
              {sidebarOpen && <span className="text-sm font-medium">退出登录</span>}
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className={`flex-1 min-w-0 transition-all duration-300 ease-out ${sidebarOpen ? 'md:ml-[260px]' : 'md:ml-[72px]'}`}>
        <header className="h-16 bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl border-b border-slate-200/50 dark:border-slate-700/50 flex items-center justify-between px-4 md:px-8 sticky top-0 z-30">
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden p-2 -ml-2 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <Menu size={20} />
            </button>
            <span className="text-slate-400 dark:text-slate-500 hidden md:inline">首页</span>
            <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 hidden md:inline" />
            <span className="text-slate-900 dark:text-white font-semibold">{currentLabel}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-sm font-medium">
              {username}
            </div>
          </div>
        </header>

        <main className="p-4 md:p-8 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
