import type { AppConfig } from './config/env.js';
import { GoogleAuth } from './auth/google-oauth.js';
import { FileTokenStore } from './auth/token-store.js';
import type { Logger } from './logging/logger.js';
import { GmailService, createGmailPort } from './services/gmail.service.js';
import { GoogleDocsService, createDocsPort } from './services/google-docs.service.js';
import { FileIdempotencyStore } from './services/idempotency.js';
import type { ToolDeps } from './tools/runtime.js';

/** Composition root: wires real Google-backed services. Shared by every transport. */
export function buildDeps(config: AppConfig, logger: Logger): ToolDeps {
  const auth = new GoogleAuth(config, new FileTokenStore(config.google.tokenStorePath));
  const getClient = () => auth.getClient();
  const t = config.google.apiTimeoutMs;
  return {
    config,
    logger,
    auth,
    gmail: config.capabilities.gmailSend ? new GmailService(createGmailPort(getClient, t), config.gmail) : undefined,
    docs: config.capabilities.docsAppend ? new GoogleDocsService(createDocsPort(getClient, t)) : undefined,
    idempotency: config.idempotency.enabled
      ? new FileIdempotencyStore(config.idempotency.storePath, config.idempotency.ttlHours * 3_600_000)
      : undefined,
  };
}
