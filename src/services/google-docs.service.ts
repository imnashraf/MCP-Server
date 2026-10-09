import { docs as createDocs } from '@googleapis/docs';
import type { OAuth2Client } from 'google-auth-library';
import { normalizeError } from '../errors/normalize-error.js';
import { documentUrl, parseDocumentRef, validateAppendText } from '../validation/document.js';

/** Port over the Google Docs API so business logic is testable without Google. */
export interface DocsPort {
  getTitle(documentId: string): Promise<string | undefined>;
  appendText(documentId: string, text: string): Promise<void>;
}

export function createDocsPort(auth: () => OAuth2Client, timeoutMs: number): DocsPort {
  return {
    async getTitle(documentId) {
      const api = createDocs({ version: 'v1', auth: auth() });
      const res = await api.documents.get({ documentId, fields: 'title' }, { timeout: timeoutMs, retry: true, retryConfig: { retry: 2 } });
      return res.data.title ?? undefined;
    },
    async appendText(documentId, text) {
      const api = createDocs({ version: 'v1', auth: auth() });
      // endOfSegmentLocation with no segmentId targets the document body's end (default tab), so no
      // stale index is computed. retry:false — an append is not idempotent.
      await api.documents.batchUpdate(
        { documentId, requestBody: { requests: [{ insertText: { text, endOfSegmentLocation: { segmentId: '' } } }] } },
        { timeout: timeoutMs, retry: false },
      );
    },
  };
}

export interface AppendInput {
  document: unknown;
  text: unknown;
  prepend_newline?: unknown;
  append_newline?: unknown;
}

export interface AppendResult extends Record<string, unknown> {
  document_id: string;
  document_url: string;
  document_title?: string;
  appended_characters: number;
}

export class GoogleDocsService {
  constructor(private readonly port: DocsPort) {}

  async append(input: AppendInput): Promise<AppendResult> {
    const documentId = parseDocumentRef(input.document);
    const text = validateAppendText(input.text);
    const prepend = input.prepend_newline === undefined ? true : input.prepend_newline === true;
    const trailing = input.append_newline === undefined ? true : input.append_newline === true;
    const payload = `${prepend ? '\n' : ''}${text}${trailing ? '\n' : ''}`;

    // Pre-flight read: confirms the document exists and is accessible before any write, so
    // not-found / permission failures are reported as definitely "not_performed".
    let title: string | undefined;
    try {
      title = await this.port.getTitle(documentId);
    } catch (err) {
      throw normalizeError(err, { write: false, resource: 'document' });
    }
    try {
      await this.port.appendText(documentId, payload);
    } catch (err) {
      throw normalizeError(err, { write: true, resource: 'document' });
    }
    return { document_id: documentId, document_url: documentUrl(documentId), document_title: title, appended_characters: payload.length };
  }
}
