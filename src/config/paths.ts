import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/** Absolute path to the project root (one level above `src/` or `dist/`). */
export function projectRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url)); // <root>/{src|dist}/config
  return path.resolve(here, '..', '..');
}

/** Expands a leading `~` to the current user's home directory and resolves to an absolute path. */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

/** True when `child` is the same as, or nested inside, `parent`. */
export function isPathInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.config', 'universal-google-workspace-mcp');

/**
 * Loads a dotenv file into `process.env` without overriding variables that are already set.
 *
 * Resolution: `MCP_ENV_FILE` (set to `none` to disable) or `<projectRoot>/.env`.
 * MCP clients often launch the server with an arbitrary working directory, so the
 * project-root fallback is resolved from this module's location rather than `cwd`.
 * Returns the path that was loaded, or null.
 */
export function loadDotEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.MCP_ENV_FILE?.trim();
  if (configured && configured.toLowerCase() === 'none') return null;
  const file = configured ? expandHome(configured) : path.join(projectRoot(), '.env');
  if (!fs.existsSync(file)) return null;
  const parsed = parseEnv(fs.readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined && typeof value === 'string') env[key] = value;
  }
  return file;
}
