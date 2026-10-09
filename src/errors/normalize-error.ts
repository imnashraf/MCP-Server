import { AppError } from './app-error.js';

const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH']);
const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNABORTED', 'ABORT_ERR', 'UND_ERR_CONNECT_TIMEOUT']);

interface ErrLike {
  code?: unknown;
  status?: unknown;
  name?: unknown;
  message?: unknown;
  response?: { status?: unknown; data?: { error?: unknown } };
  errors?: Array<{ reason?: unknown }>;
}

function statusOf(e: ErrLike): number | undefined {
  if (typeof e.status === 'number') return e.status;
  if (typeof e.response?.status === 'number') return e.response.status;
  if (typeof e.code === 'number') return e.code;
  if (typeof e.code === 'string' && /^\d{3}$/.test(e.code)) return Number(e.code);
  return undefined;
}

function reasonOf(e: ErrLike): string {
  const first = e.errors?.[0]?.reason;
  const data = e.response?.data?.error;
  const oauth = typeof data === 'string' ? data : '';
  return `${typeof first === 'string' ? first : ''} ${oauth}`.toLowerCase();
}

export interface NormalizeContext {
  /** Whether the failed call was a write whose side effect may already have been applied. */
  write: boolean;
  /** What the target resource is called in messages, e.g. "document". */
  resource?: string;
}

/**
 * Translates any thrown value into a sanitized AppError. Never copies raw messages from
 * Google/HTTP libraries into the result, since those can contain URLs, tokens or content.
 */
export function normalizeError(err: unknown, ctx: NormalizeContext): AppError {
  if (err instanceof AppError) return err;
  const e = (typeof err === 'object' && err !== null ? err : {}) as ErrLike;
  const status = statusOf(e);
  const code = typeof e.code === 'string' ? e.code : '';
  const reason = reasonOf(e);
  const resource = ctx.resource ?? 'resource';

  if (status === undefined) {
    const timedOut = TIMEOUT_CODES.has(code) || e.name === 'AbortError' || e.name === 'TimeoutError';
    if (timedOut || NETWORK_CODES.has(code) || e.name === 'FetchError' || e.name === 'GaxiosError') {
      // Connection refused / DNS failures happen before anything was sent; resets and timeouts may not.
      const definitelyNotSent = code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN';
      if (ctx.write && !definitelyNotSent) {
        return new AppError('OUTCOME_UNKNOWN', 'The request to Google failed before a response was received, so the write may or may not have been applied.', {
          outcome: 'unknown',
          hint: 'Do not retry blindly. Check the destination (sent folder or document) first, then retry only if the change is absent.',
          cause: err,
        });
      }
      return new AppError('NETWORK_ERROR', 'Could not reach Google APIs.', { outcome: 'not_performed', hint: 'Check network connectivity and retry.', cause: err });
    }
    return new AppError('INTERNAL_ERROR', 'An unexpected internal error occurred.', {
      outcome: ctx.write ? 'unknown' : 'not_performed',
      cause: err,
    });
  }

  if (status === 400 && (reason.includes('invalid_grant') || reason.includes('invalid_rapt'))) {
    return new AppError('AUTH_EXPIRED_OR_REVOKED', 'Google authorization has expired or been revoked.', {
      hint: 'Re-run `npm run auth` to authorize again.',
      cause: err,
    });
  }
  if (status === 401) {
    return new AppError('AUTH_EXPIRED_OR_REVOKED', 'Google rejected the credentials (expired or revoked).', {
      hint: 'Re-run `npm run auth` to authorize again.',
      cause: err,
    });
  }
  if (status === 403) {
    if (reason.includes('insufficient') || reason.includes('scope')) {
      return new AppError('INSUFFICIENT_SCOPE', 'The granted Google permissions do not allow this operation.', {
        hint: 'Re-run `npm run auth` and approve all requested permissions.',
        cause: err,
      });
    }
    if (reason.includes('ratelimit') || reason.includes('quota') || reason.includes('userrate')) {
      return new AppError('RATE_LIMITED', 'Google API quota or rate limit exceeded.', { hint: 'Wait and retry later.', cause: err });
    }
    if (reason.includes('accessnotconfigured') || reason.includes('has not been used') || reason.includes('disabled')) {
      return new AppError('GOOGLE_API_ERROR', 'The required Google API is not enabled for the Cloud project.', {
        hint: 'Enable the Gmail API and Google Docs API in Google Cloud Console.',
        cause: err,
      });
    }
    return new AppError('PERMISSION_DENIED', `The authorized Google account cannot ${ctx.write ? 'modify' : 'access'} this ${resource}.`, { cause: err });
  }
  if (status === 404) {
    return new AppError('RESOURCE_NOT_FOUND', `The ${resource} was not found or is not accessible to the authorized account.`, { cause: err });
  }
  if (status === 429) {
    return new AppError('RATE_LIMITED', 'Google API quota or rate limit exceeded.', { hint: 'Wait and retry later.', cause: err });
  }
  if (status >= 500) {
    // The server may have processed a write before failing.
    return new AppError('GOOGLE_API_ERROR', `Google API returned a server error (${status}).`, {
      outcome: ctx.write ? 'unknown' : 'not_performed',
      hint: ctx.write ? 'The write may have been applied. Verify before retrying.' : 'Retry later.',
      cause: err,
    });
  }
  if (status === 400) {
    return new AppError('GOOGLE_API_ERROR', 'Google rejected the request as invalid.', { cause: err });
  }
  return new AppError('GOOGLE_API_ERROR', `Google API request failed (${status}).`, { cause: err });
}
