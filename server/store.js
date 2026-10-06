import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, renameSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Highlights are plain files in one folder:
//   <folder>/<Source title>.md        every highlight from that book or page, with its note and conversation
//   <folder>/.margin/<id>.json        the same, for Margin (hidden, so Finder and other tools see only the notes)
// The Markdown is generated from the JSON and rewritten whenever its source changes, so it's for reading, not editing.
// A highlight starts pending, in memory only. It's written once it's kept: with a note, a question, or Enter on its own.
export function createStore(folder) {
  const dataDir = join(folder, '.margin');
  mkdirSync(dataDir, { recursive: true });
  const highlights = new Map();
  const writeAtomic = (file, text) => { writeFileSync(file + '.tmp', text); renameSync(file + '.tmp', file); };

  for (const name of readdirSync(dataDir).filter(n => n.endsWith('.json'))) {
    try { const h = JSON.parse(readFileSync(join(dataDir, name), 'utf8')); highlights.set(h.id, h); }
    catch (err) { console.error(`Skipping ${name}: ${err.message}`); }
  }

  const kept = () => [...highlights.values()].filter(h => !h.pending);
  const safe = name => name.replace(/[\/\\:*?"<>|\x00-\x1f#^[\]]/g, ' ').replace(/\s+/g, ' ').replace(/^\.+/, '').trim().slice(0, 90) || 'Untitled';
  // Each source keeps the file name it was first given; a different source with the same title gets "Title (2)".
  function fileFor(source) {
    const same = kept().find(h => h.source.key === source.key);
    if (same) return same.source.file;
    const taken = new Set(kept().map(h => h.source.file.toLowerCase()));
    let file = safe(source.title) + '.md';
    for (let i = 2; taken.has(file.toLowerCase()); i++) file = `${safe(source.title)} (${i}).md`;
    return file;
  }

  function render(key) {
    const list = kept().filter(h => h.source.key === key).sort((a, b) => a.created - b.created);
    if (!list.length) return null;
    const s = list[0].source;
    const meta = [s.author, s.url ? `<${s.url}>` : s.path, s.kind === 'app' ? s.app : null].filter(Boolean).join(' · ');
    const sections = list.map(h => {
      const when = new Date(h.created).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
      const talk = h.messages.filter(m => !m.error).map(m => m.role === 'user'
        ? `**${m.text.trim().replace(/\n+/g, ' ')}**`
        : m.text.trim() + (m.sources?.length ? `\n\n<small>Sources: ${m.sources.map(x => `[${x.title}](${x.url})`).join(', ')}</small>` : ''));
      return [`## ${when}`, `> ${h.quote.trim().replace(/\n/g, '\n> ')}`, h.note && `*Note:* ${h.note}`, ...talk].filter(Boolean).join('\n\n');
    });
    // Properties up top, so tools and agents can sort and filter sources: every book, everything from this month…
    const day = t => new Date(t).toISOString().slice(0, 10);
    const props = {
      title: s.title, author: s.author, type: s.kind === 'file' ? 'pdf' : s.kind, url: s.url, path: s.path, app: s.app,
      highlights: list.length, first_highlight: day(list[0].created), last_highlight: day(list.at(-1).created)
    };
    const yaml = Object.entries(props).filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k}: ${typeof v === 'number' || /^\d{4}-\d\d-\d\d$/.test(v) ? v : JSON.stringify(v)}`).join('\n');
    return `---\n${yaml}\n---\n\n<!-- Written by Margin. Edits here are overwritten when you add to this source. -->\n\n# ${s.title}\n\n${meta ? `*${meta}*\n\n` : ''}${sections.join('\n\n---\n\n')}\n`;
  }

  /** Highlights matching every word of the query, in the passage, note, conversation or source; best matches first. */
  function search(query) {
    const words = String(query).toLowerCase().match(/[\p{L}\p{N}$]+/gu) || [];
    if (!words.length) return [];
    return kept().map(h => {
      const fields = [[h.quote, 3], [h.note, 3], [h.source.title, 2], [h.source.author, 2], ...h.messages.map(m => [m.text, 1])];
      let score = 0;
      for (const w of words) {
        const hits = fields.reduce((n, [text, weight]) => n + (text?.toLowerCase().split(w).length - 1 || 0) * weight, 0);
        if (!hits) return null;
        score += Math.log(1 + hits);
      }
      return { h, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score || b.h.created - a.h.created).map(r => r.h);
  }

  function save(h) {
    h.updated = Date.now();
    if (h.pending) return;
    writeAtomic(join(dataDir, h.id + '.json'), JSON.stringify(h, null, 2));
    writeAtomic(join(folder, h.source.file), render(h.source.key));
  }

  return {
    folder,
    get: id => { const h = highlights.get(id); if (!h) throw Object.assign(new Error('Highlight not found.'), { status: 404 }); return h; },
    all: () => kept().sort((a, b) => b.created - a.created),
    search,

    create(c) {
      // PDFs sometimes drop the space before an opening quote mark: "shape the“free” side".
      const quote = typeof c.quote === 'string' ? c.quote.trim().slice(0, 30000).replace(/(\w)([“‘])/g, '$1 $2') : '';
      if (!quote) throw new Error('Select some text first, then press ⌃⌥M.');
      const source = identify(c);
      const h = {
        id: randomUUID(), created: Date.now(), pending: true, source, quote, note: undefined, messages: [],
        context: (typeof c.context === 'string' && c.context.trim() ? c.context.slice(0, 4000) : excerpt(c.pageText, quote)) || undefined
      };
      // Old pending highlights belong to cards that were never closed (Margin quit meanwhile).
      for (const old of highlights.values()) if (old.pending && Date.now() - old.created > 3600000) highlights.delete(old.id);
      highlights.set(h.id, h);
      return h;
    },

    keep(h) {
      if (!h.pending) return;
      h.source.file = fileFor(h.source);
      delete h.pending;
      save(h);
    },
    setNote(h, note) { h.note = String(note || '').trim().slice(0, 20000) || undefined; if (h.pending) this.keep(h); else save(h); },
    save,
    /** Discards a highlight. Kept ones are removed from disk and their Markdown file is rewritten (or removed). */
    remove(h) {
      highlights.delete(h.id);
      if (h.pending) return;
      rmSync(join(dataDir, h.id + '.json'), { force: true });
      const text = render(h.source.key), file = join(folder, h.source.file);
      if (text) writeAtomic(file, text); else if (existsSync(file)) rmSync(file);
    },
    view: h => ({ id: h.id, created: h.created, pending: !!h.pending, source: h.source, quote: h.quote, note: h.note, messages: h.messages })
  };
}

/** What a highlight is from: a book, a web page, a file, or an app window. */
export function identify(c) {
  const str = (v, n = 300) => typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined;
  const app = str(c.app, 80) || 'App';
  const url = str(c.url, 2000)?.match(/^https?:\/\//) ? c.url.trim().replace(/#.*$/, '') : undefined;
  const path = str(c.document, 2000)?.startsWith('file://') ? decodeURIComponent(new URL(c.document).pathname) : undefined;
  if (str(c.book?.title)) return { key: `book:${c.book.title}|${c.book.author || ''}`, kind: 'book', title: str(c.book.title), author: str(c.book.author), app };
  // Page titles usually end with the site's name ("Story | Nieman Journalism Lab"), which the URL already says.
  // Window titles add the browser's name too ("… | Nieman Journalism Lab - Google Chrome").
  const title = t => t && t.replace(/\s+[-–—]\s+(Google Chrome|Safari|Arc|Brave|Microsoft Edge|Vivaldi|Opera|Firefox)$/, '')
    .replace(/\s+[|·–—-]\s+[^|·–—-]{2,40}$/, '').trim() || t;
  if (url) return { key: `web:${url}`, kind: 'web', title: title(str(c.pageTitle) || str(c.windowTitle)) || new URL(url).hostname, url, app };
  // "algorithmic-attention-rents.pdf" reads better as "Algorithmic attention rents".
  const named = name => { const t = name.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[-_]+/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
  if (path) return { key: `file:${path}`, kind: 'file', title: named(path.split('/').pop()), path, app };
  return { key: `app:${c.bundleID}:${c.windowTitle || ''}`, kind: 'app', title: str(c.windowTitle) || app, app };
}

/** About 6,000 characters of the page around the quote, so the model sees what the passage is part of. */
export function excerpt(text, quote, size = 6000) {
  if (typeof text !== 'string' || !text.trim()) return undefined;
  const flat = s => s.replace(/\s+/g, ' ').trim();
  const page = flat(text);
  if (page.length <= size) return page;
  const probe = flat(quote).slice(0, 80);
  let at = page.indexOf(probe);
  if (at < 0) at = page.toLowerCase().indexOf(probe.toLowerCase());
  if (at < 0) return page.slice(0, size);
  const start = Math.max(0, Math.min(at - size / 2, page.length - size));
  return (start > 0 ? '…' : '') + page.slice(start, start + size) + (start + size < page.length ? '…' : '');
}
