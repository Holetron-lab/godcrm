// ADR-0011 · Phase E2 · Integration smoke for the atom-write-path hook.
//
// Mocks dbGet (so no real DB hit) and exercises the conditional branches:
//   - non-atoms_v2 table → no-op
//   - atoms_v2 row without semantic_type → no-op
//   - atoms_v2 + verification_settings + flag-off → no-op
//   - flag-on + missing column_id → 400
//   - flag-on + non-verification column → 403
//   - flag-on + tightening override → 200
//   - flag-on + loosening override → 400 with field

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const dbGetMock = vi.fn();

vi.mock('../../../database/connection.js', () => ({
  dbGet: (...args) => dbGetMock(...args),
}));

const { validateVerificationSettingsAtom } = await import('../applyOverrideValidator.js');
const { ATOMS_V2_TABLE_ID } = await import('../../atoms-archive.js');

const baseConfig = {
  available_methods: ['totp', 'captcha'],
  required_methods: 1,
  method: 'totp',
  cooldown_seconds: 300,
  cooldown_ms: 300000,
  ttl_seconds: 3600,
  ttl_ms: 3600000,
  locks_on_statuses: [],
  unlocks_on_statuses: [],
  guards: ['row_update_guard'],
  policy: 'any_n',
  rate_limit: null,
  method_config: {},
};

beforeEach(() => {
  dbGetMock.mockReset();
});

afterEach(() => {
  delete process.env.VERIFICATION_COLUMN_ENABLED;
});

describe('validateVerificationSettingsAtom — short-circuits', () => {
  it('non-atoms_v2 table → ok (no DB hit)', async () => {
    const r = await validateVerificationSettingsAtom({
      tableId: 999,
      data: { semantic_type: 'verification_settings', column_id: 1, override: { cooldown_seconds: 60 } },
    });
    expect(r).toEqual({ ok: true });
    expect(dbGetMock).not.toHaveBeenCalled();
  });

  it('atoms_v2 + non-verification atom → ok', async () => {
    const r = await validateVerificationSettingsAtom({
      tableId: ATOMS_V2_TABLE_ID,
      data: { semantic_type: 'widget_atom', widget_ref: 218 },
    });
    expect(r).toEqual({ ok: true });
    expect(dbGetMock).not.toHaveBeenCalled();
  });

  it('flag off → ok regardless of payload', async () => {
    delete process.env.VERIFICATION_COLUMN_ENABLED;
    const r = await validateVerificationSettingsAtom({
      tableId: ATOMS_V2_TABLE_ID,
      data: { semantic_type: 'verification_settings', column_id: 1, override: { cooldown_seconds: 1 } },
    });
    expect(r).toEqual({ ok: true });
    expect(dbGetMock).not.toHaveBeenCalled();
  });

  it('null/empty data → ok', async () => {
    expect((await validateVerificationSettingsAtom({ tableId: ATOMS_V2_TABLE_ID, data: null })).ok).toBe(true);
    expect((await validateVerificationSettingsAtom({ tableId: ATOMS_V2_TABLE_ID, data: 'string' })).ok).toBe(true);
  });
});

describe('validateVerificationSettingsAtom — flag-on validation', () => {
  beforeEach(() => {
    process.env.VERIFICATION_COLUMN_ENABLED = 'true';
  });

  it('missing column_id → 400', async () => {
    const r = await validateVerificationSettingsAtom({
      tableId: ATOMS_V2_TABLE_ID,
      data: { semantic_type: 'verification_settings', override: {} },
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.field).toBe('column_id');
  });

  it('column not found → 400', async () => {
    dbGetMock.mockResolvedValueOnce(null);
    const r = await validateVerificationSettingsAtom({
      tableId: ATOMS_V2_TABLE_ID,
      data: { semantic_type: 'verification_settings', column_id: 42, override: { cooldown_seconds: 600 } },
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.field).toBe('column_id');
  });

  it('non-verification column → 403', async () => {
    dbGetMock.mockResolvedValueOnce({ id: 99, type: 'text', config: '{}' });
    const r = await validateVerificationSettingsAtom({
      tableId: ATOMS_V2_TABLE_ID,
      data: { semantic_type: 'verification_settings', column_id: 99, override: {} },
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(r.field).toBe('column_id');
  });

  it('malformed base config → 400', async () => {
    dbGetMock.mockResolvedValueOnce({ id: 5, type: 'verification', config: 'not-json' });
    const r = await validateVerificationSettingsAtom({
      tableId: ATOMS_V2_TABLE_ID,
      data: { semantic_type: 'verification_settings', column_id: 5, override: { cooldown_seconds: 600 } },
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it('null override → ok (no-op)', async () => {
    const r = await validateVerificationSettingsAtom({
      tableId: ATOMS_V2_TABLE_ID,
      data: { semantic_type: 'verification_settings', column_id: 5, override: null },
    });
    expect(r.ok).toBe(true);
    expect(dbGetMock).not.toHaveBeenCalled();
  });

  it('non-object override → 400', async () => {
    const r = await validateVerificationSettingsAtom({
      tableId: ATOMS_V2_TABLE_ID,
      data: { semantic_type: 'verification_settings', column_id: 5, override: 'tighten please' },
    });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('override');
  });

  it('tightening override → ok', async () => {
    dbGetMock.mockResolvedValueOnce({ id: 5, type: 'verification', config: JSON.stringify(baseConfig) });
    const r = await validateVerificationSettingsAtom({
      tableId: ATOMS_V2_TABLE_ID,
      data: {
        semantic_type: 'verification_settings',
        column_id: 5,
        override: { cooldown_seconds: 600, guards: ['row_update_guard', 'extra'] },
      },
    });
    expect(r).toEqual({ ok: true });
  });

  it('loosening override (lower cooldown) → 400', async () => {
    dbGetMock.mockResolvedValueOnce({ id: 5, type: 'verification', config: JSON.stringify(baseConfig) });
    const r = await validateVerificationSettingsAtom({
      tableId: ATOMS_V2_TABLE_ID,
      data: {
        semantic_type: 'verification_settings',
        column_id: 5,
        override: { cooldown_seconds: 60 },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.field).toBe('cooldown_seconds');
  });

  it('loosening override (drops guard) → 400 with field=guards', async () => {
    dbGetMock.mockResolvedValueOnce({ id: 5, type: 'verification', config: JSON.stringify(baseConfig) });
    const r = await validateVerificationSettingsAtom({
      tableId: ATOMS_V2_TABLE_ID,
      data: {
        semantic_type: 'verification_settings',
        column_id: 5,
        override: { guards: [] },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('guards');
  });

  it('config returned as object (PG JSONB) → handled', async () => {
    dbGetMock.mockResolvedValueOnce({ id: 5, type: 'verification', config: baseConfig });
    const r = await validateVerificationSettingsAtom({
      tableId: ATOMS_V2_TABLE_ID,
      data: { semantic_type: 'verification_settings', column_id: 5, override: { cooldown_seconds: 600 } },
    });
    expect(r).toEqual({ ok: true });
  });
});
