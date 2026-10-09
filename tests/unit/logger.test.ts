import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/logging/logger.js';

describe('logger redaction', () => {
  it('redacts secrets and private content', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'debug', sink: { write: (c) => lines.push(c) } });
    log.info('hello Bearer abc.def-123', {
      access_token: 'ya29.secret',
      body_text: 'private body',
      bcc: ['hidden@x.com'],
      nested: { client_secret: 'GOCSPX-abc', text: 'doc text' },
      note: 'refresh 1//0gABCDEFGHIJKLMNOPQRSTUV',
      request_id: 'r1',
    });
    const out = lines.join('');
    for (const s of ['ya29.secret', 'private body', 'hidden@x.com', 'GOCSPX-abc', 'doc text', '1//0gABCDEF', 'abc.def-123']) expect(out).not.toContain(s);
    expect(out).toContain('r1');
  });
});
