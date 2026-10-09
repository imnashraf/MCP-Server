import { loadConfig, type AppConfig } from '../src/config/env.js';
import { GoogleAuth } from '../src/auth/google-oauth.js';
import { MemoryTokenStore } from '../src/auth/token-store.js';
import { nullLogger } from '../src/logging/logger.js';
import { GmailService, type GmailPort } from '../src/services/gmail.service.js';
import { GoogleDocsService, type DocsPort } from '../src/services/google-docs.service.js';
import type { IdempotencyStore } from '../src/services/idempotency.js';
import type { ToolDeps } from '../src/tools/runtime.js';

export const DOC_ID = 'abcdefghijklmnopqrstuvwxyz0123456789ABCD';
export const TOKEN = 'x'.repeat(40);

export const testConfig = (env: Record<string, string> = {}): AppConfig =>
  loadConfig({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_TOKEN_STORE_PATH: '/tmp/ugw-test/tokens.json', ...env }, { root: '/nonexistent-root' });

export function fakeGmail(): GmailPort & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    async send(raw) {
      sent.push(raw);
      return { id: 'msg-1', threadId: 'thr-1' };
    },
  };
}

export function fakeDocs(): DocsPort & { appended: Array<{ id: string; text: string }> } {
  const appended: Array<{ id: string; text: string }> = [];
  return {
    appended,
    async getTitle() {
      return 'Test Doc';
    },
    async appendText(id, text) {
      appended.push({ id, text });
    },
  };
}

export function makeDeps(opts: { gmail?: GmailPort; docs?: DocsPort; env?: Record<string, string>; idempotency?: IdempotencyStore } = {}): ToolDeps {
  const config = testConfig(opts.env);
  return {
    config,
    logger: nullLogger,
    auth: new GoogleAuth(config, new MemoryTokenStore()),
    gmail: new GmailService(opts.gmail ?? fakeGmail(), config.gmail),
    docs: new GoogleDocsService(opts.docs ?? fakeDocs()),
    idempotency: opts.idempotency,
  };
}
