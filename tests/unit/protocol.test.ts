import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, describe, expect, it } from 'vitest';
import { createMcpServer } from '../../src/mcp/server.js';
import { startHttp } from '../../src/mcp/transports/http.js';
import { DOC_ID, TOKEN, fakeDocs, fakeGmail, makeDeps } from '../helpers.js';

const TOOLS = ['gmail_send_email', 'google_docs_append_text', 'google_workspace_status'];

async function connect(deps = makeDeps()) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(deps).connect(a);
  const client = new Client({ name: 't', version: '1' });
  await client.connect(b);
  return client;
}
const payload = (r: unknown) => (r as { structuredContent: Record<string, any> }).structuredContent; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('MCP protocol (in-memory)', () => {
  it('lists tools deterministically with side-effect descriptions', async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name)).toEqual(TOOLS);
    expect(tools[0]?.description).toMatch(/SENDS A REAL EMAIL/);
    expect(tools[1]?.description).toMatch(/APPENDING/);
    expect(tools[0]?.inputSchema.required).toEqual(expect.arrayContaining(['to', 'subject', 'body_text']));
    expect(tools[2]?.annotations?.readOnlyHint).toBe(true);
  });
  it('omits disabled capabilities', async () => {
    const { tools } = await (await connect(makeDeps({ env: { ENABLE_GMAIL_SEND: 'false' } }) && { ...makeDeps(), gmail: undefined })).listTools();
    expect(tools.map((t) => t.name)).toEqual(['google_docs_append_text', 'google_workspace_status']);
  });
  it('sends and appends via the shared service layer', async () => {
    const gmail = fakeGmail();
    const docs = fakeDocs();
    const client = await connect(makeDeps({ gmail, docs }));
    const sent = await client.callTool({ name: 'gmail_send_email', arguments: { to: 'a@example.com', subject: 's', body_text: 'b' } });
    expect(payload(sent)).toMatchObject({ success: true, operation: 'gmail_send_email', message_id: 'msg-1', thread_id: 'thr-1' });
    expect(payload(sent).request_id).toBeTruthy();
    const app = await client.callTool({ name: 'google_docs_append_text', arguments: { document: DOC_ID, text: 'hi' } });
    expect(payload(app)).toMatchObject({ success: true, document_id: DOC_ID });
    expect(docs.appended).toHaveLength(1);
  });
  it('returns a normalized error and never calls Google on invalid input', async () => {
    const gmail = fakeGmail();
    const client = await connect(makeDeps({ gmail }));
    const res = await client.callTool({ name: 'gmail_send_email', arguments: { to: 'not-an-email', subject: 's', body_text: 'b' } });
    expect(res.isError).toBe(true);
    expect(payload(res)).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR', outcome: 'not_performed' } });
    expect(payload(res).request_id).toBeTruthy();
    expect(gmail.sent).toHaveLength(0);
  });
  it('status reports unauthorized state without secrets', async () => {
    const res = await (await connect()).callTool({ name: 'google_workspace_status', arguments: {} });
    expect(payload(res).google_authorization.state).toBe('not_authorized');
    expect(JSON.stringify(res)).not.toMatch(/secret|ya29/i);
  });
});

describe('MCP protocol (Streamable HTTP)', () => {
  const gmail = fakeGmail();
  let server: http.Server;
  let url: URL;
  const ready = (async () => {
    const deps = makeDeps({ gmail, env: { MCP_TRANSPORT: 'http', MCP_ACCESS_TOKEN: TOKEN, MCP_HTTP_PORT: '0' } });
    server = await startHttp(deps, deps.logger);
    url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
  })();
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('rejects missing/wrong bearer tokens', async () => {
    await ready;
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    expect((await fetch(url, { method: 'POST', headers, body })).status).toBe(401);
    expect((await fetch(url, { method: 'POST', headers: { ...headers, authorization: 'Bearer wrong' }, body })).status).toBe(401);
    expect((await fetch(url, { method: 'POST', headers: { ...headers, authorization: `Bearer ${TOKEN}`, origin: 'https://evil.example' }, body })).status).toBe(403);
    expect((await fetch(new URL('/healthz', url))).status).toBe(200);
  });
  it('exposes the same tools and executes the same logic as stdio', async () => {
    await ready;
    const client = new Client({ name: 't', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }));
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(TOOLS);
    const res = await client.callTool({ name: 'gmail_send_email', arguments: { to: 'a@example.com', subject: 's', body_text: 'b' } });
    expect(payload(res).success).toBe(true);
    expect(gmail.sent).toHaveLength(1);
    await client.close();
  });
});
