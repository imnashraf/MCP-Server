import type { LogLevel } from '../config/env.js';

/**
 * Structured, secret-safe JSON logger.
 *
 * - Always writes to stderr (never stdout) so the stdio MCP transport stays protocol-clean.
 * - Recursively redacts secret-bearing keys (tokens, secrets, auth headers) and private
 *   content keys (email bodies, document text, Bcc lists) before serialization.
 * - Scrubs token-shaped substrings from free-form strings as a second line of defence.
 */

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

const LEVEL_ORDER: Record<Exclude<LogLevel, 'silent'>, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export const REDACTED = '[REDACTED]';

/** Keys whose values are credentials. Matched case-insensitively as substrings. */
const SECRET_KEY_PATTERN =
  /(token|secret|password|passwd|authorization|cookie|api[-_]?key|credential|private[-_]?key|code_verifier|client_secret)/i;

/** Keys whose values are private user content. Matched exactly (case-insensitive). */
const CONTENT_KEYS = new Set([
  'body',
  'body_text',
  'body_html',
  'bodytext',
  'bodyhtml',
  'text',
  'content',
  'raw',
  'bcc',
  'subject',
  'requestbody',
  'auth_code',
  'authorization_code',
  'data',
]);

/** Token-shaped substrings that must never appear in logs, even inside messages. */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /ya29\.[A-Za-z0-9._-]+/g, // Google OAuth access tokens
  /1\/\/[A-Za-z0-9._-]{20,}/g, // Google OAuth refresh tokens
  /GOCSPX-[A-Za-z0-9_-]+/g, // Google OAuth client secrets
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, // Authorization header values
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g, // JWTs (id_tokens)
  /([?&](?:code|access_token|refresh_token|client_secret|token)=)[^&\s"']+/gi, // secrets in query strings
];

export function scrubString(value: string): string {
  let out = value;
  for (const re of SECRET_VALUE_PATTERNS) {
    out = out.replace(re, (match, prefix: unknown) => (typeof prefix === 'string' && match.startsWith(prefix) ? `${prefix}${REDACTED}` : REDACTED));
  }
  return out;
}

function isSensitiveKey(key: string): boolean {
  // Allow well-known safe keys that merely *contain* a sensitive word.
  if (key === 'token_present' || key === 'token_store' || key === 'error_code') return false;
  return SECRET_KEY_PATTERN.test(key) || CONTENT_KEYS.has(key.toLowerCase());
}

/** Returns a deep copy of `value` with secrets and private content removed. */
export function redact(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (depth > 8) return '[Truncated]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value instanceof Error) return serializeError(value, depth, seen);
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSensitiveKey(k) ? (v === undefined ? undefined : REDACTED) : redact(v, depth + 1, seen);
    }
    return out;
  }
  return undefined;
}

let includeStacks = false;

function serializeError(err: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  const out: Record<string, unknown> = { name: err.name, message: scrubString(err.message) };
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' || typeof code === 'number') out.code = code;
  const status = (err as { status?: unknown }).status;
  if (typeof status === 'number') out.status = status;
  // Stack traces are only emitted at debug level, and always scrubbed.
  if (includeStacks && err.stack) out.stack = scrubString(err.stack);
  if (err.cause !== undefined && depth < 4) out.cause = redact(err.cause, depth + 1, seen);
  return out;
}

export interface LoggerOptions {
  level: LogLevel;
  sink?: { write(chunk: string): unknown };
  base?: LogFields;
  now?: () => Date;
}

export function createLogger(opts: LoggerOptions): Logger {
  const sink = opts.sink ?? process.stderr;
  const now = opts.now ?? (() => new Date());
  const threshold = opts.level === 'silent' ? Infinity : LEVEL_ORDER[opts.level];
  includeStacks = opts.level === 'debug';

  const make = (base: LogFields): Logger => {
    const emit = (level: keyof typeof LEVEL_ORDER, msg: string, fields?: LogFields) => {
      if (LEVEL_ORDER[level] < threshold) return;
      const record = redact({ ...base, ...fields }) as LogFields;
      const line = JSON.stringify({ ts: now().toISOString(), level, msg: scrubString(msg), ...record });
      try {
        sink.write(`${line}\n`);
      } catch {
        /* never let logging crash the server */
      }
    };
    return {
      debug: (m, f) => emit('debug', m, f),
      info: (m, f) => emit('info', m, f),
      warn: (m, f) => emit('warn', m, f),
      error: (m, f) => emit('error', m, f),
      child: (fields) => make({ ...base, ...fields }),
    };
  };
  return make(opts.base ?? {});
}

/** A logger that discards everything (useful in tests). */
export const nullLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => nullLogger,
};
