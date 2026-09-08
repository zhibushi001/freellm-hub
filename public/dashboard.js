const KEY_STORAGE = 'freellm-hub-key';
let currentKey = localStorage.getItem(KEY_STORAGE) || '';

function setKey(k) {
  currentKey = (k || '').trim();
  if (currentKey) localStorage.setItem(KEY_STORAGE, currentKey);
  else localStorage.removeItem(KEY_STORAGE);
  updateKeyDisplay();
  renderCurlTemplates();
}

function updateKeyDisplay() {
  const d = document.getElementById('current-key-display');
  if (currentKey) {
    d.textContent = currentKey.slice(0, 12) + '…' + currentKey.slice(-8);
    d.style.color = 'var(--success)';
  } else {
    d.textContent = '未设置 — 去 Hub Keys tab 生成一个';
    d.style.color = 'var(--warning)';
  }
}

function editKey() {
  const k = prompt('粘贴你的 hub key (fh_...):', currentKey);
  if (k !== null) setKey(k);
}

function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (currentKey) h['Authorization'] = 'Bearer ' + currentKey;
  return h;
}

function renderCurlTemplates() {
  const k = currentKey ? ` \\\n  -H "Authorization: Bearer ${currentKey}"` : '';
  document.getElementById('curl-GET-/v1/models').textContent = `curl ${location.origin}/v1/models${k}`;
  document.getElementById('curl-GET-/health').textContent = `curl ${location.origin}/health`;
  document.getElementById('curl-POST-/v1/chat/completions').textContent =
    `curl -X POST ${location.origin}/v1/chat/completions${k} \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"zhipu:glm-4-flash","messages":[{"role":"user","content":"hi"}],"stream":true}'`;
}

async function callV1(path, method = 'GET', body = null) {
  const out = document.getElementById('out-' + method + '-' + path);
  if (out) { out.textContent = '加载中...'; out.className = 'output'; }
  try {
    const res = await fetch(path, { method, headers: authHeaders(), body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let pretty = text;
    try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { /* keep raw */ }
    if (out) { out.textContent = `[HTTP ${res.status}]\n${pretty}`; out.className = 'output ' + (res.ok ? 'ok' : 'err'); }
  } catch (e) {
    if (out) { out.textContent = '[Network error] ' + e.message; out.className = 'output err'; }
  }
}

async function callApi(path, method = 'GET', body = null, targetId = null) {
  const outId = targetId ? 'out-' + targetId : ('out-' + method + '-' + path);
  const out = document.getElementById(outId);
  if (out) { out.textContent = '加载中...'; out.className = 'output'; }
  try {
    const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let pretty = text;
    try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { /* keep raw */ }
    if (out) { out.textContent = `[HTTP ${res.status}]\n${pretty}`; out.className = 'output ' + (res.ok ? 'ok' : 'err'); }
    return { res, data: safeParse(text) };
  } catch (e) {
    if (out) { out.textContent = '[Network error] ' + e.message; out.className = 'output err'; }
    return null;
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

async function copyCurl(method, path, body) {
  const k = currentKey ? ` \\\n  -H "Authorization: Bearer ${currentKey}"` : '';
  let cmd = `curl -X ${method} ${location.origin}${path}${k}`;
  if (body) cmd += ` \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`;
  try {
    await navigator.clipboard.writeText(cmd);
    const btn = event.target;
    const orig = btn.textContent;
    btn.textContent = '✓ 已复制';
    setTimeout(() => { btn.textContent = orig; }, 1200);
  } catch (e) { alert('复制失败：' + e.message); }
}

async function refreshStatus() {
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');
  try {
    const res = await fetch('/health');
    const data = await res.json();
    if (res.ok) {
      dot.className = 'status-dot ok';
      txt.textContent = '运行中';
      document.getElementById('stat-mode').textContent = data.mode || 'default';
      document.getElementById('stat-db').textContent = data.db || 'memory';
    } else { dot.className = 'status-dot err'; txt.textContent = '异常'; }
  } catch (e) { dot.className = 'status-dot err'; txt.textContent = '离线'; }
}

async function loadProviders() {
  const result = await callApi('/api/providers', 'GET', null, null);
  const list = document.getElementById('provider-list');
  const wizard = document.getElementById('setup-wizard');
  if (!result || !result.res.ok) { list.innerHTML = '<div class="desc">加载失败</div>'; return; }
  const providers = (result.data && result.data.data) || [];
  document.getElementById('stat-providers').textContent = providers.length;
  // Empty state → show 3-step wizard
  if (providers.length === 0) {
    wizard.innerHTML = renderSetupWizard();
    list.innerHTML = '';
    return;
  }
  wizard.innerHTML = '';
  // Render each provider as a card with status + actions + model sublist
  list.innerHTML = providers.map(p => `
    <div class="provider-card" data-provider-id="${esc(p.id)}">
      <div class="head">
        <div class="info">
          <div class="name">
            ${esc(p.label)}
            <span class="badge ${p.enabled ? '' : 'off'}">${p.enabled ? 'enabled' : 'disabled'}</span>
          </div>
          <div class="url">${esc(p.baseUrl)}${esc(p.apiPath || '')}</div>
          ${p.notes ? `<div style="font-size: 12px; color: var(--text-dim); margin-top: 4px;">${esc(p.notes)}</div>` : ''}
        </div>
        <div class="actions">
          <button onclick="refreshProviderModels('${p.id}')" title="从上游重新获取模型列表">🔄 刷新</button>
          <button onclick="testProvider('${p.id}', this)" title="发一个 ping 测延迟">⚡ 测速</button>
          <button onclick="toggleProvider('${p.id}', ${!p.enabled})">${p.enabled ? '禁用' : '启用'}</button>
          <button class="danger" onclick="deleteProvider('${p.id}')">删除</button>
        </div>
      </div>
      <div class="test-result" id="test-result-${esc(p.id)}"></div>
      <div class="model-list" id="models-${esc(p.id)}"><div class="desc" style="font-size: 11px;">加载模型列表...</div></div>
    </div>`).join('');
  // Async load each provider's cached models
  providers.forEach(p => loadProviderModels(p.id));
}

async function loadProviderModels(providerId) {
  const r = await callApi('/api/providers/' + providerId + '/models', 'GET', null, null);
  const target = document.getElementById('models-' + providerId);
  if (!target) return;
  if (!r || !r.res.ok) { target.innerHTML = '<div class="desc" style="font-size: 11px;">加载失败</div>'; return; }
  const data = r.data.data;
  const models = data.models || [];
  if (models.length === 0) {
    target.innerHTML = '<div class="head"><span class="label">模型列表 (0)</span>' +
      '<div class="actions"><button onclick="refreshProviderModels(\'' + providerId + '\')" title="从上游获取">+ 从上游获取</button></div></div>' +
      '<div class="desc" style="font-size: 11px;">点 “从上游获取” 拉一次完整模型列表，或点顶部 🔄。</div>';
    return;
  }
  target.innerHTML = `
    <div class="head">
      <span class="label">模型列表 (${models.length})</span>
      <div class="actions">
        <button onclick="toggleAllModels('${providerId}', true)">全选</button>
        <button onclick="toggleAllModels('${providerId}', false)">全不选</button>
        <button onclick="refreshProviderModels('${providerId}')" title="从上游重新拉取">🔄 从上游</button>
      </div>
    </div>
    ${models.map(m => `
      <div class="model-row">
        <input type="checkbox" data-provider-id="${esc(providerId)}" data-model-id="${esc(m.id)}" onchange="updateBatchBar('${providerId}')" />
        <span class="id" title="${esc(m.id)}">${esc(m.id)}</span>
        <button class="danger" onclick="deleteOneModel('${providerId}', '${esc(m.id)}')">删除</button>
      </div>`).join('')}
    <div class="batch-bar" id="batch-bar-${esc(providerId)}">
      <span>已选 <b id="batch-count-${esc(providerId)}">0</b> 个</span>
      <button class="danger" onclick="bulkDeleteModels('${providerId}')">批量删除</button>
      <button onclick="toggleAllModels('${providerId}', false)">取消</button>
    </div>`;
}

function updateBatchBar(providerId) {
  const checked = document.querySelectorAll(`input[data-provider-id="${CSS.escape(providerId)}"]:checked`).length;
  const bar = document.getElementById('batch-bar-' + providerId);
  const cnt = document.getElementById('batch-count-' + providerId);
  if (bar) bar.classList.toggle('visible', checked > 0);
  if (cnt) cnt.textContent = checked;
}

function toggleAllModels(providerId, on) {
  document.querySelectorAll(`input[data-provider-id="${CSS.escape(providerId)}"]`).forEach(cb => { cb.checked = on; });
  updateBatchBar(providerId);
}

async function deleteOneModel(providerId, modelId) {
  if (!confirm('删除模型 ' + modelId + ' ？')) return;
  const r = await callApi('/api/providers/' + providerId + '/models', 'DELETE', { ids: [modelId] }, null);
  if (r && r.res.ok) loadProviderModels(providerId);
}

async function bulkDeleteModels(providerId) {
  const ids = Array.from(document.querySelectorAll(`input[data-provider-id="${CSS.escape(providerId)}"]:checked`)).map(cb => cb.getAttribute('data-model-id'));
  if (ids.length === 0) return;
  if (!confirm('批量删除 ' + ids.length + ' 个模型？')) return;
  const r = await callApi('/api/providers/' + providerId + '/models', 'DELETE', { ids }, null);
  if (r && r.res.ok) {
    if (r.data && r.data.data) showStatus('已删除 ' + r.data.data.deleted + ' 个模型', 'ok');
    loadProviderModels(providerId);
  }
}

async function refreshProviderModels(providerId) {
  showStatus('从上游拉取模型...', 'ok');
  const r = await callApi('/api/providers/' + providerId + '/refresh-models', 'POST', null, null);
  if (r && r.res.ok) {
    const data = r.data.data;
    showStatus('已拉取 ' + data.count + ' 个模型', 'ok');
    loadProviderModels(providerId);
  } else {
    const msg = (r && r.data && r.data.error && r.data.error.message) || '拉取失败';
    showStatus('拉取失败: ' + msg, 'err');
  }
}

async function testProvider(providerId, btn) {
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ 测速中...';
  const t0 = Date.now();
  const r = await callApi('/api/providers/' + providerId + '/test', 'POST', { prompt: 'ping' }, null);
  btn.disabled = false; btn.textContent = orig;
  const out = document.getElementById('test-result-' + providerId);
  if (!out) return;
  if (r && r.res.ok) {
    const d = r.data.data;
    out.className = 'test-result visible ok';
    out.textContent = `✓ ${d.latencyMs}ms · model=${d.model} · "${d.content || ''}"`;
  } else {
    const err = (r && r.data && r.data.error) || { message: '测速失败' };
    out.className = 'test-result visible err';
    out.textContent = `✗ ${err.message}` + (err.latencyMs ? ` (${err.latencyMs}ms)` : ' (' + (Date.now() - t0) + 'ms)');
  }
}

function renderSetupWizard() {
  return `
    <div class="setup-wizard">
      <h3>🚀 3 步开启你的第一个 Provider</h3>
      <p>添加一个能用的 provider，下面就可以聊天了。</p>
      <div class="steps">
        <div class="step">
          <div class="num">1</div>
          <h4>从预设选一个</h4>
          <div class="desc">推荐先试免 key 的：Kilo、OVH、Pollinations、Llama7、AI Horde。</div>
          <button class="primary" onclick="document.querySelector('[data-target=add-provider-body]').click()">→ 选预设</button>
        </div>
        <div class="step">
          <div class="num">2</div>
          <h4>填 API key</h4>
          <div class="desc">点预设的“使用”后，填 key（需付费的 provider 会显示“去官方申请”链接）。</div>
        </div>
        <div class="step">
          <div class="num">3</div>
          <h4>测速 + 聊天</h4>
          <div class="desc">返回“现有 Providers”，点 ⚡ 测速，然后去“聊天” tab 试试。</div>
        </div>
      </div>
    </div>`;
}

function toggleSection(h) {
  const target = document.getElementById(h.getAttribute('data-target'));
  if (!target) return;
  h.classList.toggle('collapsed');
  target.classList.toggle('collapsed');
}

async function loadHubKeys() {
  const res = await fetch('/api/hub-keys');
  const data = await res.json();
  const list = document.getElementById('key-list');
  const keys = (data && data.data) || [];
  document.getElementById('stat-keys').textContent = keys.length;
  if (keys.length === 0) { list.innerHTML = '<div class="desc">还没 hub key</div>'; return; }
  list.innerHTML = keys.map(k => {
    const hasStored = (() => { try { return !!localStorage.getItem('hubKey_' + k.id); } catch (e) { return false; } })();
    return `
    <div class="key-item">
      <div class="info">
        <div class="name">${esc(k.label)} <span class="badge ${k.enabled ? '' : 'off'}">${k.enabled ? 'enabled' : 'disabled'}</span></div>
        <div class="meta">${esc(k.keyPrefix)}… · 创建 ${new Date(k.createdAt).toLocaleString('zh-CN')} · ${k.lastUsedAt ? '最后用 ' + new Date(k.lastUsedAt).toLocaleString('zh-CN') : '未用过'} · ${hasStored ? '<span style="color:var(--success)">📦 本机有备份</span>' : '<span style="color:var(--text-dim)">📭 本机无备份</span>'}</div>
      </div>
      <div class="actions">
        <button class="primary" onclick="copyStoredKey('${k.id}','${esc(k.keyPrefix)}',this)" title="${hasStored ? '从本机存的那份复制' : '本机无备份，点这里重新生成'}">${hasStored ? '📋 复制' : '🔄 重新生成'}</button>
        <button onclick="toggleHubKey('${k.id}', ${!k.enabled})">${k.enabled ? '禁用' : '启用'}</button>
        <button class="danger" onclick="deleteHubKey('${k.id}')">删除</button>
      </div>
    </div>`;
  }).join('');
}

function esc(s) { if (s === null || s === undefined) return ''; return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function addProvider() {
  const body = {
    label: document.getElementById('add-label').value.trim(),
    baseUrl: document.getElementById('add-baseUrl').value.trim(),
    apiPath: document.getElementById('add-apiPath').value.trim() || '/chat/completions',
    modelsPath: document.getElementById('add-modelsPath').value.trim() || '/models',
    apiKey: document.getElementById('add-apiKey').value,
    notes: document.getElementById('add-notes').value.trim() || null,
  };
  if (!body.label || !body.baseUrl || !body.apiKey) {
    const out = document.getElementById('out-add-provider');
    out.textContent = 'Error: label, baseUrl, apiKey 必填';
    out.className = 'output err';
    return;
  }
  const r = await callApi('/api/providers', 'POST', body, 'add-provider');
  if (r && r.res.ok) { clearAddForm(); loadProviders(); }
}

function clearAddForm() {
  ['add-label','add-baseUrl','add-apiKey','add-notes'].forEach(id => document.getElementById(id).value = '');
  const h = document.getElementById('signup-hint'); if (h) h.classList.remove('visible');
}

let presetFilter = 'all';
let allPresets = [];

async function loadPresets() {
  const grid = document.getElementById('preset-grid');
  const count = document.getElementById('preset-count');
  if (!grid) return;
  try {
    const res = await fetch('/api/presets');
    const data = await res.json();
    allPresets = data.data || [];
    if (count) count.textContent = allPresets.length + ' 预设';
    renderPresets();
  } catch (e) {
    grid.innerHTML = '<div class="desc">预设加载失败: ' + esc(e.message) + '</div>';
  }
}

function renderPresets() {
  const grid = document.getElementById('preset-grid');
  if (!grid) return;
  const cnPlatforms = new Set(['zhipu','zhipu-global','modelscope','qianfan','volcengine','longcat','xfyun','sail','radeon','qwen','stepfun','hunyuan','yi','minimax','baichuan','doubao-pro','wenxin','spark-v3','moonshot']);
  const cnHosts = ['bigmodel', 'z.ai', 'modelscope', 'volces', 'xf-yun', 'baidubce', 'qianfan', 'longcat', 'amd.com.cn', 'moonshot.cn', 'aliyuncs.com', 'stepfun.com', 'tencent.com', 'lingyiwanwu', 'MiniMax.chat'];
  let presets = allPresets;
  if (presetFilter === 'cn') {
    presets = presets.filter(p => cnPlatforms.has(p.platform) || cnHosts.some(h => p.baseUrl.includes(h)));
  } else if (presetFilter !== 'all') {
    presets = presets.filter(p => (p.tier || 'free') === presetFilter);
  }
  if (presets.length === 0) {
    grid.innerHTML = '<div class="desc">该筛选下无预设</div>';
    return;
  }
  grid.innerHTML = presets.map(p => {
    const isCN = cnPlatforms.has(p.platform) || cnHosts.some(h => p.baseUrl.includes(h));
    const tier = p.tier || 'free';
    const tags = [];
    if (p.keyless) tags.push('<span class="tag tag-keyless">免 KEY</span>');
    if (isCN) tags.push('<span class="tag tag-cn">国内</span>');
    if (p.special) tags.push('<span class="tag tag-special">特殊</span>');
    const tierLabel = tier === 'paid' ? '付费' : (tier === 'freemium' ? '免费额度' : '免费');
    const tierClass = 'tag-' + tier;
    tags.push('<span class="tag ' + tierClass + '">' + tierLabel + '</span>');
    return '<div class="preset-card">' +
      '<div class="preset-name">' + esc(p.name) + ' ' + tags.join(' ') + '</div>' +
      '<div class="preset-url">' + esc(p.baseUrl) + '</div>' +
      (p.notes ? '<div style="font-size: 10px; color: var(--text-dim); margin-top: 2px;">' + esc(p.notes) + '</div>' : '') +
      '<div class="preset-actions">' +
      '<button class="primary" data-platform="' + esc(p.platform) + '" data-url="' + esc(p.baseUrl) + '" data-name="' + esc(p.name) + '" onclick="usePresetFromBtn(this)">使用</button>' +
      '</div></div>';
  }).join('');
}

document.querySelectorAll('#preset-filters button').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#preset-filters button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    presetFilter = b.getAttribute('data-tier');
    renderPresets();
  });
});

function usePresetFromBtn(btn) {
  const platform = btn.getAttribute('data-platform');
  const baseUrl = btn.getAttribute('data-url');
  const name = btn.getAttribute('data-name');
  usePreset(platform, baseUrl, name);
}

function usePreset(platform, baseUrl, name) {
  document.getElementById('add-label').value = platform;
  document.getElementById('add-baseUrl').value = baseUrl;
  document.getElementById('add-apiPath').value = '/chat/completions';
  document.getElementById('add-modelsPath').value = '/models';
  document.getElementById('add-apiKey').value = '';
  document.getElementById('add-apiKey').placeholder = name + ' 的 API key (或留空用免 KEY)...';
  document.getElementById('add-notes').value = 'preset: ' + name;
  // Show signup hint with the "Get API key" link + apply note
  showSignupHint(platform, name);
  document.getElementById('add-apiKey').focus();
  document.getElementById('add-label').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showSignupHint(platform, name) {
  const hint = document.getElementById('signup-hint');
  const text = document.getElementById('signup-hint-text');
  const link = document.getElementById('signup-hint-link');
  const note = document.getElementById('signup-hint-note');
  const preset = allPresets.find(p => p.platform === platform);
  if (!preset) { hint.classList.remove('visible'); return; }
  if (preset.keyless) {
    text.textContent = '免 KEY: 这个 provider 不用填 API key，留空即可。';
    link.style.display = 'none';
  } else if (preset.signupUrl) {
    text.textContent = '还没 key？去官方申请。';
    link.textContent = '👉 ' + name + ' 申请页';
    link.href = preset.signupUrl;
    link.style.display = '';
  } else {
    text.textContent = '需要 API key';
    link.style.display = 'none';
  }
  if (preset.applyNote) {
    note.textContent = ' · ' + preset.applyNote;
    note.style.display = '';
  } else {
    note.textContent = '';
    note.style.display = 'none';
  }
  hint.classList.add('visible');
}

async function deleteProvider(id) { if (!confirm('确定删除？')) return; await fetch('/api/providers/' + id, { method: 'DELETE' }); loadProviders(); }
async function toggleProvider(id, enabled) { await fetch('/api/providers/' + id, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({enabled}) }); loadProviders(); }

async function createHubKey() {
  const label = document.getElementById('key-label').value.trim() || 'unnamed';
  const res = await fetch('/api/hub-keys', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({label}) });
  const data = await res.json();
  if (!res.ok) { alert('Failed: ' + (data && data.error && data.error.message || 'unknown')); return; }
  // Auto-save to localStorage so user can copy it back later
  try { localStorage.setItem('hubKey_' + data.id, data.fullKey); } catch (e) {}
  const display = document.getElementById('new-key-display');
  display.innerHTML = `
    <div class="new-key-banner">
      <div style="margin-bottom: 6px; color: var(--success); font-weight: 600;">✓ 已保存到本机 (localStorage) — 刷新后仍可复制</div>
      <div>Label: <strong>${esc(data.label)}</strong></div>
      <div style="margin-top: 4px;">Full key:</div>
      <code id="new-key-value">${esc(data.fullKey)}</code>
      <div class="actions" style="margin-top: 8px;">
        <button class="primary" onclick="copyToClipboard('${esc(data.fullKey)}', this)">📋 复制</button>
        <button onclick="setKey('${esc(data.fullKey)}')">🔑 用这个</button>
      </div>
    </div>`;
  loadHubKeys();
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓ 已复制';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

function useKey(id, prefix) {
  // We don't have the full key anymore (only prefix shown in list), so prompt user to paste
  const k = prompt(`粘贴完整 key (${prefix}...):`);
  if (k) setKey(k);
}

function copyStoredKey(id, prefix, btn) {
  const stored = (() => { try { return localStorage.getItem('hubKey_' + id); } catch (e) { return null; } })();
  if (stored) {
    copyToClipboard(stored, btn);
  } else {
    if (confirm('本机未存此 key 的完整值。\n要重新生成吗？\n（原 key 将失效）')) {
      regenerateHubKey(id, prefix);
    }
  }
}

async function regenerateHubKey(id, prefix) {
  const old = await fetch('/api/hub-keys').then(r => r.json()).then(d => (d.data || []).find(k => k.id === id));
  if (!old) { alert('未找到该 key'); return; }
  await fetch('/api/hub-keys/' + id, { method: 'DELETE' });
  const res = await fetch('/api/hub-keys', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({label: old.label}) });
  const data = await res.json();
  if (!res.ok) { alert('重新生成失败: ' + (data && data.error && data.error.message || 'unknown')); loadHubKeys(); return; }
  try { localStorage.setItem('hubKey_' + data.id, data.fullKey); } catch (e) {}
  try { localStorage.removeItem('hubKey_' + id); } catch (e) {}
  const display = document.getElementById('new-key-display');
  display.innerHTML = `
    <div class="new-key-banner">
      <div style="margin-bottom: 6px; color: var(--success); font-weight: 600;">✓ 已重新生成 (旧 key ${prefix}... 已删除)</div>
      <div>Label: <strong>${esc(data.label)}</strong></div>
      <div style="margin-top: 4px;">Full key:</div>
      <code>${esc(data.fullKey)}</code>
      <div class="actions" style="margin-top: 8px;">
        <button class="primary" onclick="copyToClipboard('${esc(data.fullKey)}', this)">📋 复制</button>
        <button onclick="setKey('${esc(data.fullKey)}')">🔑 用这个</button>
      </div>
    </div>`;
  loadHubKeys();
}

async function deleteHubKey(id) { if (!confirm('确定删除这个 hub key？')) return; await fetch('/api/hub-keys/' + id, { method: 'DELETE' }); loadHubKeys(); }
async function toggleHubKey(id, enabled) { await fetch('/api/hub-keys/' + id, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({enabled}) }); loadHubKeys(); }

async function testChat() {
  if (!currentKey) { alert('请先在顶部设置 Hub Key'); return; }
  const model = document.getElementById('chat-model').value.trim();
  const message = document.getElementById('chat-message').value;
  const temperature = parseFloat(document.getElementById('chat-temp').value);
  const max_tokens = parseInt(document.getElementById('chat-max').value, 10);
  const stream = document.getElementById('chat-stream').checked;
  if (!model || !message) { alert('model 和 message 必填'); return; }

  const out = document.getElementById('out-chat');
  out.textContent = '发送中...';
  out.className = 'output';

  const start = Date.now();
  let firstTokenAt = 0;
  let fullReply = '';
  let usageInfo = null;

  if (!stream) {
    // Non-streaming
    const res = await fetch('/v1/chat/completions', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ model, messages: [{ role: 'user', content: message }], temperature, max_tokens, stream: false }),
    });
    const data = await res.json();
    if (res.ok) {
      fullReply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '(no content)';
      usageInfo = data.usage;
      out.innerHTML = `<div class="chat-stream-text">${esc(fullReply)}</div>
<div class="chat-meta">HTTP ${res.status} · ${Date.now() - start}ms${usageInfo ? ' · tokens: ' + usageInfo.total_tokens : ''}</div>`;
      out.className = 'output ok';
    } else {
      out.textContent = `[HTTP ${res.status} · ${Date.now() - start}ms]\n${JSON.stringify(data, null, 2)}`;
      out.className = 'output err';
    }
  } else {
    // Streaming (SSE)
    out.innerHTML = '';
    out.className = 'output';
    const replyDiv = document.createElement('div');
    replyDiv.className = 'chat-stream-text';
    out.appendChild(replyDiv);
    const metaDiv = document.createElement('div');
    metaDiv.className = 'chat-meta';
    metaDiv.textContent = '连接中...';
    out.appendChild(metaDiv);

    let res;
    try {
      res = await fetch('/v1/chat/completions', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ model, messages: [{ role: 'user', content: message }], temperature, max_tokens, stream: true }),
      });
    } catch (e) {
      out.innerHTML = '[Network error] ' + e.message;
      out.className = 'output err';
      return;
    }
    if (!res.ok || !res.body) {
      const t = await res.text();
      out.innerHTML = `[HTTP ${res.status}]\n${t}`;
      out.className = 'output err';
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of event.split('\n')) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              const j = JSON.parse(data);
              const delta = j.choices && j.choices[0] && j.choices[0].delta;
              if (delta && delta.content) {
                if (!firstTokenAt) firstTokenAt = Date.now();
                fullReply += delta.content;
                replyDiv.textContent = fullReply;
              }
            } catch (e) { /* skip non-JSON keepalives */ }
          }
        }
      }
    }
    const total = Date.now() - start;
    const ttft = firstTokenAt ? (firstTokenAt - start) : '?';
    metaDiv.textContent = `完成 · 总 ${total}ms · 首 token ${ttft}ms`;
  }
}

function clearChat() {
  document.getElementById('out-chat').textContent = '';
  document.getElementById('out-chat').className = 'output';
}

// Tabs
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('tab-' + t.dataset.tab).classList.add('active');
    if (t.dataset.tab === 'providers') { loadProviders(); loadPresets(); }
    if (t.dataset.tab === 'keys') loadHubKeys();
    if (t.dataset.tab === 'models') loadModels();
  });
});

updateKeyDisplay();
renderCurlTemplates();
refreshStatus();
loadProviders();
loadPresets();
loadHubKeys();
loadModels();
setInterval(refreshStatus, 30000);

// === UI helpers (added for setup wizard + status toast) ===
function showStatus(msg, kind) {
  // Try the status badge in header first
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');
  if (dot && txt) {
    if (kind === 'err') { dot.className = 'status-dot err'; }
    else { dot.className = 'status-dot ok'; }
    txt.textContent = msg;
    if (kind !== 'err') {
      setTimeout(() => { refreshStatus(); }, 3000);
    }
  }
  // Always also console.log for debugging
  console.log('[status]', kind || 'ok', msg);
}

// === Models tab ===
let allModels = [];
let modelsTierFilter = 'all';

async function loadModels() {
  const result = await callApi('/api/models/all', 'GET', null, null);
  const tableEl = document.getElementById('models-table');
  const countEl = document.getElementById('models-count');
  if (!result || !result.res.ok) { tableEl.innerHTML = '<div class="models-empty">加载失败</div>'; return; }
  allModels = (result.data && result.data.data) || [];
  const total = (result.data && result.data.total) || 0;
  if (countEl) countEl.textContent = total + ' 个模型';
  renderModels();
}

function renderModels() {
  const tableEl = document.getElementById('models-table');
  if (!tableEl) return;
  const q = (document.getElementById('models-search')?.value || '').trim().toLowerCase();
  let rows = allModels.slice();
  if (modelsTierFilter !== 'all') {
    rows = rows.filter(m => m.tier === modelsTierFilter);
  }
  if (q) {
    rows = rows.filter(m =>
      (m.modelId || '').toLowerCase().includes(q) ||
      (m.label || '').toLowerCase().includes(q) ||
      (m.qualified || '').toLowerCase().includes(q)
    );
  }
  if (rows.length === 0) {
    tableEl.innerHTML = '<div class="models-empty">没有匹配的模型<br><br>' +
      '<a class="primary" style="cursor:pointer" onclick="document.querySelector(\'[data-tab=providers]\').click()">→ 去添加 Provider 拉模型</a></div>';
    return;
  }
  const tierLabel = { free: '🟢 免费', freemium: '🟡 免费额度', paid: '🔴 付费' };
  const tierClass = { free: 'tag-free', freemium: 'tag-freemium', paid: 'tag-paid' };
  tableEl.innerHTML = `
    <table class="models-table">
      <thead>
        <tr>
          <th>模型</th>
          <th>Provider</th>
          <th>类型</th>
          <th style="width: 1%; white-space: nowrap;">操作</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(m => `
          <tr>
            <td class="model-id">
              <div>${esc(m.modelId)}</div>
              <div class="qualified">${esc(m.qualified)}</div>
            </td>
            <td class="provider">${esc(m.label)}</td>
            <td><span class="tag ${tierClass[m.tier] || 'tag-free'}">${tierLabel[m.tier] || m.tier}</span></td>
            <td class="actions">
              <button class="primary" onclick="useModelInChat('${esc(m.qualified)}')">💬 聊天</button>
              <button onclick="copyToClipboard('${esc(m.qualified)}', this)">复制</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div style="margin-top: 8px; color: var(--text-dim); font-size: 11px;">显示 ${rows.length} / ${allModels.length} 个</div>
  `;
}

function useModelInChat(qualified) {
  document.getElementById('chat-model').value = qualified;
  document.querySelector('[data-tab="chat"]').click();
  setTimeout(() => document.getElementById('chat-message').focus(), 100);
}

async function refreshAllModels(btn) {
  if (!btn) return;
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ 拉取所有 provider...';
  const r = await callApi('/api/models/refresh-all', 'POST', null, null);
  btn.disabled = false; btn.textContent = orig;
  if (r && r.res.ok) {
    const d = r.data.data;
    const summary = d.results.map(x => x.error ? `❌${x.label}: ${x.error.slice(0, 60)}` : `✓${x.label}: ${x.count}`).join('\n');
    alert(`完成: ${d.ok} OK, ${d.failed} 失败\n\n${summary}`);
    loadModels();
  } else {
    alert('刷新失败: ' + ((r && r.data && r.data.error) || '').message);
  }
}

// Wire tier filter buttons
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#models-tier-filters button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#models-tier-filters button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      modelsTierFilter = b.getAttribute('data-tier');
      renderModels();
    });
  });
});
