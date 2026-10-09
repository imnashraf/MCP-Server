import path from 'node:path';
import { z } from 'zod';
import { DEFAULT_CONFIG_DIR, expandHome, isPathInside, projectRoot } from './paths.js';

export type TransportKind = 'stdio' | 'http';
export type McpAuthMode = 'none' | 'bearer';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface AppConfig {
  nodeEnv: string;
  transport: TransportKind;
  logLevel: LogLevel;
  http: {
    host: string;
    port: number;
    path: string;
    allowedHosts: string[];
    allowedOrigins: string[];
    maxBodyBytes: number;
    rateLimitPerMinute: number;
    trustProxy: boolean;
    behindTlsProxy: boolean;
    tlsCertPath?: string;
    tlsKeyPath?: string;
  };
  mcpAuth: {
    mode: McpAuthMode;
    accessToken?: string;
  };
  google: {
    clientId?: string;
    clientSecret?: string;
    redirectUri: string;
    tokenStorePath: string;
    apiTimeoutMs: number;
    /** Optional bootstrap credential for hosts where the interactive consent flow cannot run. */
    seed: { refreshToken?: string; scope?: string; email?: string };
  };
  capabilities: {
    gmailSend: boolean;
    docsAppend: boolean;
  };
  gmail: {
    allowedRecipients: string[];
    allowedDomains: string[];
    enableHtmlBody: boolean;
    requireConfirmSend: boolean;
    maxRecipients: number;
  };
  idempotency: {
    enabled: boolean;
    storePath: string;
    ttlHours: number;
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
export const isLoopbackHost = (host: string): boolean => LOOPBACK_HOSTS.has(host.toLowerCase());

const bool = (def: boolean) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return def;
      if (['1', 'true', 'yes', 'on'].includes(v)) return true;
      if (['0', 'false', 'no', 'off'].includes(v)) return false;
      ctx.addIssue({ code: 'custom', message: `expected a boolean, got "${v}"` });
      return z.NEVER;
    });

const int = (def: number, min: number, max: number) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return def;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: 'custom', message: `expected an integer between ${min} and ${max}` });
        return z.NEVER;
      }
      return n;
    });

const list = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.string().optional().default('development'),
  MCP_TRANSPORT: z.enum(['stdio', 'http']).optional().default('stdio'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).optional().default('info'),

  MCP_HTTP_HOST: z.string().trim().optional().default('127.0.0.1'),
  MCP_HTTP_PORT: int(-1, 0, 65535),
  PORT: int(-1, 0, 65535), // injected by PaaS hosts such as Railway; MCP_HTTP_PORT wins
  MCP_HTTP_PATH: z
    .string()
    .trim()
    .optional()
    .default('/mcp')
    .refine((p) => /^\/[A-Za-z0-9/_-]*$/.test(p), 'must start with "/" and contain only URL-safe characters'),
  MCP_HTTP_ALLOWED_HOSTS: list,
  MCP_HTTP_ALLOWED_ORIGINS: list,
  MCP_HTTP_MAX_BODY_BYTES: int(1_048_576, 1024, 10_485_760),
  MCP_HTTP_RATE_LIMIT_PER_MINUTE: int(60, 1, 10_000),
  MCP_HTTP_TRUST_PROXY: bool(false),
  MCP_HTTP_BEHIND_TLS_PROXY: bool(false),
  MCP_HTTP_TLS_CERT_PATH: optionalString,
  MCP_HTTP_TLS_KEY_PATH: optionalString,

  MCP_AUTH_MODE: z.enum(['none', 'bearer']).optional(),
  MCP_ACCESS_TOKEN: optionalString,

  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_REDIRECT_URI: z.string().trim().optional().default('http://127.0.0.1:53682/oauth2callback'),
  GOOGLE_TOKEN_STORE_PATH: optionalString,
  GOOGLE_API_TIMEOUT_MS: int(30_000, 1_000, 120_000),
  GOOGLE_REFRESH_TOKEN: optionalString,
  GOOGLE_TOKEN_SCOPE: optionalString,
  GOOGLE_AUTHORIZED_EMAIL: optionalString,

  // Provided automatically by Railway; used only for safe defaults.
  RAILWAY_PUBLIC_DOMAIN: optionalString,
  RAILWAY_VOLUME_MOUNT_PATH: optionalString,

  ENABLE_GMAIL_SEND: bool(true),
  ENABLE_DOCS_APPEND: bool(true),

  GMAIL_ALLOWED_RECIPIENTS: list,
  GMAIL_ALLOWED_RECIPIENT_DOMAINS: list,
  GMAIL_ENABLE_HTML_BODY: bool(false),
  GMAIL_REQUIRE_CONFIRM_SEND: bool(false),
  GMAIL_MAX_RECIPIENTS: int(100, 1, 500),

  IDEMPOTENCY_ENABLED: bool(true),
  IDEMPOTENCY_STORE_PATH: optionalString,
  IDEMPOTENCY_TTL_HOURS: int(168, 1, 24 * 90),
});

/**
 * Parses and validates configuration from environment variables.
 * Fails closed: unsafe combinations (e.g. an unauthenticated HTTP endpoint) throw a ConfigError.
 * Error messages never include variable values, only names and reasons.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, opts: { root?: string } = {}): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid configuration: ${details}`);
  }
  const e = parsed.data;
  const root = opts.root ?? projectRoot();

  const transport = e.MCP_TRANSPORT;
  const authMode: McpAuthMode = e.MCP_AUTH_MODE ?? (transport === 'http' ? 'bearer' : 'none');

  // On Railway the container filesystem is ephemeral; default to the attached volume when there is one.
  const stateDir = e.RAILWAY_VOLUME_MOUNT_PATH ?? DEFAULT_CONFIG_DIR;
  const tokenStorePath = expandHome(e.GOOGLE_TOKEN_STORE_PATH ?? path.join(stateDir, 'tokens.json'));
  const idempotencyStorePath = expandHome(e.IDEMPOTENCY_STORE_PATH ?? path.join(stateDir, 'idempotency.json'));
  const port = e.MCP_HTTP_PORT >= 0 ? e.MCP_HTTP_PORT : e.PORT >= 0 ? e.PORT : 3000;
  const allowedHosts =
    e.MCP_HTTP_ALLOWED_HOSTS.length > 0 ? e.MCP_HTTP_ALLOWED_HOSTS : e.RAILWAY_PUBLIC_DOMAIN ? [e.RAILWAY_PUBLIC_DOMAIN.toLowerCase()] : [];

  if (isPathInside(tokenStorePath, root)) {
    throw new ConfigError(
      'GOOGLE_TOKEN_STORE_PATH must point outside the project directory so OAuth tokens can never be committed.',
    );
  }

  let redirect: URL;
  try {
    redirect = new URL(e.GOOGLE_REDIRECT_URI);
  } catch {
    throw new ConfigError('GOOGLE_REDIRECT_URI must be a valid absolute URL.');
  }
  if (redirect.protocol !== 'http:' && redirect.protocol !== 'https:') {
    throw new ConfigError('GOOGLE_REDIRECT_URI must use http (loopback) or https.');
  }

  // --- Remote/HTTP safety rules (fail closed) ---
  if (transport === 'http') {
    if (authMode !== 'bearer') {
      throw new ConfigError(
        'MCP_TRANSPORT=http requires MCP_AUTH_MODE=bearer. Anonymous HTTP access to write-capable tools is not permitted.',
      );
    }
    if (!e.MCP_ACCESS_TOKEN || e.MCP_ACCESS_TOKEN.length < 32) {
      throw new ConfigError(
        'MCP_ACCESS_TOKEN must be set to a random secret of at least 32 characters when MCP_AUTH_MODE=bearer ' +
          '(e.g. `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"`).',
      );
    }
    const hasTls = Boolean(e.MCP_HTTP_TLS_CERT_PATH && e.MCP_HTTP_TLS_KEY_PATH);
    if (Boolean(e.MCP_HTTP_TLS_CERT_PATH) !== Boolean(e.MCP_HTTP_TLS_KEY_PATH)) {
      throw new ConfigError('MCP_HTTP_TLS_CERT_PATH and MCP_HTTP_TLS_KEY_PATH must be set together.');
    }
    if (!isLoopbackHost(e.MCP_HTTP_HOST) && !hasTls && !e.MCP_HTTP_BEHIND_TLS_PROXY) {
      throw new ConfigError(
        'Refusing to serve plain HTTP on a non-loopback interface. Configure MCP_HTTP_TLS_CERT_PATH/MCP_HTTP_TLS_KEY_PATH, ' +
          'or set MCP_HTTP_BEHIND_TLS_PROXY=true when a TLS-terminating reverse proxy fronts this server.',
      );
    }
    if (!isLoopbackHost(e.MCP_HTTP_HOST) && allowedHosts.length === 0) {
      throw new ConfigError(
        'Binding a non-loopback interface requires MCP_HTTP_ALLOWED_HOSTS (your public hostname) for DNS-rebinding protection.',
      );
    }
  }
  if (authMode === 'bearer' && (!e.MCP_ACCESS_TOKEN || e.MCP_ACCESS_TOKEN.length < 32)) {
    throw new ConfigError('MCP_AUTH_MODE=bearer requires MCP_ACCESS_TOKEN with at least 32 characters.');
  }

  if (!e.ENABLE_GMAIL_SEND && !e.ENABLE_DOCS_APPEND) {
    // Allowed (status tool still works) but almost certainly a misconfiguration; surfaced via status.
  }

  return {
    nodeEnv: e.NODE_ENV,
    transport,
    logLevel: e.LOG_LEVEL,
    http: {
      host: e.MCP_HTTP_HOST,
      port,
      path: e.MCP_HTTP_PATH,
      allowedHosts,
      allowedOrigins: e.MCP_HTTP_ALLOWED_ORIGINS,
      maxBodyBytes: e.MCP_HTTP_MAX_BODY_BYTES,
      rateLimitPerMinute: e.MCP_HTTP_RATE_LIMIT_PER_MINUTE,
      trustProxy: e.MCP_HTTP_TRUST_PROXY,
      behindTlsProxy: e.MCP_HTTP_BEHIND_TLS_PROXY,
      tlsCertPath: e.MCP_HTTP_TLS_CERT_PATH ? expandHome(e.MCP_HTTP_TLS_CERT_PATH) : undefined,
      tlsKeyPath: e.MCP_HTTP_TLS_KEY_PATH ? expandHome(e.MCP_HTTP_TLS_KEY_PATH) : undefined,
    },
    mcpAuth: { mode: authMode, accessToken: e.MCP_ACCESS_TOKEN },
    google: {
      clientId: e.GOOGLE_CLIENT_ID,
      clientSecret: e.GOOGLE_CLIENT_SECRET,
      redirectUri: e.GOOGLE_REDIRECT_URI,
      tokenStorePath,
      apiTimeoutMs: e.GOOGLE_API_TIMEOUT_MS,
      seed: { refreshToken: e.GOOGLE_REFRESH_TOKEN, scope: e.GOOGLE_TOKEN_SCOPE, email: e.GOOGLE_AUTHORIZED_EMAIL },
    },
    capabilities: { gmailSend: e.ENABLE_GMAIL_SEND, docsAppend: e.ENABLE_DOCS_APPEND },
    gmail: {
      allowedRecipients: e.GMAIL_ALLOWED_RECIPIENTS,
      allowedDomains: e.GMAIL_ALLOWED_RECIPIENT_DOMAINS,
      enableHtmlBody: e.GMAIL_ENABLE_HTML_BODY,
      requireConfirmSend: e.GMAIL_REQUIRE_CONFIRM_SEND,
      maxRecipients: e.GMAIL_MAX_RECIPIENTS,
    },
    idempotency: {
      enabled: e.IDEMPOTENCY_ENABLED,
      storePath: idempotencyStorePath,
      ttlHours: e.IDEMPOTENCY_TTL_HOURS,
    },
  };
}
