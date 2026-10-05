import { config } from './config.js';
import { createStore } from './store.js';

// `npm run search -- <words>`: finds highlights whose passage, note, conversation or source contains every word.
// `--json` prints the matches as JSON, for piping into other tools.
const args = process.argv.slice(2), json = args.includes('--json');
const query = args.filter(a => a !== '--json').join(' ');
if (!query.trim()) { console.error('Usage: npm run search -- <words> [--json]'); process.exit(1); }

const results = createStore(config.folder).search(query);
if (json) { console.log(JSON.stringify(results.map(({ context, ...h }) => h), null, 2)); process.exit(0); }
if (!results.length) { console.log(`No highlights match “${query}”.`); process.exit(0); }

const clip = (s, n) => { s = s.replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
for (const h of results.slice(0, 20)) {
  const s = h.source, when = new Date(h.created).toLocaleDateString('en-GB', { dateStyle: 'medium' });
  console.log(`\n${[s.title, s.author].filter(Boolean).join(' · ')}  (${when})`);
  console.log(`  > ${clip(h.quote, 160)}`);
  if (h.note) console.log(`  Note: ${clip(h.note, 160)}`);
  for (const m of h.messages.filter(m => m.role === 'user' && !m.error)) console.log(`  Q: ${clip(m.text, 160)}`);
  console.log(`  ${config.folder}/${s.file}`);
}
console.log(`\n${results.length} highlight${results.length === 1 ? '' : 's'} match “${query}”.`);
