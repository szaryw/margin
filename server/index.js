import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { config, root } from './config.js';
import { createStore } from './store.js';
import { account, ask, searchable } from './llm.js';

// Margin's local server: keeps highlights and talks to the model. The Margin menu-bar app starts it and shows its card
// (card/card.html) beside your selection. It only listens on 127.0.0.1.
const store = createStore(config.folder);
const base = `http://127.0.0.1:${config.port}`;
const running = new Set();
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const fail = (status, message) => Object.assign(new Error(message), { status });

async function body(req, limit = 8_000_000) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw fail(413, 'Too large.'); chunks.push(chunk); }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch { throw fail(400, 'Invalid JSON.'); }
}
const json = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };

const routes = [
  ['GET', /^\/api\/status$/, () => ({ ...account(), folder: store.folder, webSearch: searchable() })],
  ['GET', /^\/api\/highlights$/, () => store.all().map(store.view)],
  ['POST', /^\/api\/highlights$/, async req => store.view(store.create(await body(req)))],
  ['GET', /^\/api\/highlights\/([\w-]+)$/, (req, id) => store.view(store.get(id))],
  ['POST', /^\/api\/highlights\/([\w-]+)\/keep$/, (req, id) => { const h = store.get(id); store.keep(h); return store.view(h); }],
  ['PUT', /^\/api\/highlights\/([\w-]+)\/note$/, async (req, id) => {
    const { note } = await body(req);
    if (typeof note !== 'string' || note.length > 20000) throw fail(400, 'Invalid note.');
    const h = store.get(id); store.setNote(h, note); return store.view(h);
  }],
  // ?pending=1 is the card closing: only a highlight that was never kept is discarded.
  ['DELETE', /^\/api\/highlights\/([\w-]+)$/, (req, id, query) => {
    const h = store.get(id);
    if (query.get('pending') && !h.pending) return { ok: true, kept: true };
    if (running.has(id)) throw fail(409, 'Wait for the answer first.');
    store.remove(h); return { ok: true };
  }],
  ['POST', /^\/api\/highlights\/([\w-]+)\/ask$/, async (req, id, query, res) => {
    const h = store.get(id), { message } = await body(req);
    if (typeof message !== 'string' || !message.trim() || message.length > 20000) throw fail(400, 'Type a question first.');
    if (running.has(id)) throw fail(409, 'An answer is already on its way.');
    if (!account().via) throw fail(401, 'Margin isn’t connected to a model. Put OPENAI_API_KEY or MARGIN_BASE_URL in .env, or run `npm run login`.');
    running.add(id);
    const question = { id: randomUUID(), role: 'user', text: message.trim(), created: Date.now() };
    h.messages.push(question); store.keep(h); store.save(h);   // asking about a highlight keeps it
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
    const emit = event => { if (!res.destroyed) res.write(JSON.stringify(event) + '\n'); };
    emit({ type: 'user', message: question });
    try {
      const { text, sources, model } = await ask(h, emit);
      const answer = { id: randomUUID(), role: 'assistant', text, model, created: Date.now(), ...(sources.length && { sources }) };
      h.messages.push(answer); store.save(h); emit({ type: 'done', message: answer });
    } catch (err) { question.error = err.message; store.save(h); emit({ type: 'error', error: err.message }); }
    finally { running.delete(id); res.end(); }
  }],
  ['POST', /^\/api\/reveal$/, () => new Promise(done => execFile('open', [store.folder], () => done({ ok: true })))]
];

const server = createServer(async (req, res) => {
  try {
    // Only this machine's own pages may call in: no other host names (DNS rebinding) and no other web pages.
    if (req.headers.host !== `127.0.0.1:${config.port}`) throw fail(403, `Open Margin at ${base}`);
    if (req.headers.origin && req.headers.origin !== base) throw fail(403, 'Origin not allowed.');
    const url = new URL(req.url, base);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.headers['x-margin'] !== '1') throw fail(403, 'Missing application header.');
      for (const [method, pattern, handler] of routes) {
        const m = req.method === method && url.pathname.match(pattern);
        if (!m) continue;
        const result = await handler(req, m[1], url.searchParams, res);
        if (!res.headersSent) json(res, result);
        return;
      }
      throw fail(404, 'Unknown endpoint.');
    }
    const file = { '/card': 'card.html', '/card.html': 'card.html', '/card.css': 'card.css', '/card.js': 'card.js' }[url.pathname];
    if (!file || req.method !== 'GET') throw fail(404, 'Not found.');
    res.writeHead(200, { 'Content-Type': types[extname(file)], 'Cache-Control': 'no-cache' });
    res.end(readFileSync(join(root, 'server/card', file)));
  } catch (err) {
    if (!err.status) console.error(err);
    if (!res.headersSent) json(res, { error: err.message || 'Something went wrong.' }, err.status || 500);
    else res.end();
  }
});

server.listen(config.port, '127.0.0.1', () => {
  const a = account();
  console.log(`Margin is running at ${base}`);
  console.log(`Saving highlights to ${store.folder}`);
  console.log(a.via === 'base-url' ? `Answers: ${a.server}${config.model ? `, model ${config.model}` : ''}` : a.via === 'api-key' ? `Answers: OpenAI API key, model ${a.model}` : a.via === 'chatgpt' ? `Answers: ChatGPT plan (${a.email})${config.model ? `, model ${config.model}` : ''}` : 'Answers: not connected. Put OPENAI_API_KEY or MARGIN_BASE_URL in .env, or run `npm run login`. Notes still work.');
});
server.on('error', err => { console.error(err.code === 'EADDRINUSE' ? `Port ${config.port} is in use: Margin is probably running already.` : err.message); process.exit(1); });
