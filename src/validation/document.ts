import { validationError } from '../errors/app-error.js';

const ID_RE = /^[A-Za-z0-9_-]{20,128}$/;
const URL_RE = /^\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,128})(?:\/|$)/;
export const MAX_APPEND_CHARS = 100_000;

/** Accepts a docs.google.com document URL or a raw document ID and returns the validated ID. */
export function parseDocumentRef(input: unknown): string {
  if (typeof input !== 'string' || input.trim() === '') throw validationError('document must be a Google Docs URL or document ID.');
  const s = input.trim();
  if (s.length > 2048) throw validationError('document reference is too long.');
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.includes('/')) {
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      throw validationError('document is not a valid Google Docs URL.');
    }
    if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com' || u.username || u.password || (u.port && u.port !== '443')) {
      throw validationError('document must be an https://docs.google.com/document/d/<id> URL.');
    }
    const m = URL_RE.exec(u.pathname);
    if (!m?.[1]) throw validationError('document URL does not contain a Google Docs document ID.');
    return m[1];
  }
  if (!ID_RE.test(s)) throw validationError('document is not a valid Google Docs document ID.');
  return s;
}

export const documentUrl = (id: string): string => `https://docs.google.com/document/d/${id}/edit`;

export function validateAppendText(text: unknown): string {
  if (typeof text !== 'string') throw validationError('text must be a string.');
  if (text.trim() === '') throw validationError('text must not be empty.');
  if (text.length > MAX_APPEND_CHARS) throw validationError(`text exceeds ${MAX_APPEND_CHARS} characters.`);
  if (text.includes('\u0000')) throw validationError('text contains a NUL character.');
  return text;
}
