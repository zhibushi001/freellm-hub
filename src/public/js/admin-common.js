/**
 * FreeLLM Hub - Admin 通用客户端工具
 * 通过 <script src="/static/js/admin-common.js"> 自动加载
 *
 * 暴露到 window:
 *   - window.api: { get, post, postForm, del, put }
 *   - window.toast(msg, isErr)
 *   - window.copyText(text, label)
 *   - window.Modal: { show, close, confirm }
 *   - window.Logout()
 *   - window.toUrlEncoded(form | object)
 */
(function () {
  'use strict';

  // ============================================
  // Toast
  // ============================================
  let toastEl = null;
  function ensureToast() {
    if (toastEl) return toastEl;
    toastEl = document.createElement('div');
    toastEl.className = 'admin-toast';
    document.body.appendChild(toastEl);
    return toastEl;
  }
  window.toast = function (msg, isErr) {
    const t = ensureToast();
    t.textContent = msg;
    t.className = 'admin-toast show ' + (isErr ? 'err' : 'ok');
    clearTimeout(t.__timer);
    t.__timer = setTimeout(() => { t.className = 'admin-toast'; }, 3000);
  };
  // 兼容老名字
  window.showToast = window.toast;

  // ============================================
  // Copy
  // ============================================
  // Copy text to clipboard (with fallbacks for HTTP)
  // ============================================
  window.copyText = async function (text, label) {
    if (!text || typeof text !== 'string') {
      window.toast('复制失败: 内容为空', true);
      return;
    }
    const preview = text.length > 60 ? text.slice(0, 60) + '...' : text;
    try {
      // 1. Modern clipboard API (HTTPS / localhost only)
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        window.toast((label || '已复制') + ': ' + preview, false);
        return;
      }
    } catch (e) {
      // fall through to execCommand
    }
    try {
      // 2. execCommand fallback (HTTP)
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.width = '1px';
      ta.style.height = '1px';
      ta.style.opacity = '0.01';
      ta.style.pointerEvents = 'none';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) {
        window.toast((label || '已复制') + ': ' + preview, false);
      } else {
        throw new Error('execCommand 返回 false');
      }
    } catch (e2) {
      // 3. Last resort: prompt dialog
      window.toast('复制失败, 请手动复制:', true);
      setTimeout(() => {
        // 用 Modal 显示完整文本, 用户可以手动选中复制
        window.Modal.show({
          title: '📋 ' + (label || '复制'),
          body: '<pre style="background:var(--bg-elev); padding:12px; border-radius:4px; word-break:break-all; font-size:12px; max-height:300px; overflow:auto; cursor:text;">' +
                window.escapeHtml(text) + '</pre>' +
                '<p class="muted" style="margin-top:8px; font-size:12px;">⬆ 请手动选中并 Ctrl+C 复制</p>',
          actions: [{ label: '关闭', onClick: () => window.Modal.close() }],
        });
      }, 200);
    }
  };

  // ============================================
  // Logout
  // ============================================
  window.Logout = async function () {
    try {
      await fetch('/api/admin/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {}
    location.href = '/admin/login';
  };

  // ============================================
  // toUrlEncoded: form | object | FormData → string
  // ============================================
  window.toUrlEncoded = function (input) {
    const fd = input instanceof FormData ? input : (input && input.tagName ? new FormData(input) : null);
    if (fd) {
      const p = new URLSearchParams();
      for (const [k, v] of fd.entries()) {
        if (v !== null && v !== undefined) p.append(k, String(v));
      }
      return p.toString();
    }
    // object
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(input || {})) {
      if (v === null || v === undefined) continue;
      if (Array.isArray(v)) v.forEach((item) => p.append(k, String(item)));
      else p.append(k, String(v));
    }
    return p.toString();
  };

  // ============================================
  // api: 统一 fetch wrapper
  //   - 默认 credentials: same-origin
  //   - 默认 body=object → urlencoded
  //   - 非 2xx 弹 toast (unless {silent: true})
  //   - 返回 {ok, data, status, res}
  // ============================================
  async function request(method, url, opts = {}) {
    const { body, headers = {}, silent = false, responseType = 'json' } = opts;
    const finalHeaders = { ...headers };

    let finalBody = body;
    // 顺序很重要: HTML form (有 tagName) 必须先于 plain object 判断
    if (body && body.tagName) {
      // HTML form → urlencoded
      finalHeaders['content-type'] = finalHeaders['content-type'] || 'application/x-www-form-urlencoded';
      finalBody = window.toUrlEncoded(body);
    } else if (body && body instanceof FormData) {
      // FormData → urlencoded
      finalHeaders['content-type'] = finalHeaders['content-type'] || 'application/x-www-form-urlencoded';
      finalBody = window.toUrlEncoded(body);
    } else if (body && typeof body === 'object' && responseType === 'urlencoded') {
      finalHeaders['content-type'] = finalHeaders['content-type'] || 'application/x-www-form-urlencoded';
      finalBody = window.toUrlEncoded(body);
    } else if (body && typeof body === 'object' && responseType === 'json') {
      finalHeaders['content-type'] = finalHeaders['content-type'] || 'application/json';
      finalBody = JSON.stringify(body);
    } else if (typeof body === 'string') {
      // already a body
    }

    let res;
    try {
      res = await fetch(url, {
        method,
        headers: finalHeaders,
        body: finalBody,
        credentials: 'same-origin',
      });
    } catch (e) {
      if (!silent) window.toast('Network error: ' + e.message, true);
      return { ok: false, error: e.message, network: true };
    }

    let data = null;
    try {
      data = responseType === 'text' ? await res.text() : await res.json();
    } catch {
      data = null;
    }

    if (!res.ok || (data && data.ok === false)) {
      const errMsg = (data && (data.error || data.message)) || ('HTTP ' + res.status);
      if (!silent) window.toast(errMsg, true);
      return { ok: false, status: res.status, error: errMsg, data };
    }

    return { ok: true, status: res.status, data, res };
  }

  window.api = {
    get: (url, opts) => request('GET', url, opts),
    post: (url, body, opts) => request('POST', url, { ...opts, body }),
    put: (url, body, opts) => request('PUT', url, { ...opts, body }),
    patch: (url, body, opts) => request('PATCH', url, { ...opts, body }),
    del: (url, opts) => request('DELETE', url, opts),
    postForm: (url, formOrObj, opts) => request('POST', url, {
      ...opts,
      body: formOrObj,
      responseType: 'urlencoded',
    }),
  };

  // ============================================
  // Modal: 通用 modal API
  //   - Modal.show({title, body, actions, onClose})
  //   - Modal.close()
  //   - Modal.confirm({title, message, okText, danger}) → Promise<boolean>
  // ============================================
  let modalEl = null, modalBoxEl = null, modalBackdropEl = null;
  function ensureModal() {
    if (modalEl) return;
    modalEl = document.createElement('div');
    modalEl.className = 'admin-modal';
    modalEl.id = '__admin_modal';
    modalEl.innerHTML = '<div class="admin-modal-box" id="__admin_modal_box"></div>';
    document.body.appendChild(modalEl);
    modalBoxEl = modalEl.querySelector('#__admin_modal_box');
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) window.Modal.close(); });
  }
  window.Modal = {
    show(opts) {
      ensureModal();
      const { title = '', body = '', actions = [], onClose = null } = opts || {};
      modalBoxEl.innerHTML = `
        <h2>${escapeHtml(title)}</h2>
        <div class="admin-modal-body">${typeof body === 'string' ? body : ''}</div>
        <div class="admin-modal-actions">
          ${actions.map((a, i) => `<button class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}" data-action="${i}">${escapeHtml(a.label || '确定')}</button>`).join('')}
        </div>
      `;
      modalEl.className = 'admin-modal show';
      // wire actions
      const actionHandlers = actions.map((a) => a.onClick);
      modalBoxEl.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const i = parseInt(btn.dataset.action, 10);
          if (actionHandlers[i]) actionHandlers[i]();
        });
      });
      modalEl.__onClose = onClose;
    },
    close() {
      if (!modalEl) return;
      modalEl.className = 'admin-modal';
      if (typeof modalEl.__onClose === 'function') {
        const cb = modalEl.__onClose;
        modalEl.__onClose = null;
        cb();
      }
    },
    confirm({ title = '确认', message = '', okText = '确定', cancelText = '取消', danger = false } = {}) {
      return new Promise((resolve) => {
        this.show({
          title,
          body: `<p>${escapeHtml(message)}</p>`,
          actions: [
            { label: cancelText, onClick: () => { this.close(); resolve(false); } },
            { label: okText, primary: true, danger, onClick: () => { this.close(); resolve(true); } },
          ],
        });
      });
    },
  };

  // ============================================
  // escapeHtml (server side escapeHtml in TS, this is client mirror)
  // ============================================
  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  window.escapeHtml = escapeHtml;

  // ============================================
  // Form: 通用表单提交 helper
  //   - 自动 e.preventDefault()
  //   - 自动 disable button + 改文字
  //   - 自动显示错误 (在 id="err" 元素里) 或 toast
  //   - 成功 → 跳 redirect 或 调 onSuccess
  //
  // 用法:
  //   Form.bind('#login-form', {
  //     url: '/api/admin/auth/login',
  //     btnText: '登录',
  //     busyText: '登录中...',
  //     redirect: '/admin/dashboard',  // 或 onSuccess(data) => ...
  //   });
  // ============================================
  window.Form = {
    bind(selector, opts) {
      const form = typeof selector === 'string' ? document.querySelector(selector) : selector;
      if (!form) { console.error('[Form.bind] form not found:', selector); return; }
      const {
        url,
        method = 'POST',
        body = 'form',  // 'form' = form element (urlencoded), 'json' = FormData → object
        btnText,
        busyText = '提交中...',
        errBox = '#err',
        useToast = false,  // 用 toast 显示错误代替 errBox
        beforeSubmit,      // (form) => string | null; 返回 string = error msg, 阻止提交
        successRedirect,
        onSuccess,
        onError,
      } = opts;
      const errEl = errBox ? document.querySelector(errBox) : null;
      const btn = form.querySelector('button[type="submit"]');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        // 客户端校验
        if (beforeSubmit) {
          const validationErr = beforeSubmit(form);
          if (validationErr) {
            if (useToast) window.toast(validationErr, true);
            else if (errEl) { errEl.textContent = validationErr; errEl.style.display = 'block'; }
            return;
          }
        }
        if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
        if (btn) { btn.disabled = true; btn.textContent = busyText; }
        try {
          const requestOpts = { silent: !useToast };  // 已经在 errBox 模式自己显示
          const finalBody = body === 'form' ? form : this._formToObject(form);
          const fn = window.api[method.toLowerCase()].bind(window.api);
          const result = await fn(url, finalBody, requestOpts);
          if (!result.ok) {
            const msg = result.error || '提交失败';
            if (useToast) window.toast(msg, true);
            else if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
            if (btn) { btn.disabled = false; btn.textContent = btnText; }
            if (onError) onError(result);
            return;
          }
          if (onSuccess) {
            onSuccess(result.data);
          } else if (successRedirect) {
            // successRedirect 可以是 string (固定 URL) 或 function (data) => url
            const target = typeof successRedirect === 'function' ? successRedirect(result.data) : successRedirect;
            if (target) window.location.href = target;
          }
        } catch (err) {
          if (useToast) window.toast('网络错误: ' + err.message, true);
          else if (errEl) { errEl.textContent = '网络错误: ' + err.message; errEl.style.display = 'block'; }
          if (btn) { btn.disabled = false; btn.textContent = btnText; }
        }
      });
    },
    _formToObject(form) {
      const fd = new FormData(form);
      const obj = {};
      for (const [k, v] of fd.entries()) {
        if (obj[k] !== undefined) {
          if (!Array.isArray(obj[k])) obj[k] = [obj[k]];
          obj[k].push(v);
        } else {
          obj[k] = v;
        }
      }
      return obj;
    },
  };

  console.log('[admin-common] loaded');
})();
