import { describe, expect, it } from 'vitest';
import { normalizeError } from '../../src/errors/normalize-error.js';

const http = (status: number, reason = '') => Object.assign(new Error('secret ya29.abc detail'), { status, errors: [{ reason }] });

describe('normalizeError', () => {
  it.each([
    [401, '', 'AUTH_EXPIRED_OR_REVOKED'],
    [403, 'insufficientPermissions', 'INSUFFICIENT_SCOPE'],
    [403, 'rateLimitExceeded', 'RATE_LIMITED'],
    [403, 'forbidden', 'PERMISSION_DENIED'],
    [404, '', 'RESOURCE_NOT_FOUND'],
    [429, '', 'RATE_LIMITED'],
    [400, '', 'GOOGLE_API_ERROR'],
  ])('maps %i/%s -> %s as not_performed on 4xx', (status, reason, code) => {
    const e = normalizeError(http(status, reason), { write: true });
    expect(e.code).toBe(code);
    expect(e.outcome).toBe('not_performed');
  });
  it('maps invalid_grant to AUTH_EXPIRED_OR_REVOKED', () => {
    const err = Object.assign(new Error('x'), { status: 400, response: { data: { error: 'invalid_grant' } } });
    expect(normalizeError(err, { write: true }).code).toBe('AUTH_EXPIRED_OR_REVOKED');
  });
  it('treats 5xx on writes as unknown outcome, on reads as not performed', () => {
    expect(normalizeError(http(503), { write: true }).outcome).toBe('unknown');
    expect(normalizeError(http(503), { write: false }).outcome).toBe('not_performed');
  });
  it('treats timeouts/resets on writes as OUTCOME_UNKNOWN but DNS failure as not performed', () => {
    const t = normalizeError(Object.assign(new Error('t'), { code: 'ETIMEDOUT' }), { write: true });
    expect([t.code, t.outcome]).toEqual(['OUTCOME_UNKNOWN', 'unknown']);
    const d = normalizeError(Object.assign(new Error('d'), { code: 'ENOTFOUND' }), { write: true });
    expect([d.code, d.outcome]).toEqual(['NETWORK_ERROR', 'not_performed']);
  });
  it('never leaks raw upstream messages', () => {
    expect(normalizeError(http(500), { write: true }).message).not.toMatch(/ya29|secret/);
    expect(normalizeError(new Error('boom ya29.zzz'), { write: false }).message).toBe('An unexpected internal error occurred.');
  });
});
