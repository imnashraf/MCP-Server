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

/** Express middleware that fails closed: no valid bearer token, no access. */
export function bearerAuth(expectedToken: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = extractBearer(req.header('authorization'));
    if (!token || !tokensMatch(token, expectedToken)) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="mcp"');
      res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
      return;
    }
    next();
  };
}
