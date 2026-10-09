import { randomUUID } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AppConfig } from '../config/env.js';
import type { GoogleAuth } from '../auth/google-oauth.js';
import { AppError, type Outcome } from '../errors/app-error.js';
import { normalizeError } from '../errors/normalize-error.js';
import type { Logger } from '../logging/logger.js';
import type { GmailService } from '../services/gmail.service.js';
import type { GoogleDocsService } from '../services/google-docs.service.js';
import type { IdempotencyStore } from '../services/idempotency.js';

export interface ToolDeps {
  config: AppConfig;
  logger: Logger;
  auth: GoogleAuth;
  gmail?: GmailService;
  docs?: GoogleDocsService;
  idempotency?: IdempotencyStore;
}

export interface SuccessPayload {
  success: true;
  operation: string;
  request_id: string;
  message: string;
  [k: string]: unknown;
}

export interface FailurePayload {
  success: false;
  operation: string;
  request_id: string;
  error: { code: string; message: string; outcome: Outcome; hint?: string };
}

function toResult(payload: SuccessPayload | FailurePayload): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as unknown as Record<string, unknown>,
    isError: !payload.success,
  };
}

/**
 * Runs one tool invocation: assigns a correlation id, converts every failure into the
 * standard sanitized error payload, and logs operation/result/latency only (no content).
 */
export async function runTool(
  operation: string,
  deps: ToolDeps,
  write: boolean,
  fn: (ctx: { requestId: string; logger: Logger }) => Promise<{ message: string; fields?: Record<string, unknown> }>,
): Promise<CallToolResult> {
  const requestId = randomUUID();
  const logger = deps.logger.child({ request_id: requestId, operation });
  const started = Date.now();
  try {
    const { message, fields } = await fn({ requestId, logger });
    logger.info('tool succeeded', { latency_ms: Date.now() - started });
    return toResult({ success: true, operation, request_id: requestId, message, ...fields });
  } catch (err) {
    const app = err instanceof AppError ? err : normalizeError(err, { write });
    logger.warn('tool failed', {
      error_code: app.code,
      outcome: app.outcome,
      latency_ms: Date.now() - started,
      cause: app.code === 'VALIDATION_ERROR' ? undefined : app.cause,
    });
    return toResult({
      success: false,
      operation,
      request_id: requestId,
      error: { code: app.code, message: app.message, outcome: app.outcome, ...(app.hint ? { hint: app.hint } : {}) },
    });
  }
}
