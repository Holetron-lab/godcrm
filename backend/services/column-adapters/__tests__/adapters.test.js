/**
 * ADR-204 Stage 2a — adapter invariants (ticket 254364 AC4). Pure, no DB.
 *
 * The one property every case must hold: decode(encode(x), undo) = x at the
 * JSON level AND at the key-presence level. Everything else here is the
 * classification table from the ADR (image single/comma/JSON, audio,
 * email/phone, null/absent/empty, ambiguous, unsupported).
 */
import { describe, it, expect } from 'vitest';
import {
  forward, undo, getAdapter, targetTypeFor,
  CONVERTIBLE, EMPTY, ALREADY, AMBIGUOUS, UNSUPPORTED,
} from '../adapters.js';

// Stand-in for media-kind.js: extension only, nothing else known.
const EXT = { jpg: 'image', png: 'image', mp4: 'video', mp3: 'audio' };
const kindOf = async (url) => EXT[url.split(/[?#]/)[0].split('.').pop()] ?? null;
const ctx = { kindOf };

const roundTrip = async (type, present, value) => {
  const out = await forward(type, present, value, ctx);
  const back = undo(out.artifact);
  expect(JSON.stringify(back)).toBe(JSON.stringify(present ? { present: true, value } : { present: false }));
  return out;
};

describe('image → content', () => {
  it('single URL string → one item, kind from the source check', async () => {
    const out = await roundTrip('image', true, 'https://cdn/a.jpg');
    expect(out.status).toBe(CONVERTIBLE);
    expect(out.value).toEqual([{ url: 'https://cdn/a.jpg', kind: 'image' }]);
  });

  it('confirmed comma list → items in order, duplicates kept, undo returns the exact string', async () => {
    const raw = ' a.jpg , b.png,a.jpg';
    const out = await roundTrip('image', true, raw);
    expect(out.status).toBe(CONVERTIBLE);
    expect(out.value.map((i) => i.url)).toEqual(['a.jpg', 'b.png', 'a.jpg']);
    expect(undo(out.artifact).value).toBe(raw); // not re-joined after trim
  });

  it('JSON string stays a string on undo, never becomes an object', async () => {
    const raw = '["a.jpg","b.mp4"]';
    const out = await roundTrip('image', true, raw);
    expect(out.status).toBe(CONVERTIBLE);
    expect(out.value).toEqual([{ url: 'a.jpg', kind: 'image' }, { url: 'b.mp4', kind: 'video' }]);
    expect(typeof undo(out.artifact).value).toBe('string');
  });

  it('array of objects uses the display order (main first, then order) and keeps unknown fields in the artifact', async () => {
    const raw = [
      { path: 'second.jpg', order: 1, alt: 'kept' },
      { path: 'first.png', main: true, order: 5 },
      { src: 'third.jpg' },
    ];
    const out = await roundTrip('image', true, raw);
    expect(out.value.map((i) => i.url)).toEqual(['first.png', 'second.jpg', 'third.jpg']);
    expect(undo(out.artifact).value[0].alt).toBe('kept');
  });

  it('single object with an address key → one item', async () => {
    const out = await roundTrip('image', true, { file: 'x.png' });
    expect(out.value).toEqual([{ url: 'x.png', kind: 'image' }]);
  });

  it('comma inside a URL (absolute first segment + relative fragment) → ambiguous, left legacy', async () => {
    const out = await roundTrip('image', true, 'https://res.cloudinary.com/d/image/upload/c_fill,w_300/v1/a.jpg');
    expect(out.status).toBe(AMBIGUOUS);
    expect(out.value).toBeUndefined();
    expect(out.reason).not.toContain('cloudinary'); // reasons carry no payload
  });

  it('comma list with a query-string fragment → ambiguous', async () => {
    const out = await roundTrip('image', true, 'a.jpg?x=1,y=2');
    expect(out.status).toBe(AMBIGUOUS);
  });

  it('undeterminable MIME → ambiguous, never "image by default"', async () => {
    const out = await roundTrip('image', true, 'https://cdn/blob');
    expect(out.status).toBe(AMBIGUOUS);
    expect(out.reason).toMatch(/cannot be determined/);
  });

  it('object without an address key → ambiguous', async () => {
    expect((await roundTrip('image', true, { id: 7 })).status).toBe(AMBIGUOUS);
  });

  it('number and string do not mix', async () => {
    expect((await roundTrip('image', true, 42)).status).toBe(AMBIGUOUS);
    expect((await roundTrip('image', true, true)).status).toBe(AMBIGUOUS);
  });

  it.each([
    ['absent key', false, undefined],
    ['null', true, null],
    ['empty string', true, ''],
    ['blank string', true, '   '],
    ['empty array', true, []],
  ])('%s → empty (target null) and undo distinguishes the original form', async (_, present, value) => {
    const out = await roundTrip('image', present, value);
    expect(out.status).toBe(EMPTY);
    expect(out.value).toBeNull();
  });

  it('is idempotent: a value already in content form is reported, not wrapped again', async () => {
    const first = await forward('image', true, 'a.jpg,b.png', ctx);
    const second = await forward('image', true, first.value, ctx);
    expect(second.status).toBe(ALREADY);
    expect(second.value).toEqual(first.value);
  });

  it('config: gallery mode, version 1, existing keys kept, idempotent', () => {
    const { forwardConfig } = getAdapter('image');
    const cfg = forwardConfig({ image: { displayMode: 'stack' }, visibility: 'private' });
    expect(cfg).toEqual({ image: { displayMode: 'stack' }, visibility: 'private', content: { version: 1, mode: 'gallery' } });
    expect(forwardConfig(cfg)).toBe(cfg);
  });
});

describe('audio → content', () => {
  it('one audio item; a comma in the address is not a list', async () => {
    const out = await roundTrip('audio', true, 'https://cdn/a,b.mp3');
    expect(out.status).toBe(CONVERTIBLE);
    expect(out.value).toEqual([{ url: 'https://cdn/a,b.mp3', kind: 'audio' }]);
  });

  it('source type carries the kind when the address alone is undeterminable (prefix/suffix columns)', async () => {
    const out = await roundTrip('audio', true, 'track-17');
    expect(out.value).toEqual([{ url: 'track-17', kind: 'audio' }]);
  });

  it('address that resolves to another kind → ambiguous', async () => {
    const out = await roundTrip('audio', true, 'cover.jpg');
    expect(out.status).toBe(AMBIGUOUS);
  });

  it('non-string → ambiguous; empty forms → empty', async () => {
    expect((await roundTrip('audio', true, ['a.mp3'])).status).toBe(AMBIGUOUS);
    expect((await roundTrip('audio', true, '')).status).toBe(EMPTY);
    expect((await roundTrip('audio', false, undefined)).status).toBe(EMPTY);
  });

  it('config: audio mode, config.audio kept', () => {
    expect(getAdapter('audio').forwardConfig({ audio: { prefix: 'https://x/' } }))
      .toEqual({ audio: { prefix: 'https://x/' }, content: { version: 1, mode: 'audio' } });
  });
});

describe('email / phone → contact', () => {
  it('email: exact string, no trim, no lower-case', async () => {
    const out = await roundTrip('email', true, ' Ann@Example.COM ');
    expect(out.value).toEqual([{ kind: 'external', fields: { email: ' Ann@Example.COM ' } }]);
  });

  it('phone: +, leading zeros, spaces and formatting survive', async () => {
    const out = await roundTrip('phone', true, '+7 (900) 000-00-01');
    expect(out.value).toEqual([{ kind: 'external', fields: { phone: '+7 (900) 000-00-01' } }]);
    expect((await roundTrip('phone', true, '007')).value[0].fields.phone).toBe('007');
  });

  it('numeric-looking strings stay strings; actual numbers are ambiguous, never Number()-ed', async () => {
    expect((await roundTrip('phone', true, '89000000000')).status).toBe(CONVERTIBLE);
    expect((await roundTrip('phone', true, 89000000000)).status).toBe(AMBIGUOUS);
    expect((await roundTrip('email', true, 12345)).status).toBe(AMBIGUOUS);
  });

  it('empty forms → empty; already-contact → already', async () => {
    expect((await roundTrip('email', true, '')).status).toBe(EMPTY);
    expect((await roundTrip('email', true, null)).status).toBe(EMPTY);
    const first = await forward('email', true, 'a@b.c', ctx);
    expect((await forward('email', true, first.value, ctx)).status).toBe(ALREADY);
  });

  it('config: contact version 1, allowMultiple not invented', () => {
    expect(getAdapter('email').forwardConfig({ icon: '✉️' })).toEqual({ icon: '✉️', contact: { version: 1 } });
  });
});

describe('user / person → contact', () => {
  it.each(['user', 'person'])('%s is explicitly unsupported with a reason, value untouched', async (type) => {
    const out = await roundTrip(type, true, 17);
    expect(out.status).toBe(UNSUPPORTED);
    expect(out.reason).toMatch(/not confirmed/);
    expect(out.value).toBeUndefined();
  });
});

describe('registry', () => {
  it('maps every legacy source to its target and nothing else', () => {
    expect(targetTypeFor('image')).toBe('content');
    expect(targetTypeFor('audio')).toBe('content');
    for (const t of ['email', 'phone', 'user', 'person']) expect(targetTypeFor(t)).toBe('contact');
    expect(targetTypeFor('text')).toBeNull();
    expect(getAdapter('date')).toBeNull();
  });

  it('an unknown source type is unsupported, not null-ed', async () => {
    const out = await forward('date', true, '2026-01-01', ctx);
    expect(out.status).toBe(UNSUPPORTED);
    expect(undo(out.artifact)).toEqual({ present: true, value: '2026-01-01' });
  });
});
