import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { config } from './config.js';
import { createChatGPT } from './chatgpt.js';

// `npm run login`: signs in to ChatGPT once, in your browser, so Margin can use your plan. `npm run logout` undoes it.
const chatgpt = createChatGPT(config.authDir);

if (process.argv.includes('--logout')) {
  await chatgpt.logout();
  console.log('Signed out of ChatGPT. Margin will use OPENAI_API_KEY from .env, if there is one.');
  process.exit(0);
}

const redirect = `http://127.0.0.1:${config.loginPort}/auth/callback`;
const { url, attempt } = chatgpt.begin(redirect);
const page = (title, text) => `<!doctype html><meta charset="utf-8"><title>Margin</title><body style="font:15px -apple-system,sans-serif;max-width:420px;margin:18vh auto;padding:0 20px;color:#1c1c1a"><h2 style="font-weight:600">${title}</h2><p style="color:#5f5e59">${text}</p></body>`;

const server = createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, redirect);
  if (pathname !== '/auth/callback') { res.writeHead(404).end(); return; }
  try {
    const email = await chatgpt.finish(attempt, Object.fromEntries(searchParams));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page('Margin is connected', 'You can close this tab. Select text in any app and press ⌃⌥M.'));
    console.log(`\nSigned in as ${email}. Margin will use your ChatGPT plan.`);
    server.close(); process.exit(0);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(page('Sign-in didn’t finish', err.message.replace(/[<&]/g, '')));
    console.error('\n' + err.message);
    server.close(); process.exit(1);
  }
});

server.listen(config.loginPort, '127.0.0.1', () => {
  console.log('Opening ChatGPT in your browser. Sign in and allow Margin to use your plan.');
  console.log(`If nothing opens, visit:\n\n  ${url}\n`);
  execFile('open', [url], () => {});
});
server.on('error', err => { console.error(err.code === 'EADDRINUSE' ? `Port ${config.loginPort} is busy. Close whatever is using it and try again.` : err.message); process.exit(1); });
setTimeout(() => { console.error('Gave up waiting for the sign-in after 10 minutes.'); process.exit(1); }, 600000).unref();
