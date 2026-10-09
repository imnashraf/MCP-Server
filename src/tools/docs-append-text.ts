import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { parseDocumentRef, validateAppendText } from '../validation/document.js';
import { fingerprintOf, validateIdempotencyKey, withIdempotency } from '../services/idempotency.js';
import { runTool, type ToolDeps } from './runtime.js';

export const docsAppendInput = {
  document: z.string().describe('Google Docs URL (https://docs.google.com/document/d/<id>/...) or the raw document ID.'),
  text: z.string().describe('Plain text to append to the end of the document body (non-empty, max 100000 characters).'),
  prepend_newline: z.boolean().optional().describe('Insert a line break before the text. Default true.'),
  append_newline: z.boolean().optional().describe('Add a trailing line break after the text. Default true.'),
  idempotency_key: z
    .string()
    .optional()
    .describe('Optional unique key (8-128 chars). Reusing it with identical input returns the recorded result instead of appending again.'),
};

export function registerDocsAppendText(server: McpServer, deps: ToolDeps): void {
  const docs = deps.docs;
  if (!docs) return;
  server.registerTool(
    'google_docs_append_text',
    {
      title: 'Append text to a Google Doc',
      description:
        'MODIFIES an existing Google Doc by APPENDING plain text to the end of its main body (default tab). Existing content is never replaced or deleted, ' +
        'and sharing settings are never changed. The user must have identified the target document. ' +
        'If the result outcome is "unknown", do NOT retry: the text may already be in the document.',
      inputSchema: docsAppendInput,
      annotations: { title: 'Append text to a Google Doc', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (args) =>
      runTool('google_docs_append_text', deps, true, async () => {
        const key = validateIdempotencyKey(args.idempotency_key);
        const fingerprint = fingerprintOf({
          id: parseDocumentRef(args.document),
          text: validateAppendText(args.text),
          p: args.prepend_newline ?? true,
          a: args.append_newline ?? true,
        });
        const { result, replayed } = await withIdempotency(deps.idempotency, key, 'google_docs_append_text', fingerprint, () => docs.append(args));
        return {
          message: replayed ? 'Duplicate idempotency_key: returning the earlier result; nothing new was appended.' : 'Text was appended to the Google Doc.',
          fields: {
            document_id: result.document_id,
            document_url: result.document_url,
            ...(result.document_title ? { document_title: result.document_title } : {}),
            appended_characters: result.appended_characters,
            replayed,
          },
        };
      }),
  );
}
