import { gmail as createGmail } from '@googleapis/gmail';
import type { OAuth2Client } from 'google-auth-library';
import type { AppConfig } from '../config/env.js';
import { AppError, validationError } from '../errors/app-error.js';
import { normalizeError } from '../errors/normalize-error.js';
import { LIMITS, hasControlChars, normalizeAddress, toAddressList, validateBody, validateSubject } from '../validation/email.js';
import { buildMime, toBase64Url } from './mime.js';

/** Port over the Gmail API so business logic is testable without Google. */
export interface GmailPort {
  send(rawBase64Url: string): Promise<{ id?: string | null; threadId?: string | null }>;
}

export function createGmailPort(auth: () => OAuth2Client, timeoutMs: number): GmailPort {
  return {
    async send(raw) {
      const api = createGmail({ version: 'v1', auth: auth() });
      // retry:false — a send is not idempotent, so the HTTP layer must never repeat it.
      const res = await api.users.messages.send({ userId: 'me', requestBody: { raw } }, { timeout: timeoutMs, retry: false });
      return res.data;
    },
  };
}

export interface SendEmailInput {
  to: unknown;
  subject: unknown;
  body_text: unknown;
  cc?: unknown;
  bcc?: unknown;
  body_html?: unknown;
  reply_to?: unknown;
  confirm_send?: unknown;
}

export interface SendEmailResult extends Record<string, unknown> {
  message_id?: string;
  thread_id?: string;
  recipient_count: number;
}

export type GmailPolicy = Pick<AppConfig['gmail'], 'allowedRecipients' | 'allowedDomains' | 'enableHtmlBody' | 'requireConfirmSend' | 'maxRecipients'>;

/** Validates everything, applies operator policy, then sends. Nothing reaches Google if validation fails. */
export class GmailService {
  constructor(
    private readonly port: GmailPort,
    private readonly policy: GmailPolicy,
  ) {}

  validate(input: SendEmailInput) {
    const to = toAddressList(input.to, 'to', true);
    const cc = toAddressList(input.cc, 'cc', false);
    const bcc = toAddressList(input.bcc, 'bcc', false);
    const all = [...to, ...cc, ...bcc];
    if (new Set(all).size > this.policy.maxRecipients) {
      throw validationError(`Too many recipients (limit ${this.policy.maxRecipients}).`);
    }
    const subject = validateSubject(input.subject);
    const bodyText = validateBody(input.body_text, 'body_text', LIMITS.bodyText, true) as string;
    const bodyHtml = validateBody(input.body_html, 'body_html', LIMITS.bodyHtml, false);
    if (bodyHtml !== undefined && !this.policy.enableHtmlBody) {
      throw validationError('body_html is disabled on this server (set GMAIL_ENABLE_HTML_BODY=true to allow it).');
    }
    let replyTo: string | undefined;
    if (input.reply_to !== undefined && input.reply_to !== null) {
      if (typeof input.reply_to === 'string' && hasControlChars(input.reply_to)) throw validationError('reply_to contains control characters.');
      replyTo = normalizeAddress(input.reply_to, 'reply_to');
    }
    if (this.policy.requireConfirmSend && input.confirm_send !== true) {
      throw validationError('This server requires confirm_send=true. Only set it after the user has approved the exact email.');
    }
    this.enforceRecipientPolicy(all);
    return { to, cc, bcc, subject, bodyText, bodyHtml, replyTo };
  }

  private enforceRecipientPolicy(addresses: string[]): void {
    const { allowedRecipients, allowedDomains } = this.policy;
    if (allowedRecipients.length === 0 && allowedDomains.length === 0) return;
    for (const a of addresses) {
      const domain = a.slice(a.lastIndexOf('@') + 1);
      if (!allowedRecipients.includes(a) && !allowedDomains.includes(domain)) {
        throw validationError('A recipient is not permitted by this server\'s recipient allow-list.');
      }
    }
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const v = this.validate(input);
    const raw = toBase64Url(buildMime({ to: v.to, cc: v.cc, bcc: v.bcc, replyTo: v.replyTo, subject: v.subject, bodyText: v.bodyText, bodyHtml: v.bodyHtml }));
    try {
      const res = await this.port.send(raw);
      if (!res.id) {
        throw new AppError('OUTCOME_UNKNOWN', 'Gmail responded without a message id; delivery could not be confirmed.', { outcome: 'unknown' });
      }
      return {
        message_id: res.id,
        thread_id: res.threadId ?? undefined,
        recipient_count: new Set([...v.to, ...v.cc, ...v.bcc]).size,
      };
    } catch (err) {
      throw normalizeError(err, { write: true, resource: 'message' });
    }
  }
}
