/**
 * Admin UI 统一布局 (NewAPI 风格)
 *
 * 结构: 左侧栏 (220px, 可折叠 64px) + 顶栏 (56px) + 主区
 */
import { getDb } from '../../db/connection.js';

export interface PageOptions {
  title: string;
  active?: 'dashboard' | 'channels' | 'hub-keys' | 'routes' | 'usage' | 'profile';
  body: string;
  head?: string;
  bodyEnd?: string;
  scripts?: string;
  showNav?: boolean;
}

type NavGroup = { title: string; items: Array<[string, string, PageOptions['active']]> };

const NAV_GROUPS: NavGroup[] = [
  {
    title: '概览',
    items: [
      ['/admin/dashboard', '📊 总览', 'dashboard'],
    ],
  },
  {
    title: '渠道',
    items: [
      ['/admin/channels', '🔌 渠道', 'channels'],
      ['/admin/routes', '🧭 模型路由', 'routes'],
    ],
  },
  {
    title: '客户端',
    items: [
      ['/admin/access/hub-keys', '🔑 Hub Keys', 'hub-keys'],
    ],
  },
  {
    title: '运营',
    items: [
      ['/admin/usage', '📈 用量', 'usage'],
    ],
  },
];

const PAGE_LABELS: Record<string, string> = {
  'dashboard': '总览',
  'channels': '渠道管理',
  'hub-keys': 'Hub Keys',
  'routes': '模型路由',
  'usage': '用量统计',
  'profile': '我的账号',
};

function escapeAttr(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function renderSidebar(active: PageOptions['active'], username: string, _stats: { channels: number; keys: number }): string {
  return `<aside class="sidebar" id="sidebar">
  <div class="sidebar-brand">
    <button type="button" class="sidebar-toggle" onclick="toggleSidebar()" title="折叠/展开侧栏" aria-label="toggle sidebar">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
    </button>
    <span class="brand-icon">🔱</span>
    <span class="brand-text">FreeLLM Hub</span>
  </div>
  <nav class="sidebar-nav">
    ${NAV_GROUPS.map(group => `
      <div class="sidebar-group">
        <div class="sidebar-group-title">${group.title}</div>
        ${group.items.map(([href, label, key]) =>
          `<a href="${href}" class="sidebar-item ${active === key ? 'active' : ''}">
            <span class="sidebar-item-text">${label}</span>
          </a>`,
        ).join('')}
      </div>
    `).join('')}
  </nav>
  <div class="sidebar-footer">
    <a href="/admin/profile" class="sidebar-user" title="个人资料">
      <span class="user-avatar">${escapeAttr(username.slice(0, 1).toUpperCase())}</span>
      <span class="user-name">${escapeAttr(username)}</span>
    </a>
    <button type="button" class="btn-icon" onclick="Logout()" title="登出" aria-label="logout">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
    </button>
  </div>
</aside>`;
}

function renderTopbar(title: string, active: PageOptions['active'], _username: string): string {
  const pageLabel = PAGE_LABELS[active ?? ''] ?? title;
  return `<header class="topbar">
  <div class="topbar-left">
    <nav class="breadcrumb" aria-label="breadcrumb">
      <a href="/admin/dashboard" class="breadcrumb-item">首页</a>
      <span class="breadcrumb-sep">/</span>
      <span class="breadcrumb-current">${escapeAttr(pageLabel)}</span>
    </nav>
  </div>
  <div class="topbar-right">
    <div class="topbar-search">
      <svg class="topbar-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
      <input type="text" id="topbar-search" placeholder="搜索... (Ctrl+K)" autocomplete="off">
      <kbd class="topbar-search-kbd">⌘K</kbd>
    </div>
    <button type="button" class="btn-icon" onclick="toggleTheme()" title="切换主题" aria-label="theme">
      <svg id="theme-icon-light" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
      <svg id="theme-icon-dark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none;"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
    </button>
  </div>
</header>`;
}

const COMMON_SCRIPTS = `<script src="/static/js/admin-common.js?v=${getBuildHash()}"></script>`;
const LAYOUT_SCRIPT = `<script>
function toggleUserMenu() {
  const d = document.getElementById('user-menu-dropdown');
  if (d) d.classList.toggle('show');
}
function toggleSidebar() {
  document.body.classList.toggle('sidebar-collapsed');
  try { localStorage.setItem('sidebar-collapsed', document.body.classList.contains('sidebar-collapsed') ? '1' : '0'); } catch (e) {}
}
function toggleTheme() {
  document.body.classList.toggle('theme-dark');
  try { localStorage.setItem('theme-dark', document.body.classList.contains('theme-dark') ? '1' : '0'); } catch (e) {}
  // 同步顶栏图标
  const l = document.getElementById('theme-icon-light');
  const d = document.getElementById('theme-icon-dark');
  if (l && d) {
    l.style.display = document.body.classList.contains('theme-dark') ? 'none' : '';
    d.style.display = document.body.classList.contains('theme-dark') ? '' : 'none';
  }
}
// 恢复状态
(function() {
  try {
    if (localStorage.getItem('sidebar-collapsed') === '1') document.body.classList.add('sidebar-collapsed');
    if (localStorage.getItem('theme-dark') === '1') document.body.classList.add('theme-dark');
  } catch (e) {}
  // 同步主题图标
  setTimeout(() => {
    const l = document.getElementById('theme-icon-light');
    const d = document.getElementById('theme-icon-dark');
    if (l && d && document.body.classList.contains('theme-dark')) {
      l.style.display = 'none';
      d.style.display = '';
    }
  }, 0);
  // Ctrl+K 聚焦搜索
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      const s = document.getElementById('topbar-search');
      if (s) s.focus();
    }
  });
  // 点击外部关闭 user menu
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t.closest('.user-menu')) {
      const d = document.getElementById('user-menu-dropdown');
      if (d) d.classList.remove('show');
    }
  });
})();
</script>`;

/**
 * 查统计数字 (渠道数 / keys 数) — 同步, 直接走 node:sqlite
 */
function getStats(): { channels: number; keys: number } {
  try {
    const db = getDb();
    const c = (db.prepare('SELECT COUNT(*) as c FROM channels').get() as { c: number }).c;
    const k = (db.prepare('SELECT COUNT(*) as c FROM keys').get() as { c: number }).c;
    return { channels: c, keys: k };
  } catch {
    return { channels: 0, keys: 0 };
  }
}

function getBuildHash(): string {
  return (globalThis as any).__BUILD_HASH__ || Date.now().toString(36);
}

export function renderPage(opts: PageOptions, ctx?: { username?: string; stats?: { channels: number; keys: number } }): string {
  const showNav = opts.showNav !== false;
  const username = ctx?.username ?? 'admin';
  const stats = ctx?.stats ?? getStats();
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${opts.title} - FreeLLM Hub</title>
<link rel="stylesheet" href="/static/css/app.css?v=${getBuildHash()}">
${opts.head ?? ''}
</head>
<body class="${showNav ? 'has-layout' : 'no-layout'}">
${showNav ? `
  <div class="app-layout">
    ${renderSidebar(opts.active, username, stats)}
    <div class="app-main">
      ${renderTopbar(opts.title, opts.active, username)}
      <main class="app-content">
        <div class="container">
          ${opts.body}
        </div>
      </main>
    </div>
  </div>
` : `
  <div class="auth-split">
    <div class="auth-hero">
      <div class="auth-hero-content">
        <div class="auth-hero-logo">
          <span class="auth-hero-icon">🔱</span>
          <span class="auth-hero-name">FreeLLM Hub</span>
        </div>
        <h1 class="auth-hero-title">统一 LLM API 网关</h1>
        <p class="auth-hero-subtitle">OpenAI · Anthropic · Responses 一站式接入, 智能路由, 实时用量统计</p>
        <div class="auth-hero-features">
          <div class="auth-feature"><span class="auth-feature-icon">⚡</span><div><strong>毫秒级故障转移</strong><br><span class="auth-feature-desc">渠道不可用时自动切换备用 Key</span></div></div>
          <div class="auth-feature"><span class="auth-feature-icon">📊</span><div><strong>实时用量分析</strong><br><span class="auth-feature-desc">按渠道/模型/Key 维度统计</span></div></div>
          <div class="auth-feature"><span class="auth-feature-icon">🔐</span><div><strong>安全可控</strong><br><span class="auth-feature-desc">Argon2 密码哈希 + 会话持久化</span></div></div>
          <div class="auth-feature"><span class="auth-feature-icon">🔄</span><div><strong>协议互通</strong><br><span class="auth-feature-desc">OpenAI/Anthropic 格式互转</span></div></div>
        </div>
        <div class="auth-hero-footer">v2.0 · 自托管 · 开源</div>
      </div>
    </div>
    <div class="auth-panel">
      <div class="auth-box">
        ${opts.body}
      </div>
    </div>
  </div>
`}
${opts.bodyEnd ?? ''}
${COMMON_SCRIPTS}
${showNav ? LAYOUT_SCRIPT : ''}
${opts.scripts ? `<script>\n${opts.scripts}\n</script>` : ''}
</body>
</html>`;
}
