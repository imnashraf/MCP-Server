import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileTokenStore, MemoryTokenStore, seedTokenStore } from '../../src/auth/token-store.js';

describe('seedTokenStore', () => {
  it('does nothing without a seed token', () => {
    const store = new MemoryTokenStore();
    expect(seedTokenStore(store, {})).toBe(false);
    expect(store.load()).toBeNull();
  });
  it('writes an empty store', () => {
    const store = new MemoryTokenStore();
    expect(seedTokenStore(store, { refreshToken: 'r1', email: 'a@b.co' })).toBe(true);
    expect(store.load()).toMatchObject({ refresh_token: 'r1', email: 'a@b.co' });
  });
  it('never overwrites an existing refresh token', () => {
    const store = new MemoryTokenStore({ refresh_token: 'persisted', access_token: 'a' });
    expect(seedTokenStore(store, { refreshToken: 'from-env' })).toBe(false);
    expect(store.load()?.refresh_token).toBe('persisted');
  });
  it('creates the file with owner-only permissions on disk', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-'));
    const file = path.join(dir, 'nested', 'tokens.json');
    seedTokenStore(new FileTokenStore(file), { refreshToken: 'r1' });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).refresh_token).toBe('r1');
  });
});
