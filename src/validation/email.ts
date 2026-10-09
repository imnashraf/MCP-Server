import { validationError } from '../errors/app-error.js';

export const LIMITS = {
  subject: 998,
  bodyText: 500_000,
  bodyHtml: 500_000,
  address: 254,
};

// Pragmatic addr-spec check: dot-atom local part, DNS-style domain. Rejects display names, quotes, whitespace.
const LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export function hasControlChars(s: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f\u2028\u2029]/.test(s);
}

export function normalizeAddress(raw: unknown, field: string): string {
  if (typeof raw !== 'string') throw validationError(`${field} must contain email address strings.`);
  const s = raw.trim();
  if (!s) throw validationError(`${field} contains an empty address.`);
  if (hasControlChars(s)) throw validationError(`${field} contains control or line-break characters.`);
  if (s.length > LIMITS.address) throw validationError(`${field} contains an address that is too long.`);
  const at = s.lastIndexOf('@');
  if (at < 1 || at !== s.indexOf('@')) throw validationError(`${field} contains an invalid email address.`);
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  const labels = domain.split('.');
  if (local.length > 64 || !LOCAL.test(local) || labels.length < 2 || !labels.every((l) => LABEL.test(l))) {
    throw validationError(`${field} contains an invalid email address.`);
  }
  return `${local}@${domain.toLowerCase()}`;
}

export function toAddressList(value: unknown, field: string, required: boolean): string[] {
  if (value === undefined || value === null) {
    if (required) throw validationError(`${field} is required.`);
    return [];
  }
  const arr = Array.isArray(value) ? value : [value];
  if (required && arr.length === 0) throw validationError(`${field} must contain at least one address.`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of arr) {
    const a = normalizeAddress(item, field);
    if (!seen.has(a)) {
      seen.add(a);
      out.push(a);
    }
  }
  return out;
}

export function validateSubject(subject: unknown): string {
  if (typeof subject !== 'string' || subject.trim() === '') throw validationError('subject must be a non-empty string.');
  if (hasControlChars(subject)) throw validationError('subject must not contain control or line-break characters.');
  if (subject.length > LIMITS.subject) throw validationError(`subject exceeds ${LIMITS.subject} characters.`);
  return subject.trim();
}

export function validateBody(body: unknown, field: string, max: number, required: boolean): string | undefined {
  if (body === undefined || body === null) {
    if (required) throw validationError(`${field} is required.`);
    return undefined;
  }
  if (typeof body !== 'string' || (required && body.trim() === '')) throw validationError(`${field} must be a non-empty string.`);
  if (body.length > max) throw validationError(`${field} exceeds ${max} characters.`);
  if (body.includes('\u0000')) throw validationError(`${field} contains a NUL character.`);
  return body;
}
