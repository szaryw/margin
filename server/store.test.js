import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore, identify, excerpt } from './store.js';
import { readEnv } from './config.js';

const temp = () => mkdtempSync(join(tmpdir(), 'margin-test-'));
const book = { app: 'Books', bundleID: 'com.apple.iBooksX', book: { title: 'Middlemarch', author: 'George Eliot' }, quote: 'It is a narrow mind which cannot look at a subject from various points of view.' };

test('a highlight is only written once it is kept', () => {
  const dir = temp(), store = createStore(dir);
  const h = store.create(book);
  assert.equal(readdirSync(dir).filter(f => f.endsWith('.md')).length, 0);
  store.keep(h);
  const md = readFileSync(join(dir, 'Middlemarch.md'), 'utf8');
  assert.match(md, /^# Middlemarch$/m);
  assert.match(md, /\*George Eliot\*/);
  assert.match(md, /> It is a narrow mind/);
});

test('notes and conversations land in the source’s Markdown file and survive a restart', () => {
  const dir = temp(), store = createStore(dir);
  const h = store.create(book);
  store.setNote(h, 'Compare with Dorothea.');
  h.messages.push({ role: 'user', text: 'Who says this?' }, { role: 'assistant', text: 'The narrator.', sources: [{ url: 'https://example.com/a', title: 'Example' }] });
  store.save(h);
  const md = readFileSync(join(dir, 'Middlemarch.md'), 'utf8');
  assert.match(md, /\*Note:\* Compare with Dorothea\./);
  assert.match(md, /\*\*Who says this\?\*\*\n\nThe narrator\./);
  assert.match(md, /\[Example\]\(https:\/\/example.com\/a\)/);
  const again = createStore(dir);
  assert.equal(again.all().length, 1);
  assert.equal(again.all()[0].note, 'Compare with Dorothea.');
});

test('highlights from one source share a file; removing the last one removes it', () => {
  const dir = temp(), store = createStore(dir);
  const a = store.create(book), b = store.create({ ...book, quote: 'Second passage.' });
  store.keep(a); store.keep(b);
  assert.equal(readdirSync(dir).filter(f => f.endsWith('.md')).length, 1);
  const md = readFileSync(join(dir, 'Middlemarch.md'), 'utf8');
  assert.equal(md.match(/^## /gm).length, 2);
  assert.match(md, /narrow mind[\s\S]*---[\s\S]*Second passage/);
  store.remove(a);
  assert.ok(existsSync(join(dir, 'Middlemarch.md')));
  store.remove(b);
  assert.ok(!existsSync(join(dir, 'Middlemarch.md')));
});

test('different sources with the same title get their own files', () => {
  const dir = temp(), store = createStore(dir);
  store.keep(store.create({ app: 'Safari', url: 'https://a.example/x', pageTitle: 'Notes', quote: 'one' }));
  store.keep(store.create({ app: 'Safari', url: 'https://b.example/y', pageTitle: 'Notes', quote: 'two' }));
  assert.deepEqual(readdirSync(dir).filter(f => f.endsWith('.md')).sort(), ['Notes (2).md', 'Notes.md']);
});

test('an empty selection is refused', () => {
  assert.throws(() => createStore(temp()).create({ app: 'Safari', quote: '  ' }), /Select some text/);
});

test('sources are identified by book, page, file or app', () => {
  assert.equal(identify(book).kind, 'book');
  const web = identify({ app: 'Safari', url: 'https://example.com/post#section', pageTitle: 'Post' });
  assert.deepEqual([web.kind, web.url, web.title], ['web', 'https://example.com/post', 'Post']);
  assert.equal(identify({ app: 'Chrome', url: 'https://www.niemanlab.org/x', pageTitle: 'Altman backs “micropayment” model | Nieman Journalism Lab' }).title, 'Altman backs “micropayment” model');
  assert.equal(identify({ app: 'Chrome', url: 'https://www.niemanlab.org/x', windowTitle: 'Story | Nieman Journalism Lab - Google Chrome' }).title, 'Story');
  assert.equal(identify({ app: 'Preview', document: 'file:///Users/me/Paper%20One.pdf' }).title, 'Paper One');
  assert.equal(identify({ app: 'Preview', document: 'file:///Users/me/algorithmic-attention-rents.pdf' }).title, 'Algorithmic attention rents');
  assert.equal(identify({ app: 'Notes', bundleID: 'com.apple.Notes', windowTitle: 'Ideas' }).title, 'Ideas');
});

test('the page excerpt is centred on the quote', () => {
  const page = 'a '.repeat(10000) + 'THE QUOTE IS HERE ' + 'b '.repeat(10000);
  const text = excerpt(page, 'THE QUOTE IS HERE', 1000);
  assert.ok(text.includes('THE QUOTE IS HERE'));
  assert.ok(text.length < 1100);
  assert.equal(excerpt('short page', 'x'), 'short page');
});

test('.env values are read, quoted or not', () => {
  const file = join(temp(), '.env');
  writeFileSync(file, '# comment\nOPENAI_API_KEY="sk-test"\nMARGIN_MODEL=gpt-5.5\nMARGIN_DIR=~/Notes\n');
  assert.deepEqual(readEnv(file), { OPENAI_API_KEY: 'sk-test', MARGIN_MODEL: 'gpt-5.5', MARGIN_DIR: '~/Notes' });
});

test('notes start with properties tools can query', () => {
  const dir = temp(), store = createStore(dir);
  store.keep(store.create(book));
  const md = readFileSync(join(dir, 'Middlemarch.md'), 'utf8');
  assert.match(md, /^---\ntitle: "Middlemarch"\nauthor: "George Eliot"\ntype: "book"\napp: "Books"\nhighlights: 1\nfirst_highlight: \d{4}-\d\d-\d\d\nlast_highlight: \d{4}-\d\d-\d\d\n---\n\n<!-- Written by Margin\. Edits here are overwritten when you add to this source\. -->\n\n# Middlemarch/);
});

test('search finds highlights by passage, note or conversation, and needs every word', () => {
  const store = createStore(temp());
  const a = store.create(book); store.setNote(a, 'Compare with Dorothea.');
  const b = store.create({ app: 'Safari', url: 'https://x.example/p', pageTitle: 'Micropayments', quote: 'Agents could pay per read.' });
  b.messages.push({ role: 'user', text: 'Would pennies add up?' }); store.keep(b);
  store.create({ ...book, quote: 'pending, never kept' });
  assert.deepEqual(store.search('dorothea').map(h => h.id), [a.id]);
  assert.deepEqual(store.search('pennies agents').map(h => h.id), [b.id]);
  assert.deepEqual(store.search('pennies dorothea'), []);
  assert.deepEqual(store.search('never kept'), []);
});
