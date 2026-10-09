import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { AppError, validationError, type Outcome } from '../errors/app-error.js';
import { writePrivateJson } from '../auth/token-store.js';

interface Record_ {
  operation: string;
  fingerprint: string;
  status: 'pending' | 'completed';
  created_at: number;
  /** Safe result payload (ids only, no content) for completed operations. */
  result?: Record<string, unknown>;
}

export type IdempotencyBegin =
  | { kind: 'proceed' }
  | { kind: 'replay'; result: Record<string, unknown> }
  | { kind: 'unknown' };

export interface IdempotencyStore {
  begin(key: string, operation: string, fingerprint: string): IdempotencyBegin;
  complete(key: string, result: Record<string, unknown>): void;
  /** Called when the write is known not to have happened, so the key can be reused. */
  abandon(key: string): void;
}

export const fingerprintOf = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function validateIdempotencyKey(key: unknown): string | undefined {
  if (key === undefined || key === null) return undefined;
  if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw validationError('idempotency_key must be 8-128 characters of letters, digits, ".", "_", ":" or "-".');
  }
  return key;
}

/**
 * Durable single-node idempotency store backed by a private JSON file. Not safe for
 * multi-instance deployments (use a shared store there). Stores only hashes and ids.
 */
export class FileIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly file: string,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private read(): Map<string, Record_> {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, Record_>;
      const cutoff = this.now() - this.ttlMs;
      return new Map(Object.entries(parsed).filter(([, v]) => v.created_at >= cutoff));
    } catch {
      return new Map();
    }
  }

  private write(map: Map<string, Record_>): void {
    writePrivateJson(this.file, Object.fromEntries(map));
  }

  // All methods are synchronous, so the read-modify-write below is atomic within one process.
  begin(key: string, operation: string, fingerprint: string): IdempotencyBegin {
    const map = this.read();
    const existing = map.get(key);
    if (existing) {
      if (existing.operation !== operation || existing.fingerprint !== fingerprint) {
        throw validationError('idempotency_key was already used with different input or a different operation.');
      }
      if (existing.status === 'completed' && existing.result) return { kind: 'replay', result: existing.result };
      return { kind: 'unknown' };
    }
    map.set(key, { operation, fingerprint, status: 'pending', created_at: this.now() });
    this.write(map);
    return { kind: 'proceed' };
  }

  complete(key: string, result: Record<string, unknown>): void {
    const map = this.read();
    const rec = map.get(key);
    if (!rec) return;
    map.set(key, { ...rec, status: 'completed', result });
    this.write(map);
  }

  abandon(key: string): void {
    const map = this.read();
    if (map.delete(key)) this.write(map);
  }
}

/** Runs `fn` under an optional idempotency key, recording only safe result fields. */
export async function withIdempotency<T extends Record<string, unknown>>(
  store: IdempotencyStore | undefined,
  key: string | undefined,
  operation: string,
  fingerprint: string,
  fn: () => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  if (!key) return { result: await fn(), replayed: false };
  if (!store) {
    throw validationError('idempotency_key was supplied but idempotency is disabled on this server (IDEMPOTENCY_ENABLED=false).');
  }
  const begin = store.begin(key, operation, fingerprint);
  if (begin.kind === 'replay') return { result: begin.result as T, replayed: true };
  if (begin.kind === 'unknown') {
    throw new AppError('OUTCOME_UNKNOWN', 'A previous request with this idempotency_key did not report a result; it may have been applied.', {
      outcome: 'unknown' satisfies Outcome,
      hint: 'Verify the destination, then retry with a new idempotency_key only if the change is absent.',
    });
  }
  try {
    const result = await fn();
    store.complete(key, result);
    return { result, replayed: false };
  } catch (err) {
    if (err instanceof AppError && err.outcome === 'not_performed') store.abandon(key);
    throw err;
  }
}
