/**
 * ADR-190-A D1 — `spaces.settings.public_seo` read/write pair.
 *
 * AC-1: defaults for NULL / empty / unparseable settings.
 * AC-2: setPublicSeoPrefs is read-modify-write — sibling keys survive.
 *
 * The DB layer is mocked, so this is hermetic and never reaches a master
 * (ADR-0009).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbGet = vi.fn();
const dbRun = vi.fn();
const dbAll = vi.fn();

vi.mock('../../database/connection.js', () => ({ dbGet, dbRun, dbAll }));

const { readPublicSeoPrefs, setPublicSeoPrefs, listIndexableSpaces, getVisibility } =
  await import('../SpaceVisibilityService.js');

const DEFAULTS = {
  indexable: false,
  in_sitemap: false,
  site_origin: '',
  site_name: 'GOD CRM',
  title_template: '%s — GOD CRM Docs',
  default_description:
    'GOD CRM documentation — spaces, tables, agents, modules and widgets.',
  og_image: '',
  default_lang: 'en',
};

beforeEach(() => {
  dbGet.mockReset();
  dbRun.mockReset();
  dbAll.mockReset();
});

describe('readPublicSeoPrefs (AC-1)', () => {
  it('returns the documented defaults for null / empty / garbage settings', () => {
    expect(readPublicSeoPrefs(null)).toEqual(DEFAULTS);
    expect(readPublicSeoPrefs('')).toEqual(DEFAULTS);
    expect(readPublicSeoPrefs('{not json')).toEqual(DEFAULTS);
    expect(readPublicSeoPrefs('{}')).toEqual(DEFAULTS);
    expect(readPublicSeoPrefs('{"public_sidebar":{"hidden":true}}')).toEqual(DEFAULTS);
  });

  it('accepts an already-parsed object as well as a JSON string', () => {
    expect(readPublicSeoPrefs({ public_seo: { indexable: true } }).indexable).toBe(true);
    expect(readPublicSeoPrefs('{"public_seo":{"indexable":true}}').indexable).toBe(true);
  });

  it('coerces booleans strictly — only true is true', () => {
    const seo = readPublicSeoPrefs({ public_seo: { indexable: 'yes', in_sitemap: 1 } });
    expect(seo.indexable).toBe(false);
    expect(seo.in_sitemap).toBe(false);
  });

  it('ignores blank / wrong-typed strings and non-object public_seo', () => {
    const seo = readPublicSeoPrefs({
      public_seo: { site_name: '   ', title_template: 42, default_lang: 'ru' },
    });
    expect(seo.site_name).toBe(DEFAULTS.site_name);
    expect(seo.title_template).toBe(DEFAULTS.title_template);
    expect(seo.default_lang).toBe('ru');
    expect(readPublicSeoPrefs({ public_seo: ['nope'] })).toEqual(DEFAULTS);
    expect(readPublicSeoPrefs({ public_seo: 'nope' })).toEqual(DEFAULTS);
  });

  it('strips trailing slashes from site_origin so canonicals concatenate cleanly', () => {
    expect(readPublicSeoPrefs({ public_seo: { site_origin: 'https://godcrm.ai/' } }).site_origin)
      .toBe('https://godcrm.ai');
    expect(readPublicSeoPrefs({ public_seo: { site_origin: '  https://godcrm.ai//  ' } }).site_origin)
      .toBe('https://godcrm.ai');
  });
});

describe('setPublicSeoPrefs (AC-2)', () => {
  it('preserves public_sidebar and every other sibling key', async () => {
    dbGet.mockResolvedValue({
      id: 7773,
      settings: JSON.stringify({
        public_sidebar: { default_open: false, hidden: true },
        tickets_config: { foo: 1 },
      }),
    });

    const saved = await setPublicSeoPrefs(7773, { indexable: true, in_sitemap: true });

    const [sql, params] = dbRun.mock.calls[0];
    expect(sql).toMatch(/UPDATE spaces SET settings/);
    const written = JSON.parse(params[0]);
    expect(written.public_sidebar).toEqual({ default_open: false, hidden: true });
    expect(written.tickets_config).toEqual({ foo: 1 });
    expect(written.public_seo.indexable).toBe(true);
    expect(saved.in_sitemap).toBe(true);
  });

  it('normalises through the reader — unknown keys never persist', async () => {
    dbGet.mockResolvedValue({ id: 1, settings: null });
    await setPublicSeoPrefs(1, { indexable: true, evil: '<script>', site_origin: 'javascript:x' });
    const written = JSON.parse(dbRun.mock.calls[0][1][0]);
    expect(written.public_seo).toEqual({ ...DEFAULTS, indexable: true, site_origin: 'javascript:x' });
    expect(written.public_seo.evil).toBeUndefined();
  });

  it('keeps stored keys the caller did not mention (partial write)', async () => {
    dbGet.mockResolvedValue({
      id: 7773,
      settings: JSON.stringify({
        public_seo: {
          indexable: false,
          in_sitemap: true,
          site_origin: 'https://godcrm.ai',
          site_name: 'GOD CRM Docs',
          title_template: '%s | Docs',
        },
      }),
    });

    // The settings UI flipping one toggle must not reset the text fields.
    const saved = await setPublicSeoPrefs(7773, { indexable: true });

    expect(saved.indexable).toBe(true);
    expect(saved.in_sitemap).toBe(true);
    expect(saved.site_origin).toBe('https://godcrm.ai');
    expect(saved.site_name).toBe('GOD CRM Docs');
    expect(saved.title_template).toBe('%s | Docs');
  });

  it('throws for a missing space instead of writing', async () => {
    dbGet.mockResolvedValue(undefined);
    await expect(setPublicSeoPrefs(999, {})).rejects.toThrow('Space not found');
    expect(dbRun).not.toHaveBeenCalled();
  });
});

describe('getVisibility surfaces public_seo (AC-3, read half)', () => {
  it('includes the prefs block alongside public_sidebar', async () => {
    dbGet.mockResolvedValue({
      visibility: 'external',
      public_slug: 'help',
      public_password_hash: null,
      settings: JSON.stringify({ public_seo: { indexable: true, site_origin: 'https://godcrm.ai' } }),
    });
    const out = await getVisibility(7773);
    expect(out.public_seo.indexable).toBe(true);
    expect(out.public_seo.site_origin).toBe('https://godcrm.ai');
    expect(out.public_sidebar).toBeDefined();
  });
});

describe('listIndexableSpaces (AC-4, sitemap half)', () => {
  it('filters the SQL on external + no password, then on the opt-in', async () => {
    dbAll.mockResolvedValue([
      { id: 1, name: 'A', public_slug: 'a', settings: JSON.stringify({ public_seo: { indexable: true } }) },
      { id: 2, name: 'B', public_slug: 'b', settings: null },
    ]);
    const spaces = await listIndexableSpaces();

    const sql = dbAll.mock.calls[0][0];
    expect(sql).toMatch(/visibility = 'external'/);
    expect(sql).toMatch(/public_password_hash IS NULL/);
    expect(spaces.map((s) => s.id)).toEqual([1]);
  });
});
