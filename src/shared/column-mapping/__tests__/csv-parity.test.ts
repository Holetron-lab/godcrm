// ADR-207 W3.1 — characterization matrix for the live CSV path.
//
// Recorded against the implementations that CreateTableModal actually calls
// (csv-utils.ts guessColumnType/parseCSV, notion-utils.ts convertValue) before
// the extraction, then pointed at src/shared/column-mapping. Every expectation
// below is a behaviour the live import had on main@3e2997be; a change here is a
// regression, not a refactor.
import { describe, expect, it } from 'vitest';
import { convertValue, guessColumnType, parseCSV } from '@/shared/column-mapping';

describe('guessColumnType (live CSV heuristic)', () => {
  it.each([
    ['email', [], 'email'],
    ['Phone', ['x'], 'phone'],
    ['tel', ['x'], 'phone'],
    ['website', ['x'], 'url'],
    ['link', ['x'], 'url'],
    ['created_at', [], 'datetime'],
    ['Updated', ['x'], 'datetime'],
    ['total', ['x'], 'number'],
    ['price', ['x'], 'number'],
  ])('%s → %s by header name', (name, values, expected) => {
    expect(guessColumnType(name, values)).toBe(expected);
  });

  it('detects numbers with a decimal comma', () => {
    expect(guessColumnType('qty', ['1', '2,5', ' 3 '])).toBe('number');
  });

  it('detects booleans in any supported language (allAreBooleans)', () => {
    expect(guessColumnType('flag', ['yes', 'нет', 'true'])).toBe('checkbox');
    expect(guessColumnType('flag', ['ja', 'nein'])).toBe('checkbox');
  });

  it('detects ISO dates and emails from values', () => {
    expect(guessColumnType('when', ['2026-09-28', '2026-09-29'])).toBe('datetime');
    expect(guessColumnType('contact', ['a@b.co', 'c@d.io'])).toBe('email');
  });

  it('treats comma lists (not Notion links) as select', () => {
    expect(guessColumnType('tags', ['a, b', 'c, d', 'e'])).toBe('select');
    expect(guessColumnType('rel', ['a (https://www.notion.so/a-1), b', 'c'])).toBe('text');
  });

  it('falls back to text for prose and empty samples', () => {
    expect(guessColumnType('note', ['hello', 'world'])).toBe('text');
    expect(guessColumnType('empty', ['', '  '])).toBe('text');
  });
});

describe('convertValue (live CSV conversion)', () => {
  it('returns null for blank input regardless of type', () => {
    expect(convertValue('', 'number')).toBeNull();
    expect(convertValue('   ', 'text')).toBeNull();
  });

  it('parses numbers with spaces and decimal comma', () => {
    expect(convertValue('1 234,5', 'number')).toBe(1234.5);
    expect(convertValue('abc', 'number')).toBeNull();
  });

  it('parses checkbox values via BOOL_TRUE_VALUES with trim', () => {
    expect(convertValue('Да ', 'checkbox')).toBe(true);
    expect(convertValue('ja', 'checkbox')).toBe(true);
    expect(convertValue('no', 'checkbox')).toBe(false);
    expect(convertValue('maybe', 'checkbox')).toBe(false);
  });

  it('normalises dates to ISO and keeps unparsable text', () => {
    expect(convertValue('2026-09-28', 'datetime')).toBe(new Date('2026-09-28').toISOString());
    expect(convertValue('not a date', 'date')).toBe('not a date');
  });

  it('passes other types through untouched', () => {
    expect(convertValue('x', 'text')).toBe('x');
    expect(convertValue('open', 'select')).toBe('open');
  });
});

describe('parseCSV (live CSV parser)', () => {
  it('parses comma rows and drops trailing newline', () => {
    expect(parseCSV('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('switches to semicolon when the header has more of them', () => {
    expect(parseCSV('a;b;c\n1;2;3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('honours quotes, embedded delimiters and doubled quotes', () => {
    expect(parseCSV('a,b\n"x, y","he said ""hi"""')).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
  });

  it('handles CRLF and skips blank lines', () => {
    expect(parseCSV('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCSV('a,b\n\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('trims cells', () => {
    expect(parseCSV(' a , b \n 1 , 2 ')).toEqual([['a', 'b'], ['1', '2']]);
  });
});
