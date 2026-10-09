import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors/app-error.js';
import { normalizeAddress, toAddressList, validateSubject } from '../../src/validation/email.js';
import { parseDocumentRef, validateAppendText } from '../../src/validation/document.js';
import { DOC_ID } from '../helpers.js';

describe('email validation', () => {
  it('accepts and lowercases the domain', () => {
    expect(normalizeAddress(' User@Example.COM ', 'to')).toBe('User@example.com');
  });
  it.each(['', 'nope', 'a@b', 'a b@c.com', 'a@@c.com', 'Name <a@c.com>', 'a@c..com', '"x"@c.com'])('rejects %j', (bad) => {
    expect(() => normalizeAddress(bad, 'to')).toThrow(AppError);
  });
  it('rejects CR/LF injection in addresses and subject', () => {
    expect(() => normalizeAddress('a@c.com\r\nBcc: evil@x.com', 'to')).toThrow(/control/);
    expect(() => validateSubject('Hi\r\nBcc: evil@x.com')).toThrow(/line-break/);
  });
  it('requires at least one recipient, accepts string or array, de-duplicates', () => {
    expect(() => toAddressList([], 'to', true)).toThrow();
    expect(() => toAddressList(undefined, 'to', true)).toThrow();
    expect(toAddressList('a@c.com', 'to', true)).toEqual(['a@c.com']);
    expect(toAddressList(['a@c.com', 'A@c.com'.toLowerCase()], 'to', true)).toEqual(['a@c.com']);
    expect(toAddressList(undefined, 'cc', false)).toEqual([]);
  });
  it('rejects empty and oversized subjects', () => {
    expect(() => validateSubject('   ')).toThrow();
    expect(() => validateSubject('x'.repeat(999))).toThrow(/exceeds/);
  });
});

describe('document parsing', () => {
  it('accepts raw ids and docs URLs', () => {
    expect(parseDocumentRef(DOC_ID)).toBe(DOC_ID);
    expect(parseDocumentRef(`https://docs.google.com/document/d/${DOC_ID}/edit?tab=t.0`)).toBe(DOC_ID);
    expect(parseDocumentRef(`https://docs.google.com/document/u/1/d/${DOC_ID}`)).toBe(DOC_ID);
  });
  it.each([
    `http://docs.google.com/document/d/${DOC_ID}/edit`,
    `https://evil.com/document/d/${DOC_ID}/edit`,
    `https://docs.google.com.evil.com/document/d/${DOC_ID}/edit`,
    `https://user@docs.google.com/document/d/${DOC_ID}/edit`,
    `https://docs.google.com/spreadsheets/d/${DOC_ID}/edit`,
    'short',
    '../etc/passwd',
    '',
  ])('rejects %j', (bad) => {
    expect(() => parseDocumentRef(bad)).toThrow(AppError);
  });
  it('rejects empty text', () => {
    expect(() => validateAppendText('  \n ')).toThrow();
    expect(validateAppendText('hi')).toBe('hi');
  });
});
