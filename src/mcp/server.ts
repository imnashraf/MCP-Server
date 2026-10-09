import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDocsAppendText } from '../tools/docs-append-text.js';
import { registerGmailSendEmail } from '../tools/gmail-send-email.js';
import type { ToolDeps } from '../tools/runtime.js';
import { registerWorkspaceStatus } from '../tools/workspace-status.js';
import { SERVER_NAME, SERVER_VERSION } from './info.js';

/** Builds an MCP server with a deterministic tool order. Transport-agnostic. */
export function createMcpServer(deps: ToolDeps): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'Tools for Gmail sending and append-only Google Docs edits. gmail_send_email and google_docs_append_text perform real, ' +
        'externally visible writes: confirm recipients/targets and content with the user first, never retry after an "unknown" outcome.',
    },
  );
  registerGmailSendEmail(server, deps);
  registerDocsAppendText(server, deps);
  registerWorkspaceStatus(server, deps);
  return server;
}
