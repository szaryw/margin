// The card the Margin app shows beside a selection. A highlight starts pending and is kept once you:
//   press Enter on the empty box (just the highlight), type a note and press Enter, or ask with ⌘Enter.
// Esc, or clicking back into what you were reading, closes the card and discards a highlight that wasn't kept.
// The app loads this page once and drives it through window.marginOpen(id | null), marginFail(message) and marginBlur().
// It hears back through the `margin` message handler: ready, close, resize { height }, drag { x, y }, open { url }.
(() => {
  const native = message => window.webkit?.messageHandlers?.margin?.postMessage(message);
  const $ = selector => document.querySelector(selector);
  const el = {
    card: $('#card'), meta: $('.meta'), spinner: $('.spinner'), close: $('.close'), body: $('.body'), quote: $('.quote'),
    thread: $('.thread'), error: $('.error'), foot: $('.foot'), input: $('textarea'), hint: $('.hint'), send: $('.send'),
    actions: $('.actions'), model: $('.model')
  };
  const THREAD_HEIGHT = 520;
  let state = 'idle', highlight = null, current = null, streaming = null, working = '', account = {}, closeTimer;

  async function api(path, options = {}) {
    const response = await fetch('/api' + path, { ...options, body: options.body && JSON.stringify(options.body), headers: { 'Content-Type': 'application/json', 'X-Margin': '1' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }
  const discard = id => api(`/highlights/${id}?pending=1`, { method: 'DELETE' }).catch(() => {});

  /* ---------- a small, safe Markdown renderer ---------- */
  const escape = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const inline = s => escape(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  function markdown(text) {
    const lines = text.replace(/\r/g, '').split('\n'), out = [], item = /^\s*(?:[-*•]|\d+[.)])\s+/;
    for (let i = 0; i < lines.length;) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      if (/^\s*```/.test(line)) {
        const buf = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
        i++; out.push(`<pre><code>${escape(buf.join('\n'))}</code></pre>`); continue;
      }
      const heading = line.match(/^#{1,6}\s+(.*)/);
      if (heading) { out.push(`<h4>${inline(heading[1])}</h4>`); i++; continue; }
      if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
        out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`); continue;
      }
      if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
        const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
        const head = cells(line), rows = [];
        i += 2;
        while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
        out.push(`<div class="table"><table><thead><tr>${head.map(t => `<th>${inline(t)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(t => `<td>${inline(t)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      if (item.test(line)) {
        const tag = /^\s*\d/.test(line) ? 'ol' : 'ul', items = [];
        while (i < lines.length && (item.test(lines[i]) || (items.length && /^\s{2,}\S/.test(lines[i])))) {
          if (item.test(lines[i])) items.push(lines[i].replace(item, '')); else items[items.length - 1] += ' ' + lines[i].trim();
          i++;
        }
        out.push(`<${tag}>${items.map(t => `<li>${inline(t)}</li>`).join('')}</${tag}>`); continue;
      }
      // A paragraph always takes its first line, so a line no rule claims (a table row still streaming in) can't stall the loop.
      const buf = [lines[i++]];
      while (i < lines.length && lines[i].trim() && !/^\s*(```|>|#{1,6}\s|\|)/.test(lines[i]) && !item.test(lines[i])) buf.push(lines[i++]);
      out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
    }
    return `<div class="md">${out.join('')}</div>`;
  }
  const host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
  const sources = list => list?.length ? `<div class="sources">${list.map(s => `<a href="${escape(s.url)}" title="${escape(s.title || s.url)}">${escape(host(s.url))}</a>`).join('')}</div>` : '';

  /* ---------- drawing ---------- */
  function render() {
    const thread = state === 'thread', card = state === 'card';
    el.card.hidden = state === 'idle';
    el.card.classList.toggle('thread-mode', thread);
    el.spinner.hidden = state !== 'capturing';
    el.close.hidden = !(thread || state === 'error');
    el.foot.hidden = !(card || thread);
    el.body.hidden = !(thread || state === 'error' || (card && el.error.textContent));
    el.quote.hidden = el.thread.hidden = !thread;
    if (state === 'capturing') el.meta.textContent = 'Highlighting…';
    if (state === 'error') el.meta.textContent = '';
    if (highlight && (card || thread)) {
      const s = highlight.source;
      if (!el.meta.dataset.status) el.meta.textContent = [s.title, s.author].filter(Boolean).join(' · ');
      el.meta.title = el.meta.textContent;
      el.quote.firstChild.textContent = highlight.quote;
      el.input.placeholder = thread ? 'Ask a follow-up…' : 'Add a note or ask a question';
      const typed = !!el.input.value.trim();
      el.hint.hidden = thread || typed || !!el.meta.dataset.status;
      el.send.hidden = !thread;
      el.send.disabled = !typed || streaming !== null;
      el.actions.hidden = thread || !typed;
      el.model.textContent = account.model || '';
    }
    if (thread) drawThread();
    report();
  }

  function drawThread() {
    const html = highlight.messages.map(m => m.role === 'user'
      ? `<div class="msg user"><div class="bubble">${escape(m.text)}</div>${m.error ? `<div class="msg-error">${escape(m.error)}</div>` : ''}</div>`
      : `<div class="msg assistant">${markdown(m.text)}${sources(m.sources)}</div>`);
    if (streaming !== null) html.push(`<div class="msg assistant">${streaming ? markdown(streaming) : working ? `<div class="working"><span class="spinner"></span>${escape(working)}</div>` : '<div class="thinking"><span></span><span></span><span></span></div>'}</div>`);
    el.thread.innerHTML = html.join('');
    el.body.scrollTop = el.body.scrollHeight;
  }

  // The window follows the card's height; a conversation gets a taller, fixed window that scrolls inside.
  function report() {
    if (state === 'idle') return;
    native({ type: 'resize', height: state === 'thread' ? THREAD_HEIGHT : Math.ceil(el.card.getBoundingClientRect().height) });
  }
  new ResizeObserver(report).observe(el.card);

  function showError(message) {
    el.error.textContent = message;
    el.error.hidden = !message;
    if (message && state === 'card') el.body.hidden = false;
    render();
  }

  function close() {
    clearTimeout(closeTimer);
    if (current) discard(current);
    current = null; highlight = null; state = 'idle';
    native({ type: 'close' });
    render();
  }

  /* ---------- actions ---------- */
  async function save() {
    if (!highlight) return;
    const note = el.input.value.trim(), id = highlight.id;
    try {
      if (note) await api(`/highlights/${id}/note`, { method: 'PUT', body: { note } });
      else await api(`/highlights/${id}/keep`, { method: 'POST' });
      el.input.value = '';
      el.meta.dataset.status = '1';
      el.meta.textContent = note ? 'Note saved' : 'Saved';
      render();
      closeTimer = setTimeout(close, 900);
    } catch (err) { showError(err.message); }
  }

  async function ask() {
    const text = el.input.value.trim(), id = highlight?.id;
    if (!id || !text || streaming !== null) return;
    if (!account.via) { showError('Margin isn’t connected to a model. Put OPENAI_API_KEY or MARGIN_BASE_URL in .env, or run npm run login.'); return; }
    state = 'thread'; streaming = ''; working = ''; el.input.value = ''; showError('');
    const push = m => { if (highlight?.id === id) highlight.messages.push(m); };
    let finished = false;
    try {
      const response = await fetch(`/api/highlights/${id}/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Margin': '1' }, body: JSON.stringify({ message: text }) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Request failed.');
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let i;
        while ((i = buffer.indexOf('\n')) !== -1) {
          const event = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
          if (highlight?.id !== id) continue;
          if (event.type === 'user') push(event.message);
          if (event.type === 'status') working = event.text;
          if (event.type === 'delta') streaming += event.text;
          if (event.type === 'done') { finished = true; streaming = null; push(event.message); }
          if (event.type === 'error') { finished = true; el.error.textContent = event.error; }
          render();
        }
      }
      if (!finished) throw new Error('The connection was interrupted. Your question is saved.');
    } catch (err) { el.error.textContent = err.message; }
    finally {
      if (highlight?.id === id) { streaming = null; el.error.hidden = !el.error.textContent; render(); el.input.focus(); }
    }
  }

  /* ---------- driven by the app ---------- */
  window.marginOpen = async id => {
    if (current && current !== id) discard(current);   // a new highlight replaced a card left open
    clearTimeout(closeTimer);
    current = id; highlight = null; streaming = null;
    el.input.value = ''; el.error.textContent = ''; el.error.hidden = true; delete el.meta.dataset.status;
    el.quote.classList.remove('expanded');
    if (!id) { state = 'capturing'; render(); return; }
    try {
      const [h, status] = await Promise.all([api('/highlights/' + id), api('/status')]);
      if (current !== id) return;
      highlight = h; account = status; state = 'card';
      render();
      setTimeout(() => el.input.focus(), 30);
    } catch (err) { if (current === id) window.marginFail(err.message); }
  };
  window.marginFail = message => { current = null; highlight = null; state = 'error'; el.error.textContent = message; el.error.hidden = false; render(); };
  // Clicking back into the page closes a card you haven't typed in.
  window.marginBlur = () => { if (state === 'card' && !el.input.value.trim()) close(); };

  el.input.addEventListener('input', () => {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 120) + 'px';
    render();
  });
  el.input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    if (state === 'thread' || e.metaKey) ask(); else save();
  });
  el.hint.addEventListener('click', save);
  el.send.addEventListener('click', ask);
  el.close.addEventListener('click', close);
  el.quote.addEventListener('click', () => { el.quote.classList.toggle('expanded'); report(); });
  el.actions.addEventListener('click', e => {
    const action = e.target.closest('button')?.dataset.action;
    if (action === 'save') save(); else if (action === 'ask') ask();
  });
  // Links in answers open in the browser, never inside the card.
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (a) { e.preventDefault(); native({ type: 'open', url: a.href }); }
  });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  // Pressing on the card's surface (not a control or text) moves the window; the app does the moving.
  window.addEventListener('mousedown', e => {
    if (e.button !== 0 || !e.target.closest('.card') || e.target.closest('button, a, textarea, .thread, .error')) return;
    e.preventDefault();
    native({ type: 'drag', x: e.clientX, y: e.clientY });
  });
  native({ type: 'ready' });
})();
