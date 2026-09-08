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
  if (!result || !result.res.ok) { list.innerHTML = '<div class="desc">加载失败</div>'; return; }
  const providers = (result.data && result.data.data) || [];
  document.getElementById('stat-providers').textContent = providers.length;
  if (providers.length === 0) {
    list.innerHTML = '<div class="desc">还没添加 provider。点上方表单加一个。</div>';
    return;
  }
  list.innerHTML = providers.map(p => `
    <div class="provider-item">
      <div class="info">
        <div class="name">${esc(p.label)} <span class="badge ${p.enabled ? '' : 'off'}">${p.enabled ? 'enabled' : 'disabled'}</span></div>
        <div class="url">${esc(p.baseUrl)}${esc(p.apiPath || '')}</div>
        ${p.notes ? `<div style="font-size: 12px; color: var(--text-dim); margin-top: 4px;">${esc(p.notes)}</div>` : ''}
      </div>
      <div class="actions">
        <button onclick="toggleProvider('${p.id}', ${!p.enabled})">${p.enabled ? '禁用' : '启用'}</button>
        <button class="danger" onclick="deleteProvider('${p.id}')">删除</button>
      </div>
    </div>`).join('');
}

async function loadHubKeys() {
  const res = await fetch('/api/hub-keys');
  const data = await res.json();
  const list = document.getElementById('key-list');
  const keys = (data && data.data) || [];
  document.getElementById('stat-keys').textContent = keys.length;
  if (keys.length === 0) { list.innerHTML = '<div class="desc">还没 hub key</div>'; return; }
  list.innerHTML = keys.map(k => `
    <div class="key-item">
      <div class="info">
        <div class="name">${esc(k.label)} <span class="badge ${k.enabled ? '' : 'off'}">${k.enabled ? 'enabled' : 'disabled'}</span></div>
        <div class="meta">${esc(k.keyPrefix)}… · 创建 ${new Date(k.createdAt).toLocaleString('zh-CN')} · ${k.lastUsedAt ? '最后用 ' + new Date(k.lastUsedAt).toLocaleString('zh-CN') : '未用过'}</div>
      </div>
      <div class="actions">
        <button onclick="useKey('${k.id}','${esc(k.keyPrefix)}')">用这个</button>
        <button onclick="toggleHubKey('${k.id}', ${!k.enabled})">${k.enabled ? '禁用' : '启用'}</button>
        <button class="danger" onclick="deleteHubKey('${k.id}')">删除</button>
      </div>
    </div>`).join('');
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
}

async function deleteProvider(id) { if (!confirm('确定删除？')) return; await fetch('/api/providers/' + id, { method: 'DELETE' }); loadProviders(); }
async function toggleProvider(id, enabled) { await fetch('/api/providers/' + id, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({enabled}) }); loadProviders(); }

async function createHubKey() {
  const label = document.getElementById('key-label').value.trim() || 'unnamed';
  const res = await fetch('/api/hub-keys', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({label}) });
  const data = await res.json();
  if (!res.ok) { alert('Failed: ' + (data && data.error && data.error.message || 'unknown')); return; }
  const display = document.getElementById('new-key-display');
  display.innerHTML = `
    <div class="new-key-banner">
      <div style="margin-bottom: 6px; color: var(--warning); font-weight: 600;">⚠️ 保存这个 key — 不会再显示！</div>
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
    if (t.dataset.tab === 'providers') loadProviders();
    if (t.dataset.tab === 'keys') loadHubKeys();
  });
});

updateKeyDisplay();
renderCurlTemplates();
refreshStatus();
loadProviders();
loadHubKeys();
setInterval(refreshStatus, 30000);
