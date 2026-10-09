import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/env.js';
import { TOKEN, testConfig } from '../helpers.js';

describe('config safety', () => {
  it('defaults to stdio with no auth', () => {
    const c = testConfig();
    expect([c.transport, c.mcpAuth.mode]).toEqual(['stdio', 'none']);
  });
  it('refuses HTTP without bearer auth or a strong token', () => {
    expect(() => testConfig({ MCP_TRANSPORT: 'http', MCP_AUTH_MODE: 'none' })).toThrow(ConfigError);
    expect(() => testConfig({ MCP_TRANSPORT: 'http' })).toThrow(/MCP_ACCESS_TOKEN/);
    expect(() => testConfig({ MCP_TRANSPORT: 'http', MCP_ACCESS_TOKEN: 'short' })).toThrow(/32/);
  });
  it('refuses plain HTTP on a public interface unless TLS or a TLS proxy is declared', () => {
    const base = { MCP_TRANSPORT: 'http', MCP_ACCESS_TOKEN: TOKEN, MCP_HTTP_HOST: '0.0.0.0' };
    expect(() => testConfig(base)).toThrow(/plain HTTP/);
    expect(testConfig({ ...base, MCP_HTTP_BEHIND_TLS_PROXY: 'true', MCP_HTTP_ALLOWED_HOSTS: 'mcp.example.com' }).http.host).toBe('0.0.0.0');
  });
  it('rejects token store inside the project and never echoes values', () => {
    expect(() => loadConfig({ GOOGLE_TOKEN_STORE_PATH: '/proj/tokens.json' }, { root: '/proj' })).toThrow(/outside the project/);
    try {
      testConfig({ MCP_TRANSPORT: 'http', MCP_ACCESS_TOKEN: 'sekret' });
    } catch (e) {
      expect((e as Error).message).not.toContain('sekret');
    }
  });

  it('requires allowed hosts on a public bind, but accepts Railway\'s public domain as the default', () => {
    const base = { MCP_TRANSPORT: 'http', MCP_ACCESS_TOKEN: TOKEN, MCP_HTTP_HOST: '0.0.0.0', MCP_HTTP_BEHIND_TLS_PROXY: 'true' };
    expect(() => testConfig(base)).toThrow(/MCP_HTTP_ALLOWED_HOSTS/);
    expect(testConfig({ ...base, RAILWAY_PUBLIC_DOMAIN: 'App.up.railway.app' }).http.allowedHosts).toEqual(['app.up.railway.app']);
    expect(testConfig({ ...base, RAILWAY_PUBLIC_DOMAIN: 'a.up.railway.app', MCP_HTTP_ALLOWED_HOSTS: 'x.com' }).http.allowedHosts).toEqual(['x.com']);
  });
  it('port precedence: MCP_HTTP_PORT, then PORT, then 3000', () => {
    expect(testConfig().http.port).toBe(3000);
    expect(testConfig({ PORT: '8080' }).http.port).toBe(8080);
    expect(testConfig({ PORT: '8080', MCP_HTTP_PORT: '9000' }).http.port).toBe(9000);
    expect(testConfig({ PORT: '8080', MCP_HTTP_PORT: '0' }).http.port).toBe(0);
    expect(() => testConfig({ PORT: 'abc' })).toThrow(ConfigError);
  });
  it('defaults state files to the Railway volume when mounted', () => {
    const c = testConfig({ RAILWAY_VOLUME_MOUNT_PATH: '/data', GOOGLE_TOKEN_STORE_PATH: '' });
    expect([c.google.tokenStorePath, c.idempotency.storePath]).toEqual(['/data/tokens.json', '/data/idempotency.json']);
    expect(testConfig({ RAILWAY_VOLUME_MOUNT_PATH: '/data', GOOGLE_TOKEN_STORE_PATH: '/elsewhere/t.json' }).google.tokenStorePath).toBe('/elsewhere/t.json');
  });
  it('reads the optional refresh-token seed', () => {
    expect(testConfig().google.seed.refreshToken).toBeUndefined();
    expect(testConfig({ GOOGLE_REFRESH_TOKEN: 'r', GOOGLE_AUTHORIZED_EMAIL: 'a@b.co' }).google.seed).toMatchObject({ refreshToken: 'r', email: 'a@b.co' });
  });
});
