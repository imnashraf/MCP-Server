import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export interface StoredTokens {
  refresh_token?: string;
  access_token?: string;
  expiry_date?: number;
  scope?: string;
  /** Authorized account email, captured at consent time (from the OpenID `email` scope). */
  email?: string;
}

export interface TokenStore {
  load(): StoredTokens | null;
  save(tokens: StoredTokens): void;
  clear(): void;
}

/** Writes JSON atomically with owner-only permissions (dir 0700, file 0600). */
export function writePrivateJson(file: string, data: unknown): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best effort on filesystems without POSIX permissions */
  }
}

export class FileTokenStore implements TokenStore {
  constructor(private readonly file: string) {}

  load(): StoredTokens | null {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return parsed && typeof parsed === 'object' ? (parsed as StoredTokens) : null;
    } catch {
      return null;
    }
  }

  save(tokens: StoredTokens): void {
    writePrivateJson(this.file, tokens);
  }

  clear(): void {
    fs.rmSync(this.file, { force: true });
  }
}

export class MemoryTokenStore implements TokenStore {
  constructor(private tokens: StoredTokens | null = null) {}
  load(): StoredTokens | null {
    return this.tokens;
  }
  save(tokens: StoredTokens): void {
    this.tokens = tokens;
  }
  clear(): void {
    this.tokens = null;
  }
}
