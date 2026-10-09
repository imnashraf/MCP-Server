import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { fingerprintOf, validateIdempotencyKey, withIdempotency } from '../services/idempotency.js';
import { runTool, type ToolDeps } from './runtime.js';

const addresses = z.union([z.string(), z.array(z.string()).max(500)]);

export const gmailSendEmailInput = {
  to: addresses.describe('Recipient email address, or an array of addresses.'),
  subject: z.string().describe('Email subject (non-empty, max 998 characters, no line breaks).'),
  body_text: z.string().describe('Plain-text email body (non-empty).'),
  cc: addresses.optional().describe('Optional Cc recipient(s).'),
  bcc: addresses.optional().describe('Optional Bcc recipient(s).'),
  body_html: z.string().optional().describe('Optional HTML alternative body. Only accepted if the server operator enabled it.'),
  reply_to: z.string().optional().describe('Optional Reply-To address. The sender is always the authorized Google account.'),
  confirm_send: z
    .boolean()
    .optional()
    .describe('Set true only after the user approved this exact email. Some servers require it. It is a guard, not proof of approval.'),
  idempotency_key: z
    .string()
    .optional()
    .describe('Optional unique key (8-128 chars). Reusing it with identical input returns the recorded result instead of sending again.'),
};

export function registerGmailSendEmail(server: McpServer, deps: ToolDeps): void {
  const gmail = deps.gmail;
  if (!gmail) return;
  server.registerTool(
    'gmail_send_email',
    {
      title: 'Send email via Gmail',
      description:
        'SENDS A REAL EMAIL from the authorized Gmail account to the given recipients. This is an irreversible write with external side effects. ' +
        'Only call it when the user has supplied or approved the recipients, subject and body; never guess recipients. ' +
        'If the result outcome is "unknown", do NOT retry: the email may already have been sent.',
      inputSchema: gmailSendEmailInput,
      annotations: { title: 'Send email via Gmail', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (args) =>
      runTool('gmail_send_email', deps, true, async () => {
        const key = validateIdempotencyKey(args.idempotency_key);
        const v = gmail.validate(args);
        const fingerprint = fingerprintOf(v);
        const { result, replayed } = await withIdempotency(deps.idempotency, key, 'gmail_send_email', fingerprint, () => gmail.send(args));
        if (!result.message_id && !replayed) throw new AppError('OUTCOME_UNKNOWN', 'No message id returned.', { outcome: 'unknown' });
        return {
          message: replayed ? 'Duplicate idempotency_key: returning the earlier result; no new email was sent.' : 'Gmail accepted the message for sending.',
          fields: { message_id: result.message_id, thread_id: result.thread_id, recipient_count: result.recipient_count, replayed },
        };
      }),
  );
}
