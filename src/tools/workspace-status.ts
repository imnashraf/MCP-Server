import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SERVER_NAME, SERVER_VERSION } from '../mcp/info.js';
import { requiredScopes } from '../auth/google-oauth.js';
import { runTool, type ToolDeps } from './runtime.js';

export function registerWorkspaceStatus(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'google_workspace_status',
    {
      title: 'Google Workspace status',
      description:
        'Read-only diagnostic. Reports enabled capabilities and whether the server\'s Google authorization works. ' +
        'Never returns tokens, secrets or message/document contents.',
      inputSchema: {},
      annotations: { title: 'Google Workspace status', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    () =>
      runTool('google_workspace_status', deps, false, async () => {
        const { config } = deps;
        const auth = await deps.auth.check();
        return {
          message: auth.state === 'ok' ? 'Server is running and Google authorization is valid.' : `Server is running; Google authorization state: ${auth.state}.`,
          fields: {
            server: { name: SERVER_NAME, version: SERVER_VERSION, transport: config.transport },
            capabilities: {
              gmail_send: config.capabilities.gmailSend,
              google_docs_append: config.capabilities.docsAppend,
              gmail_html_body: config.gmail.enableHtmlBody,
              gmail_recipient_allowlist: config.gmail.allowedRecipients.length + config.gmail.allowedDomains.length > 0,
              gmail_requires_confirm_send: config.gmail.requireConfirmSend,
              idempotency: config.idempotency.enabled,
            },
            required_scopes: requiredScopes(config.capabilities),
            google_authorization: {
              state: auth.state,
              ...(auth.email ? { account: auth.email } : {}),
              ...(auth.missingScopes ? { missing_scopes: auth.missingScopes } : {}),
              ...(auth.reason ? { reason: auth.reason } : {}),
            },
          },
        };
      }),
  );
}
