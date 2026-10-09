import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors/app-error.js';
import { GmailService } from '../../src/services/gmail.service.js';
import { GoogleDocsService } from '../../src/services/google-docs.service.js';
import { FileIdempotencyStore, withIdempotency } from '../../src/services/idempotency.js';
import { DOC_ID, fakeDocs, fakeGmail, testConfig } from '../helpers.js';

const decode = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8');
const policy = () => testConfig().gmail;
const valid = { to: 'a@example.com', subject: 'Héllo', body_text: 'Body ✓' };

describe('GmailService', () => {
  it('builds MIME with recipients, encoded subject and no From header', async () => {
    const port = fakeGmail();
    const res = await new GmailService(port, policy()).send({ ...valid, cc: ['c@example.com'], bcc: 'b@example.com', reply_to: 'r@example.com' });
    expect(res).toMatchObject({ message_id: 'msg-1', thread_id: 'thr-1', recipient_count: 3 });
    const mime = decode(port.sent[0]!);
    expect(mime).toMatch(/^To: a@example.com\r\nCc: c@example.com\r\nBcc: b@example.com\r\nReply-To: r@example.com\r\nSubject: =\?UTF-8\?B\?/);
    expect(mime).not.toMatch(/^From:/m);
    const body = mime.split('\r\n\r\n')[1]!;
    expect(Buffer.from(body, 'base64').toString('utf8')).toBe('Body ✓');
  });
  it('rejects invalid input before calling Gmail', async () => {
    const port = fakeGmail();
    const svc = new GmailService(port, policy());
    for (const bad of [{ ...valid, to: [] }, { ...valid, subject: '' }, { ...valid, body_text: ' ' }, { ...valid, to: 'x@y.com\nBcc: z@z.com' }, { ...valid, body_html: '<b>x</b>' }]) {
      await expect(svc.send(bad)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', outcome: 'not_performed' });
    }
    expect(port.sent).toHaveLength(0);
  });
  it('enforces allow-lists and confirm_send', async () => {
    const port = fakeGmail();
    const allow = new GmailService(port, { ...policy(), allowedDomains: ['example.com'] });
    await expect(allow.send({ ...valid, to: 'a@other.com' })).rejects.toThrow(/allow-list/);
    await expect(allow.send({ ...valid, bcc: 'a@other.com' })).rejects.toThrow(/allow-list/);
    await allow.send(valid);
    const confirm = new GmailService(port, { ...policy(), requireConfirmSend: true });
    await expect(confirm.send(valid)).rejects.toThrow(/confirm_send/);
    await confirm.send({ ...valid, confirm_send: true });
  });
  it('sends multipart when HTML is enabled', async () => {
    const port = fakeGmail();
    await new GmailService(port, { ...policy(), enableHtmlBody: true }).send({ ...valid, body_html: '<p>x</p>' });
    expect(decode(port.sent[0]!)).toContain('multipart/alternative');
  });
  it('does not retry and reports unknown outcome on timeout', async () => {
    let calls = 0;
    const svc = new GmailService({ send: async () => { calls++; throw Object.assign(new Error('t'), { code: 'ETIMEDOUT' }); } }, policy());
    await expect(svc.send(valid)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN', outcome: 'unknown' });
    expect(calls).toBe(1);
  });
});

describe('GoogleDocsService', () => {
  it('appends with newline handling and returns safe metadata', async () => {
    const port = fakeDocs();
    const svc = new GoogleDocsService(port);
    const res = await svc.append({ document: `https://docs.google.com/document/d/${DOC_ID}/edit`, text: 'Notes' });
    expect(port.appended).toEqual([{ id: DOC_ID, text: '\nNotes\n' }]);
    expect(res).toMatchObject({ document_id: DOC_ID, document_title: 'Test Doc', document_url: `https://docs.google.com/document/d/${DOC_ID}/edit` });
    await svc.append({ document: DOC_ID, text: 'x', prepend_newline: false, append_newline: false });
    expect(port.appended[1]?.text).toBe('x');
  });
  it('rejects bad input without touching Google', async () => {
    const port = fakeDocs();
    const svc = new GoogleDocsService(port);
    await expect(svc.append({ document: 'https://evil.com/x', text: 'a' })).rejects.toBeInstanceOf(AppError);
    await expect(svc.append({ document: DOC_ID, text: '  ' })).rejects.toBeInstanceOf(AppError);
    expect(port.appended).toHaveLength(0);
  });
  it('reports not_performed when the pre-flight read fails, unknown on write timeout', async () => {
    const notFound = new GoogleDocsService({ getTitle: async () => { throw Object.assign(new Error('x'), { status: 404 }); }, appendText: async () => { throw new Error('should not run'); } });
    await expect(notFound.append({ document: DOC_ID, text: 'a' })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', outcome: 'not_performed' });
    const timeout = new GoogleDocsService({ getTitle: async () => 't', appendText: async () => { throw Object.assign(new Error('x'), { code: 'ECONNRESET' }); } });
    await expect(timeout.append({ document: DOC_ID, text: 'a' })).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  });
});

describe('idempotency', () => {
  const mk = () => new FileIdempotencyStore(path.join(mkdtempSync(path.join(tmpdir(), 'idem-')), 'i.json'), 60_000);
  it('replays completed results and rejects changed input', async () => {
    const store = mk();
    let n = 0;
    const run = (fp: string) => withIdempotency(store, 'key-12345678', 'op', fp, async () => ({ n: ++n }));
    expect(await run('a')).toEqual({ result: { n: 1 }, replayed: false });
    expect(await run('a')).toEqual({ result: { n: 1 }, replayed: true });
    await expect(run('b')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  it('blocks re-runs after an unknown outcome but frees the key after a definite failure', async () => {
    const store = mk();
    const fail = (outcome: 'unknown' | 'not_performed') => () => Promise.reject(new AppError('GOOGLE_API_ERROR', 'x', { outcome }));
    await expect(withIdempotency(store, 'key-unknown1', 'op', 'a', fail('unknown'))).rejects.toMatchObject({ outcome: 'unknown' });
    await expect(withIdempotency(store, 'key-unknown1', 'op', 'a', async () => ({}))).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    await expect(withIdempotency(store, 'key-free1234', 'op', 'a', fail('not_performed'))).rejects.toBeInstanceOf(AppError);
    expect((await withIdempotency(store, 'key-free1234', 'op', 'a', async () => ({ ok: 1 }))).replayed).toBe(false);
  });
  it('rejects a key when idempotency is disabled', async () => {
    await expect(withIdempotency(undefined, 'key-12345678', 'op', 'a', async () => ({}))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
