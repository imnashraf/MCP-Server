import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { bearerAuth } from '../../src/auth/mcp-auth.js';
import { TOKEN } from '../helpers.js';

function run(mw: ReturnType<typeof bearerAuth>, authorization?: string) {
  let status = 200;
  let nexted = false;
  const res = { setHeader: () => res, status: (s: number) => ((status = s), res), json: () => res } as unknown as Response;
  mw({ header: () => authorization } as unknown as Request, res, () => (nexted = true));
  return { status, nexted };
}

describe('bearerAuth failure throttle', () => {
  it('accepts only the exact token', () => {
    const mw = bearerAuth(TOKEN);
    expect(run(mw, `Bearer ${TOKEN}`).nexted).toBe(true);
    for (const bad of [undefined, '', 'Bearer', `Bearer ${TOKEN}x`, `Basic ${TOKEN}`, 'Bearer nope']) expect(run(mw, bad)).toEqual({ status: 401, nexted: false });
  });
  it('throttles failures globally (not per IP) but never blocks a valid token', () => {
    let t = 0;
    const mw = bearerAuth(TOKEN, { maxFailuresPerMinute: 3, now: () => t });
    expect([1, 2, 3].map(() => run(mw, 'Bearer bad').status)).toEqual([401, 401, 401]);
    expect(run(mw, 'Bearer bad').status).toBe(429);
    expect(run(mw, `Bearer ${TOKEN}`).nexted).toBe(true);
    t = 61_000;
    expect(run(mw, 'Bearer bad').status).toBe(401);
  });
});
