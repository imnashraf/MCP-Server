import { OAuth2Client } from 'google-auth-library';
import type { AppConfig } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import type { StoredTokens, TokenStore } from './token-store.js';

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const DOCS_SCOPE = 'https://www.googleapis.com/auth/documents';

/** Least-privilege scopes for the enabled capabilities, plus `openid email` to identify the account. */
export function requiredScopes(caps: AppConfig['capabilities']): string[] {
  const scopes = ['openid', 'email'];
  if (caps.gmailSend) scopes.push(GMAIL_SEND_SCOPE);
  if (caps.docsAppend) scopes.push(DOCS_SCOPE);
  return scopes;
}

export function createOAuthClient(config: AppConfig, redirectUri = config.google.redirectUri): OAuth2Client {
  const { clientId, clientSecret } = config.google;
  if (!clientId || !clientSecret) {
    throw new AppError('AUTH_REQUIRED', 'Google OAuth client is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).', {
      hint: 'See the README "Google Cloud setup" section.',
    });
  }
  return new OAuth2Client({ clientId, clientSecret, redirectUri });
}

export interface AuthStatus {
  state: 'ok' | 'not_configured' | 'not_authorized' | 'expired_or_revoked' | 'insufficient_scope' | 'error';
  email?: string;
  missingScopes?: string[];
  reason?: string;
}

/** Provides an authorized OAuth client, refreshing and persisting tokens as needed. */
export class GoogleAuth {
  private client?: OAuth2Client;

  constructor(
    private readonly config: AppConfig,
    private readonly store: TokenStore,
    private readonly clientFactory: () => OAuth2Client = () => createOAuthClient(config),
  ) {}

  /** Returns a ready client or throws AUTH_REQUIRED. Does not contact Google. */
  getClient(): OAuth2Client {
    if (this.client) return this.client;
    const tokens = this.store.load();
    if (!tokens?.refresh_token) {
      throw new AppError('AUTH_REQUIRED', 'No Google authorization found for this server.', { hint: 'Run `npm run auth` once to authorize.' });
    }
    this.assertScopes(tokens.scope);
    const client = this.clientFactory();
    client.setCredentials({
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      expiry_date: tokens.expiry_date,
      scope: tokens.scope,
    });
    client.on('tokens', (t) => {
      const current = this.store.load() ?? {};
      // Google only returns refresh_token on first consent; keep the stored one otherwise.
      const next: StoredTokens = {
        ...current,
        access_token: t.access_token ?? current.access_token,
        expiry_date: t.expiry_date ?? current.expiry_date,
        refresh_token: t.refresh_token ?? current.refresh_token,
        scope: t.scope ?? current.scope,
      };
      this.store.save(next);
    });
    this.client = client;
    return client;
  }

  private assertScopes(granted: string | undefined): void {
    const missing = this.missingScopes(granted);
    if (missing.length > 0) {
      throw new AppError('INSUFFICIENT_SCOPE', 'The stored authorization does not include all required permissions.', {
        hint: 'Re-run `npm run auth` and approve every requested permission.',
      });
    }
  }

  missingScopes(granted: string | undefined): string[] {
    if (granted === undefined) return [];
    const have = new Set(granted.split(/\s+/));
    return requiredScopes(this.config.capabilities)
      .filter((s) => s.startsWith('https://'))
      .filter((s) => !have.has(s));
  }

  /** Lightweight, read-only authorization check. Never returns token material. */
  async check(): Promise<AuthStatus> {
    const { clientId, clientSecret } = this.config.google;
    if (!clientId || !clientSecret) return { state: 'not_configured', reason: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.' };
    const tokens = this.store.load();
    if (!tokens?.refresh_token) return { state: 'not_authorized', reason: 'No stored authorization. Run `npm run auth`.' };
    const missing = this.missingScopes(tokens.scope);
    if (missing.length > 0) return { state: 'insufficient_scope', email: tokens.email, missingScopes: missing, reason: 'Re-run `npm run auth`.' };
    try {
      const { token } = await this.getClient().getAccessToken(); // forces a refresh if expired
      if (!token) return { state: 'expired_or_revoked', email: tokens.email, reason: 'Could not obtain an access token. Re-run `npm run auth`.' };
      return { state: 'ok', email: this.store.load()?.email ?? tokens.email };
    } catch (err) {
      const e = err as { response?: { data?: { error?: unknown } }; message?: unknown };
      const oauthErr = e.response?.data?.error;
      if (oauthErr === 'invalid_grant' || (typeof e.message === 'string' && e.message.includes('invalid_grant'))) {
        return { state: 'expired_or_revoked', email: tokens.email, reason: 'Authorization expired or was revoked. Re-run `npm run auth`.' };
      }
      return { state: 'error', email: tokens.email, reason: 'Could not verify authorization (network or Google error).' };
    }
  }
}
