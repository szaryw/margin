import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// A stand-in for Ollama or LM Studio: lists one model and streams Chat Completions. Each test sets how it answers.
let reply, received;
const server = createServer(async (req, res) => {
  if (req.url === '/v1/models') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'llama3.2' }] })); return; }
  const chunks = []; for await (const c of req) chunks.push(c);
  received = { url: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks)) };
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const event of reply) res.write(`data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`);
  res.end();
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
process.env.MARGIN_BASE_URL = `http://127.0.0.1:${server.address().port}/v1/`;
process.env.OPENAI_API_KEY = 'sk-must-not-leak';
process.env.MARGIN_API_KEY = process.env.MARGIN_MODEL = '';   // whatever .env says
const { ask, account, searchable } = await import('./llm.js');
test.after(() => server.close());

const highlight = () => ({ source: { kind: 'book', title: 'Middlemarch', author: 'George Eliot', app: 'Books' }, quote: 'It is a narrow mind…', messages: [{ role: 'user', text: 'Who says this?' }] });
const delta = (content, finish_reason = null) => ({ choices: [{ delta: content ? { content } : {}, finish_reason }] });

test('a base URL takes over from OpenAI, without web search or the OpenAI key', async () => {
  reply = [delta('The '), delta('narrator.'), delta(null, 'stop'), '[DONE]'];
  const emitted = [];
  const answer = await ask(highlight(), e => emitted.push(e));
  assert.equal(answer.text, 'The narrator.');
  assert.equal(answer.model, 'llama3.2');
  assert.deepEqual(emitted.map(e => e.text), ['The ', 'narrator.']);
  assert.equal(received.url, '/v1/chat/completions');
  assert.equal(received.auth, undefined);
  assert.equal(received.body.tools, undefined);
  assert.equal(received.body.store, undefined);
  assert.deepEqual(received.body.messages.map(m => m.role), ['system', 'user', 'user']);
  assert.match(received.body.messages[1].content, /Middlemarch/);
  assert.doesNotMatch(received.body.messages[0].content, /search the web/);
  assert.equal(searchable(), false);
  assert.equal(account().via, 'base-url');
});

test('an answer cut off for length counts as stopped early', async () => {
  reply = [delta('The narr'), delta(null, 'length'), '[DONE]'];
  await assert.rejects(ask(highlight(), () => {}), /stopped early/);
});

test('a stream that ends without finishing counts as stopped early', async () => {
  reply = [delta('The narr')];
  await assert.rejects(ask(highlight(), () => {}), /stopped early/);
});
