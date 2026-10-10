import { timingSafeEqual, createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Constant-time comparison of a presented bearer token against the configured one. */
export function tokensMatch(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected));
}

export function extractBearer(header: string | undefined): string | undefined {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return m?.[1];
}

export interface BearerAuthOptions {
  /**
   * Global (not per-IP) cap on failed authentication attempts per minute. Behind some PaaS
   * proxies the client IP is unreliable, so per-IP limits can be bypassed; this server is
   * single-user, so a global failure budget is both simpler and sturdier. Valid tokens are
   * always checked first and are never throttled by failures.
   */
  maxFailuresPerMinute?: number;
  now?: () => number;
}

/** Express middleware that fails closed: no valid bearer token, no access. */
export function bearerAuth(expectedToken: string, opts: BearerAuthOptions = {}) {
  const max = opts.maxFailuresPerMinute ?? 30;
  const now = opts.now ?? Date.now;
  let windowStart = now();
  let failures = 0;
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = extractBearer(req.header('authorization'));
    if (token && tokensMatch(token, expectedToken)) {
      next();
      return;
    }
    const t = now();
    if (t - windowStart >= 60_000) {
      windowStart = t;
      failures = 0;
    }
    failures += 1;
    if (failures > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((windowStart + 60_000 - t) / 1000))));
      res.status(429).json({ jsonrpc: '2.0', error: { code: -32002, message: 'Too many failed authentication attempts' }, id: null });
      return;
    }
    res.setHeader('WWW-Authenticate', 'Bearer realm="mcp"');
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
  };
}
