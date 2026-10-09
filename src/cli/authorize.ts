import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { CodeChallengeMethod } from 'google-auth-library';
import { createOAuthClient, requiredScopes } from '../auth/google-oauth.js';
import { FileTokenStore } from '../auth/token-store.js';
import { ConfigError, loadConfig } from '../config/env.js';
import { loadDotEnv } from '../config/paths.js';

const out = (s: string) => process.stderr.write(`${s}\n`);

/** One-time interactive OAuth consent (loopback redirect + PKCE). Tokens go only to the private token store. */
async function main(): Promise<void> {
  loadDotEnv();
  if (process.argv.includes('--revoke')) return revoke();
  const config = loadConfig();
  const redirect = new URL(config.google.redirectUri);
  if (redirect.hostname !== '127.0.0.1' && redirect.hostname !== 'localhost') {
    throw new ConfigError('npm run auth needs a loopback GOOGLE_REDIRECT_URI (e.g. http://127.0.0.1:53682/oauth2callback).');
  }
  const client = createOAuthClient(config);
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const state = randomBytes(16).toString('hex');
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // guarantees a refresh token
    scope: requiredScopes(config.capabilities),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', redirect.origin);
      if (u.pathname !== redirect.pathname) {
        res.writeHead(404).end();
        return;
      }
      const err = u.searchParams.get('error');
      const got = u.searchParams.get('code');
      const ok = !err && got && u.searchParams.get('state') === state;
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(ok ? 'Authorization complete. You can close this tab.' : 'Authorization failed. Return to the terminal.');
      server.close();
      if (ok) resolve(got);
      else reject(new Error(err ? `Authorization denied (${err}).` : 'Invalid OAuth callback (state mismatch).'));
    });
    server.once('error', reject);
    server.listen(Number(redirect.port || 80), redirect.hostname, () => {
      out('Open this URL in your browser and approve access:\n');
      out(url);
      out(`\nWaiting for the redirect on ${redirect.origin}${redirect.pathname} ...`);
    });
  });

  const { tokens } = await client.getToken({ code, codeVerifier });
  if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Revoke the app at myaccount.google.com/permissions and retry.');
  let email: string | undefined;
  if (tokens.id_token) {
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.google.clientId });
    email = ticket.getPayload()?.email;
  }
  new FileTokenStore(config.google.tokenStorePath).save({
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token ?? undefined,
    expiry_date: tokens.expiry_date ?? undefined,
    scope: tokens.scope,
    email,
  });
  out(`\nAuthorized${email ? ` as ${email}` : ''}. Tokens saved to ${config.google.tokenStorePath} (owner-only permissions).`);
}

async function revoke(): Promise<void> {
  const config = loadConfig();
  const store = new FileTokenStore(config.google.tokenStorePath);
  const tokens = store.load();
  if (tokens?.refresh_token) {
    try {
      await createOAuthClient(config).revokeToken(tokens.refresh_token);
      out('Token revoked at Google.');
    } catch {
      out('Could not revoke at Google (already revoked or offline). Revoke manually at https://myaccount.google.com/permissions');
    }
  }
  store.clear();
  out('Local token store deleted.');
}

main().catch((err: unknown) => {
  out(err instanceof Error ? err.message.replace(/(code|token)=[^&\s]+/gi, '$1=[REDACTED]') : 'Authorization failed.');
  process.exit(1);
});
