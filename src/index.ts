#!/usr/bin/env node
import { buildDeps } from './bootstrap.js';
import { ConfigError, loadConfig } from './config/env.js';
import { loadDotEnv } from './config/paths.js';
import { createLogger } from './logging/logger.js';
import { startHttp } from './mcp/transports/http.js';
import { startStdio } from './mcp/transports/stdio.js';

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel, base: { service: 'google-workspace-mcp' } });
  const deps = buildDeps(config, logger);

  if (config.transport === 'http') {
    const server = await startHttp(deps, logger);
    const stop = () => server.close(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } else {
    await startStdio(deps, logger);
  }
}

main().catch((err: unknown) => {
  // Config errors are sanitized by design (names and reasons only, never values).
  const msg = err instanceof ConfigError ? err.message : 'Fatal error while starting the server.';
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});
