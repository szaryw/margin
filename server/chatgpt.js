import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// "Sign in with ChatGPT": lets Margin use your ChatGPT Plus/Pro plan instead of an API key.
// https://developers.openai.com/siwc/token-sharing-open-source/sign-in
// The first sign-in registers Margin as a client of your account; its id and your tokens are kept in .auth/chatgpt.json.
const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const tokenEndpoint = `${issuer}/api/accounts/oauth/token`;
const random = () => randomBytes(32).toString('base64url');
const claims = jwt => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));

export function createChatGPT(dir) {
  const file = join(dir, 'chatgpt.json');
  const load = () => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  let record = load(), refreshing;
  const save = () => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(`${file}.tmp`, JSON.stringify(record, null, 2), { mode: 0o600 }); renameSync(`${file}.tmp`, file);
  };
  const saveTokens = data => {
    record = { ...record, access_token: data.access_token, refresh_token: data.refresh_token || record.refresh_token, id_token: data.id_token || record.id_token, scopes: data.scope ? data.scope.split(' ') : record.scopes || [], expires_at: Date.now() + Number(data.expires_in || 3600) * 1000 };
    save();
  };
  async function exchange(params) {
    const response = await fetch(tokenEndpoint, { method: 'POST', body: new URLSearchParams({ ...params, resource }), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('ChatGPT sign-in expired or was declined. Run `npm run login` again.');
    return response.json();
  }

  return {
    /** Signed in and allowed to use the plan. Re-reads the file, so a login made while the server runs is picked up. */
    get connected() { record = load(); return !!record?.access_token && !!record.scopes?.includes('chatgpt.tokens.use.direct'); },
    get email() { return record?.email; },

    /** The address to open in the browser, and what's needed to finish once it redirects back. */
    begin(redirect) {
      record = load() || { host: `urn:uuid:${randomUUID()}` };
      const state = random(), nonce = random(), verifier = random(), client = record.client_id || 'dynamic_agent_client';
      const params = new URLSearchParams({ client_id: client, ext_agent_host_id: record.host, response_type: 'code', redirect_uri: redirect, scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', resource, state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') });
      if (client === 'dynamic_agent_client') params.set('agent_name_hint', 'Margin');
      else if (record.id_token) params.set('id_token_hint', record.id_token);
      return { url: `${issuer}/api/accounts/authorize?${params}`, attempt: { state, nonce, verifier, client, redirect } };
    },

    async finish(attempt, query) {
      if (query.error) throw new Error(`Sign-in was not completed (${query.error}).`);
      if (query.state !== attempt.state) throw new Error('This sign-in attempt does not match. Run `npm run login` again.');
      const client = query.client_id || attempt.client;
      if (typeof client !== 'string' || client === 'dynamic_agent_client' || (attempt.client !== 'dynamic_agent_client' && client !== attempt.client) || typeof query.code !== 'string') throw new Error('Unexpected reply from ChatGPT.');
      const data = await exchange({ grant_type: 'authorization_code', client_id: client, code: query.code, code_verifier: attempt.verifier, redirect_uri: attempt.redirect });
      // The ID token comes straight from the token endpoint over TLS, so its claims are checked without verifying the
      // signature (OpenID Connect Core §3.1.3.7).
      const id = claims(data.id_token);
      const audience = [].concat(id.aud);
      if (id.iss !== issuer || !audience.includes(client) || id.nonce !== attempt.nonce || !id.sub || id.exp * 1000 < Date.now() || (record.subject && id.sub !== record.subject)) throw new Error('The ChatGPT account did not match this sign-in.');
      record = { ...record, client_id: client, subject: id.sub, email: id.email };
      saveTokens(data);
      if (!record.scopes.includes('chatgpt.tokens.use.direct')) throw new Error('Signed in, but plan usage was not allowed. Run `npm run login` again and allow it.');
      return record.email;
    },

    /** A fresh access token, refreshed a minute before it expires. */
    async token() {
      if (!this.connected) throw new Error('Not signed in to ChatGPT. Run `npm run login`, or put OPENAI_API_KEY in .env.');
      if (record.expires_at < Date.now() + 60000) {
        refreshing ??= exchange({ grant_type: 'refresh_token', client_id: record.client_id, refresh_token: record.refresh_token }).then(saveTokens).finally(() => { refreshing = null; });
        await refreshing;
      }
      return record.access_token;
    },

    async logout() {
      record = load();
      if (record?.refresh_token) {
        try {
          const discovery = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10000) }).then(r => r.json());
          if (new URL(discovery.revocation_endpoint).origin === issuer) await fetch(discovery.revocation_endpoint, { method: 'POST', body: new URLSearchParams({ token: record.refresh_token, token_type_hint: 'refresh_token', client_id: record.client_id }), signal: AbortSignal.timeout(10000) });
        } catch {}
      }
      rmSync(file, { force: true });
      record = null;
    }
  };
}
