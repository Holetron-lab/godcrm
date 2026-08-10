// @vitest-environment node
/**
 * ADR-182 — Lean write-responses for agent MCP tools.
 *
 * Pins the two composable behaviors that fix the Friction-footer retrofit pain:
 *   T1 — update_table_row / batch_update_rows return a lean digest by default
 *        ({changed, bytes, tail}) instead of echoing the whole (multi-KB) row;
 *        full row is opt-in via response:"full", head preview via include_head.
 *   T2 — upsert_section idempotently replace-or-appends a marker-anchored section
 *        server-side, so the client no longer pulls the whole prompt, splices,
 *        pushes it back, and hand-verifies with SHA-256.
 *
 * Runs fully mocked (no DB) — parity with data-tools-automation-triggers.test.js.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const dbGet = vi.fn();
const dbRun = vi.fn();
const dbAll = vi.fn();

vi.mock('../../../database/connection.js', () => ({
  dbGet: (...a) => dbGet(...a),
  dbRun: (...a) => dbRun(...a),
  dbAll: (...a) => dbAll(...a),
  isPostgres: () => true,
  sqlNow: () => 'NOW()',
}));

vi.mock('../../../utils/baseId.js', () => ({ generateBaseId: () => 'BASEID01' }));

vi.mock('../../SelectValueResolver.js', () => ({
  resolveSelectValues: vi.fn(async (_tableId, data) => ({ resolvedData: data, errors: [], rejections: [] })),
  validateAllColumns: vi.fn(async () => ({ errors: [], rejections: [] })),
}));

vi.mock('../../atoms-archive.js', () => ({
  applyAtomVersioning: vi.fn(async ({ newData }) => newData),
  isAtomsV2Table: () => false,
}));

vi.mock('../coerceDataInput.js', () => ({ coerceDataObject: (data) => data }));

const fireRowCreateTriggers = vi.fn(() => Promise.resolve());
const fireRowUpdateTriggers = vi.fn(() => Promise.resolve());
vi.mock('../../AutomationTriggerService.js', () => ({
  fireRowCreateTriggers: (...a) => fireRowCreateTriggers(...a),
  fireRowUpdateTriggers: (...a) => fireRowUpdateTriggers(...a),
}));

const { dataToolHandlers, buildWriteDigest, upsertMarkedSection, pickFields } = await import('../data-tools.js');

beforeEach(() => {
  dbGet.mockReset();
  dbRun.mockReset();
  dbAll.mockReset();
  fireRowCreateTriggers.mockClear();
  fireRowUpdateTriggers.mockClear();
});

// ── Pure helpers ────────────────────────────────────────────────────────────

describe('buildWriteDigest', () => {
  it('reports changed[], per-field bytes and a ~120-char tail; no head by default', () => {
    const long = 'x'.repeat(400);
    const d = buildWriteDigest(['main_instructions'], { main_instructions: long, other: 'ignored' });
    expect(d.changed).toEqual(['main_instructions']);
    expect(d.bytes.main_instructions).toBe(400);
    expect(d.tail.main_instructions.startsWith('…')).toBe(true);
    expect(d.tail.main_instructions.length).toBe(121); // 120 chars + ellipsis
    expect(d.other).toBeUndefined();
    expect(d.head).toBeUndefined();
  });

  it('counts UTF-8 bytes, not code units', () => {
    const d = buildWriteDigest(['f'], { f: '⚙️' }); // multi-byte
    expect(d.bytes.f).toBe(Buffer.byteLength('⚙️', 'utf8'));
  });

  it('adds a head preview only when includeHead is set', () => {
    const long = 'ab'.repeat(200);
    const d = buildWriteDigest(['f'], { f: long }, { includeHead: true });
    expect(d.head.f.endsWith('…')).toBe(true);
    expect(d.head.f.length).toBe(121);
  });
});

describe('upsertMarkedSection', () => {
  const MARKER = '## ⚙️ Friction footer';
  const SECTION = `${MARKER}\n- something rubbed → workaround`;

  it('appends the section when the marker is absent', () => {
    const out = upsertMarkedSection('# Prompt\n\nbody text', MARKER, SECTION);
    expect(out).toBe('# Prompt\n\nbody text\n\n' + SECTION);
  });

  it('appends into an empty field without a leading separator', () => {
    expect(upsertMarkedSection('', MARKER, SECTION)).toBe(SECTION);
  });

  it('replaces an existing section in place (up to the next same-level heading)', () => {
    const src = `# Prompt\n\n${MARKER}\n- OLD content\n\n## Next heading\ntail`;
    const out = upsertMarkedSection(src, MARKER, SECTION);
    expect(out).toBe(`# Prompt\n\n${MARKER}\n- something rubbed → workaround\n\n## Next heading\ntail`);
    expect(out).not.toContain('OLD content');
  });

  it('a deeper subheading inside the section is NOT a boundary', () => {
    const src = `${MARKER}\n### sub\nkept-inside\n## sibling\nafter`;
    const out = upsertMarkedSection(src, MARKER, SECTION);
    expect(out).toContain('## sibling\nafter');
    expect(out).not.toContain('kept-inside');
  });

  it('is idempotent: re-running with identical content is byte-identical', () => {
    const base = '# Prompt\n\nbody';
    const once = upsertMarkedSection(base, MARKER, SECTION);
    const twice = upsertMarkedSection(once, MARKER, SECTION);
    expect(twice).toBe(once); // this is what replaces Smith's manual SHA-256 check
  });
});

// ── Handler: update_table_row ────────────────────────────────────────────────

describe('update_table_row — minimal-by-default echo (T1)', () => {
  it('returns a lean digest by default, not the full row', async () => {
    dbGet.mockResolvedValueOnce({ id: 1, table_id: 1784, data: { name: 'Bot', main_instructions: 'old' } });
    dbRun.mockResolvedValueOnce({});

    const res = await dataToolHandlers.update_table_row(
      { table_id: 1784, row_id: 1, data: { main_instructions: 'y'.repeat(300) } },
      1
    );

    expect(res).toMatchObject({ success: true, table_id: 1784, row_id: 1, changed: ['main_instructions'] });
    expect(res.bytes.main_instructions).toBe(300);
    expect(res.tail.main_instructions.startsWith('…')).toBe(true);
    expect(res.data).toBeUndefined();          // ← the whole point: no fat echo
    expect(res.head).toBeUndefined();
  });

  it('returns the full row on response:"full" (RFC 7240 return=representation)', async () => {
    dbGet.mockResolvedValueOnce({ id: 1, table_id: 1784, data: { name: 'Bot' } });
    dbRun.mockResolvedValueOnce({});

    const res = await dataToolHandlers.update_table_row(
      { table_id: 1784, row_id: 1, data: { name: 'Bot2' }, response: 'full' },
      1
    );

    expect(res.data).toMatchObject({ name: 'Bot2' });
    expect(res.changed).toBeUndefined();
  });

  it('adds a head preview on include_head:true', async () => {
    dbGet.mockResolvedValueOnce({ id: 1, table_id: 1784, data: {} });
    dbRun.mockResolvedValueOnce({});

    const res = await dataToolHandlers.update_table_row(
      { table_id: 1784, row_id: 1, data: { f: 'z'.repeat(300) }, include_head: true },
      1
    );

    expect(res.head.f.endsWith('…')).toBe(true);
  });
});

// ── Handler: batch_update_rows ───────────────────────────────────────────────

describe('batch_update_rows — opt-in response (T1b)', () => {
  it('default stays lean: success is an array of row ids', async () => {
    dbGet
      .mockResolvedValueOnce({ id: 1784 })                 // table exists
      .mockResolvedValueOnce({ data: { s: 'a' } })         // row 11
      .mockResolvedValueOnce({ data: { s: 'a' } });        // row 22
    dbRun.mockResolvedValue({});

    const res = await dataToolHandlers.batch_update_rows(
      { table_id: 1784, updates: [{ row_id: 11, data: { s: 'b' } }, { row_id: 22, data: { s: 'b' } }] },
      1
    );

    expect(res.success).toEqual([11, 22]);
  });

  it('response:"full" carries per-row merged data', async () => {
    dbGet
      .mockResolvedValueOnce({ id: 1784 })
      .mockResolvedValueOnce({ data: { s: 'a' } });
    dbRun.mockResolvedValue({});

    const res = await dataToolHandlers.batch_update_rows(
      { table_id: 1784, updates: [{ row_id: 11, data: { s: 'b' } }], response: 'full' },
      1
    );

    expect(res.success).toEqual([{ row_id: 11, data: { s: 'b' } }]);
  });
});

// ── Handler: upsert_section ──────────────────────────────────────────────────

describe('upsert_section (T2)', () => {
  const MARKER = '## ⚙️ Friction footer';
  const SECTION = `${MARKER}\n- rubbed → workaround`;

  it('appends the section, fires the automation, and returns a digest (never the whole field)', async () => {
    dbGet.mockResolvedValueOnce({ id: 5, table_id: 1784, data: { main_instructions: '# Prompt\n\nbody' } });
    dbRun.mockResolvedValueOnce({});

    const res = await dataToolHandlers.upsert_section(
      { table_id: 1784, row_id: 5, field: 'main_instructions', marker: MARKER, content: SECTION },
      1
    );

    expect(res).toMatchObject({ success: true, table_id: 1784, row_id: 5, changed: ['main_instructions'] });
    expect(res.data).toBeUndefined();                       // digest, not the whole field
    expect(res.tail.main_instructions).toContain('workaround');
    // what was actually persisted:
    const stored = JSON.parse(dbRun.mock.calls[0][1][0]);
    expect(stored.main_instructions).toBe('# Prompt\n\nbody\n\n' + SECTION);
    expect(fireRowUpdateTriggers).toHaveBeenCalledTimes(1);
  });

  it('replaces an existing section in place', async () => {
    const start = `# Prompt\n\n${MARKER}\n- OLD`;
    dbGet.mockResolvedValueOnce({ id: 5, table_id: 1784, data: { main_instructions: start } });
    dbRun.mockResolvedValueOnce({});

    await dataToolHandlers.upsert_section(
      { table_id: 1784, row_id: 5, field: 'main_instructions', marker: MARKER, content: SECTION },
      1
    );

    const stored = JSON.parse(dbRun.mock.calls[0][1][0]);
    expect(stored.main_instructions).toBe(`# Prompt\n\n${MARKER}\n- rubbed → workaround`);
    expect(stored.main_instructions).not.toContain('OLD');
  });

  it('is idempotent end-to-end: second run persists byte-identical field state', async () => {
    // Run 1 — marker absent → append.
    dbGet.mockResolvedValueOnce({ id: 5, table_id: 1784, data: { main_instructions: '# Prompt\n\nbody' } });
    dbRun.mockResolvedValueOnce({});
    await dataToolHandlers.upsert_section(
      { table_id: 1784, row_id: 5, field: 'main_instructions', marker: MARKER, content: SECTION }, 1
    );
    const afterFirst = JSON.parse(dbRun.mock.calls[0][1][0]).main_instructions;

    // Run 2 — feed the stored value back → replace → must equal run 1.
    dbGet.mockResolvedValueOnce({ id: 5, table_id: 1784, data: { main_instructions: afterFirst } });
    dbRun.mockResolvedValueOnce({});
    await dataToolHandlers.upsert_section(
      { table_id: 1784, row_id: 5, field: 'main_instructions', marker: MARKER, content: SECTION }, 1
    );
    const afterSecond = JSON.parse(dbRun.mock.calls[1][1][0]).main_instructions;

    expect(afterSecond).toBe(afterFirst);
  });

  it('rejects a missing row and does not write', async () => {
    dbGet.mockResolvedValueOnce(undefined);
    const res = await dataToolHandlers.upsert_section(
      { table_id: 1784, row_id: 999, field: 'main_instructions', marker: MARKER, content: SECTION }, 1
    );
    expect(res.error).toBeTruthy();
    expect(dbRun).not.toHaveBeenCalled();
  });

  it('validates required string args', async () => {
    const res = await dataToolHandlers.upsert_section(
      { table_id: 1784, row_id: 5, field: 'main_instructions', marker: MARKER }, 1
    );
    expect(res.error).toMatch(/content is required/);
  });
});

// ─── Tier 3 — read-side field projection ────────────────────────────────────

describe('pickFields (T3 helper)', () => {
  it('keeps only requested keys and reports unknowns (lenient, never throws)', () => {
    const { picked, unknown } = pickFields(
      { name: 'Bot', role: 'dev', main_instructions: 'x' },
      ['name', 'nope', 'role']
    );
    expect(picked).toEqual({ name: 'Bot', role: 'dev' });
    expect(unknown).toEqual(['nope']);
  });

  it('tolerates a null/undefined data object', () => {
    expect(pickFields(null, ['a'])).toEqual({ picked: {}, unknown: ['a'] });
  });
});

describe('query_table_data — field projection (T3, flat container)', () => {
  const rows = [
    { id: 11, data: { name: 'Bot', role: 'dev', main_instructions: 'long…' }, created_at: 'T1' },
    { id: 12, data: { name: 'Ann', role: 'qa', main_instructions: 'also long…' }, created_at: 'T2' },
  ];

  it('omitted fields → full row, no unknown_fields key (byte-identical default)', async () => {
    dbGet.mockResolvedValueOnce({ id: 1784, name: 'Agents' });
    dbAll.mockResolvedValueOnce(rows);
    const res = await dataToolHandlers.query_table_data({ table_id: 1784 });
    expect(res.rows[0]).toEqual({ id: 11, name: 'Bot', role: 'dev', main_instructions: 'long…', created_at: 'T1' });
    expect(res).not.toHaveProperty('unknown_fields');
  });

  it('fields → projects data columns; id + created_at always present', async () => {
    dbGet.mockResolvedValueOnce({ id: 1784, name: 'Agents' });
    dbAll.mockResolvedValueOnce(rows);
    const res = await dataToolHandlers.query_table_data({ table_id: 1784, fields: ['name'] });
    expect(res.rows[0]).toEqual({ id: 11, name: 'Bot', created_at: 'T1' });
    expect(res.rows[1]).toEqual({ id: 12, name: 'Ann', created_at: 'T2' });
    expect(res.rows[0]).not.toHaveProperty('main_instructions');
    expect(res.unknown_fields).toEqual([]);
  });

  it('unknown field names are ignored and deduped into unknown_fields[]', async () => {
    dbGet.mockResolvedValueOnce({ id: 1784, name: 'Agents' });
    dbAll.mockResolvedValueOnce(rows);
    const res = await dataToolHandlers.query_table_data({ table_id: 1784, fields: ['name', 'ghost'] });
    expect(res.rows[0]).toEqual({ id: 11, name: 'Bot', created_at: 'T1' });
    expect(res.unknown_fields).toEqual(['ghost']); // one entry despite two rows
  });
});

describe('get_table_row — field projection (T3, nested row.data container)', () => {
  const table = { id: 1784, name: 'Agents' };
  const row = {
    id: 11, base_id: 'B1', table_id: 1784,
    data: { name: 'Bot', role: 'dev', main_instructions: 'long…' },
    created_by: 1, created_at: 'T1', updated_at: 'T2',
  };
  const columns = [{ id: 1, column_name: 'name', display_name: 'Name', type: 'text' }];

  it('omitted fields → full row.data, no unknown_fields key', async () => {
    dbGet.mockResolvedValueOnce(table).mockResolvedValueOnce(row);
    dbAll.mockResolvedValueOnce(columns);
    const res = await dataToolHandlers.get_table_row({ table_id: 1784, row_id: 11 });
    expect(res.row.data).toEqual({ name: 'Bot', role: 'dev', main_instructions: 'long…' });
    expect(res).not.toHaveProperty('unknown_fields');
  });

  it('fields → projects row.data; structural siblings always kept', async () => {
    dbGet.mockResolvedValueOnce(table).mockResolvedValueOnce(row);
    dbAll.mockResolvedValueOnce(columns);
    const res = await dataToolHandlers.get_table_row({ table_id: 1784, row_id: 11, fields: ['name', 'missing'] });
    expect(res.row.data).toEqual({ name: 'Bot' }); // only the projected column
    // structural keys survive regardless of the allow-list
    expect(res.row.id).toBe(11);
    expect(res.row.base_id).toBe('B1');
    expect(res.row.table_id).toBe(1784);
    expect(res.row.created_by).toBe(1);
    expect(res.row.created_at).toBe('T1');
    expect(res.row.updated_at).toBe('T2');
    expect(res.unknown_fields).toEqual(['missing']);
  });
});
