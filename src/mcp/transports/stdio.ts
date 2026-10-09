import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Logger } from '../../logging/logger.js';
import { createMcpServer } from '../server.js';
import type { ToolDeps } from '../../tools/runtime.js';

/** Local profile. stdout carries only protocol traffic; all logging goes to stderr. */
export async function startStdio(deps: ToolDeps, logger: Logger): Promise<void> {
  const server = createMcpServer(deps);
  await server.connect(new StdioServerTransport());
  logger.info('MCP server listening on stdio');
}
