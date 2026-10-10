import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { bearerAuth } from '../../auth/mcp-auth.js';
import { isLoopbackHost } from '../../config/env.js';
import type { Logger } from '../../logging/logger.js';
import type { ToolDeps } from '../../tools/runtime.js';
import { createMcpServer } from '../server.js';

const jsonRpcError = (res: Response, status: number, code: number, message: string) =>
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });

/**
 * Remote profile (stateless Streamable HTTP): a fresh server+transport per request, so every
 * instance serves identical tools and no session state is held in process memory.
 * Order of defenses: host check -> origin check -> rate limit -> bearer auth -> body limit -> MCP.
 */
export function createHttpApp(deps: ToolDeps, logger: Logger): Express {
  const { config } = deps;
  const { http: h } = config;
  if (config.mcpAuth.mode !== 'bearer' || !config.mcpAuth.accessToken) {
    throw new Error('HTTP transport requires bearer authentication (fail closed).');
  }
  const app = express();
  app.disable('x-powered-by');
  if (h.trustProxy) app.set('trust proxy', 1);

  const allowedHosts = new Set(h.allowedHosts);
  const allowedOrigins = new Set(h.allowedOrigins);
  const localOnly = isLoopbackHost(h.host);

  // DNS-rebinding protection.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const host = (req.header('host') ?? '').toLowerCase();
    const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0] ?? '';
    const ok = allowedHosts.size > 0 ? allowedHosts.has(host) || allowedHosts.has(hostname) : !localOnly || isLoopbackHost(hostname);
    if (!ok) return void jsonRpcError(res, 403, -32000, 'Host not allowed');
    const origin = req.header('origin');
    if (origin && !allowedOrigins.has(origin.toLowerCase())) return void jsonRpcError(res, 403, -32000, 'Origin not allowed');
    next();
  });

  // Unauthenticated liveness probe; reveals nothing beyond "up".
  app.get('/healthz', (_req, res) => void res.json({ status: 'ok' }));

  app.use(
    h.path,
    rateLimit({ windowMs: 60_000, limit: h.rateLimitPerMinute, standardHeaders: 'draft-7', legacyHeaders: false }),
    bearerAuth(config.mcpAuth.accessToken, { maxFailuresPerMinute: h.rateLimitPerMinute }),
    express.json({ limit: h.maxBodyBytes }),
  );

  app.post(h.path, async (req: Request, res: Response) => {
    const server = createMcpServer(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error('http request failed', { cause: err });
      if (!res.headersSent) jsonRpcError(res, 500, -32603, 'Internal server error');
    }
  });
  // Stateless mode has no server-initiated streams or sessions to manage.
  const notAllowed = (_req: Request, res: Response) => {
    res.setHeader('Allow', 'POST');
    jsonRpcError(res, 405, -32000, 'Method not allowed');
  };
  app.get(h.path, notAllowed);
  app.delete(h.path, notAllowed);

  // Body-parser errors (too large / malformed JSON) -> sanitized JSON-RPC errors.
  app.use((err: { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === 'entity.too.large') return void jsonRpcError(res, 413, -32000, 'Request too large');
    if (err.type === 'entity.parse.failed') return void jsonRpcError(res, 400, -32700, 'Parse error');
    logger.error('http error', { cause: err });
    jsonRpcError(res, 500, -32603, 'Internal server error');
  });
  return app;
}

export async function startHttp(deps: ToolDeps, logger: Logger): Promise<http.Server> {
  const { http: h } = deps.config;
  const app = createHttpApp(deps, logger);
  const server: http.Server =
    h.tlsCertPath && h.tlsKeyPath
      ? https.createServer({ cert: fs.readFileSync(h.tlsCertPath), key: fs.readFileSync(h.tlsKeyPath) }, app)
      : http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(h.port, h.host, resolve);
  });
  const addr = server.address() as AddressInfo;
  logger.info('MCP server listening on Streamable HTTP', { host: h.host, port: addr.port, path: h.path, tls: Boolean(h.tlsCertPath) });
  return server;
}
