import { randomBytes } from 'node:crypto';

export interface MimeInput {
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo?: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
}

const b64Lines = (s: string): string =>
  Buffer.from(s, 'utf8')
    .toString('base64')
    .replace(/(.{76})/g, '$1\r\n');

/** RFC 2047 encoded-word for non-ASCII subjects. */
function encodeHeader(value: string): string {
   
  if (/^[ -~]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Builds an RFC 5322 message. No `From` header: Gmail uses the authorized account. */
export function buildMime(input: MimeInput): string {
  const headers = [`To: ${input.to.join(', ')}`];
  if (input.cc.length) headers.push(`Cc: ${input.cc.join(', ')}`);
  if (input.bcc.length) headers.push(`Bcc: ${input.bcc.join(', ')}`);
  if (input.replyTo) headers.push(`Reply-To: ${input.replyTo}`);
  headers.push(`Subject: ${encodeHeader(input.subject)}`, 'MIME-Version: 1.0');

  if (!input.bodyHtml) {
    headers.push('Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64');
    return `${headers.join('\r\n')}\r\n\r\n${b64Lines(input.bodyText)}`;
  }
  const boundary = `mcp_${randomBytes(12).toString('hex')}`;
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  const part = (type: string, body: string) =>
    `--${boundary}\r\nContent-Type: ${type}; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64Lines(body)}\r\n`;
  return `${headers.join('\r\n')}\r\n\r\n${part('text/plain', input.bodyText)}${part('text/html', input.bodyHtml)}--${boundary}--`;
}

export const toBase64Url = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');
