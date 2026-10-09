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
    expect(testConfig({ ...base, MCP_HTTP_BEHIND_TLS_PROXY: 'true' }).http.host).toBe('0.0.0.0');
  });
  it('rejects token store inside the project and never echoes values', () => {
    expect(() => loadConfig({ GOOGLE_TOKEN_STORE_PATH: '/proj/tokens.json' }, { root: '/proj' })).toThrow(/outside the project/);
    try {
      testConfig({ MCP_TRANSPORT: 'http', MCP_ACCESS_TOKEN: 'sekret' });
    } catch (e) {
      expect((e as Error).message).not.toContain('sekret');
    }
  });
});
