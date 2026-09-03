// @vitest-environment node
/**
 * ADR-182 — Lean write-responses for agent MCP tools.
 *
 * T1  update_table_row returns a minimal digest by default; full row on response:"full";
 *     head preview on include_head:true.
 * T1b batch_update_rows accepts the same opt-in response param.
 * T2  upsert_section replaces an existing marked section in place, appends when absent,
 *     and is byte-idempotent on re-run (the assertion that replaces Smith's manual SHA check).
 *
 * DB is fully mocked (ADR-0009: no combat master touched).
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

vi.mock('../../AutomationTriggerService.js', () => ({
  fireRowCreateTriggers: vi.fn(() => Promise.resolve()),
  fireRowUpdateTriggers: vi.fn(() => Promise.resolve()),
}));

const { dataToolHandlers, buildWriteDigest, upsertMarkedSection } =
  await import('../data-tools.js');

/** Captures the JSON written by the handler so a follow-up call can read it back. */
function lastWrittenData() {
  const call = dbRun.mock.calls.at(-1);
  return JSON.parse(call[1][0]);
}

beforeEach(() => {
  dbGet.mockReset();
  dbRun.mockReset();
  dbAll.mockReset();
  dbRun.mockResolvedValue({});
});

// ─────────────────────────── Pure helpers ───────────────────────────
describe('buildWriteDigest', () => {
  it('reports changed[], byte length, and a ~120-char tail per field', () => {
    const long = 'x'.repeat(500);
    const d = buildWriteDigest(['a', 'b'], { a: long, b: 'short' });
    expect(d.changed).toEqual(['a', 'b']);
    expect(d.bytes.a).toBe(500);
    expect(d.bytes.b).toBe(5);
    expect(d.tail.a).toBe('…' + 'x'.repeat(120));
    expect(d.tail.b).toBe('short');       // short value not truncated, no ellipsis
    expect(d.head).toBeUndefined();
  });

  it('adds a head preview only when includeHead is set', () => {
    const long = 'abcdefgh'.repeat(50); // 400 chars
    const d = buildWriteDigest(['a'], { a: long }, { includeHead: true });
    expect(d.head.a.startsWith('abcdefgh')).toBe(true);
    expect(d.head.a.endsWith('…')).toBe(true);
    expect(d.head.a.length).toBe(121);
  });

  it('counts UTF-8 bytes, not code points', () => {
    const d = buildWriteDigest(['a'], { a: '⚙️' }); // multibyte
    expect(d.bytes.a).toBe(Buffer.byteLength('⚙️', 'utf8'));
    expect(d.bytes.a).toBeGreaterThan(2);
  });

  it('stringifies non-string values through the digest', () => {
    const d = buildWriteDigest(['n', 'z', 'o'], { n: 42, z: null, o: { x: 1 } });
    expect(d.tail.n).toBe('42');
    expect(d.tail.z).toBe('');
    expect(d.tail.o).toBe('{"x":1}');
  });
});

describe('upsertMarkedSection', () => {
  const MARKER = '## ⚙️ Friction footer';
  const SECTION = `${MARKER}\n- something happened`;

  it('appends when the marker is absent', () => {
    const out = upsertMarkedSection('# Title\n\nbody', MARKER, SECTION);
    expect(out).toBe('# Title\n\nbody\n\n' + SECTION);
  });

  it('returns just the section when the field is empty', () => {
    expect(upsertMarkedSection('', MARKER, SECTION)).toBe(SECTION);
    expect(upsertMarkedSection(null, MARKER, SECTION)).toBe(SECTION);
  });

  it('replaces an existing section in place, preserving surrounding content', () => {
    const original = `# Title\n\nbody\n\n${MARKER}\n- OLD line\n\n## Next\n\ntail`;
    const out = upsertMarkedSection(original, MARKER, SECTION);
    expect(out).toBe(`# Title\n\nbody\n\n${SECTION}\n\n## Next\n\ntail`);
    // exactly one marker survives
    expect(out.match(/⚙️ Friction footer/g)).toHaveLength(1);
  });

  it('is byte-idempotent: append then replace yields identical bytes on re-run', () => {
    const base = '# Agent prompt\n\ncore instructions';
    const once = upsertMarkedSection(base, MARKER, SECTION);
    const twice = upsertMarkedSection(once, MARKER, SECTION);
    expect(twice).toBe(once); // the assertion that replaces the manual SHA-256 check
    expect(twice.match(/⚙️ Friction footer/g)).toHaveLength(1);
  });

  it('line-anchors the marker (ignores a mid-paragraph occurrence)', () => {
    const original = `talking about ${MARKER} inline\n\nreal body`;
    const out = upsertMarkedSection(original, MARKER, SECTION);
    // marker only appeared mid-line → treated as absent → appended
    expect(out).toBe(`talking about ${MARKER} inline\n\nreal body\n\n${SECTION}`);
  });
});

// ─────────────────────────── Handler: update_table_row ───────────────────────────
describe('update_table_row (T1)', () => {
  const long = 'y'.repeat(300);

  beforeEach(() => {
    dbGet.mockResolvedValue({ id: 5, table_id: 1784, data: { main_instructions: 'old', name: 'A' } });
  });

  it('returns a lean digest by default (no full row echo)', async () => {
    const res = await dataToolHandlers.update_table_row(
      { table_id: 1784, row_id: 5, data: { main_instructions: long } }, 1);
    expect(res.success).toBe(true);
    expect(res.data).toBeUndefined();               // no fat echo
    expect(res.changed).toEqual(['main_instructions']);
    expect(res.bytes.main_instructions).toBe(300);
    expect(res.tail.main_instructions).toBe('…' + 'y'.repeat(120));
    expect(res.head).toBeUndefined();
  });

  it('returns the full merged row on response:"full"', async () => {
    const res = await dataToolHandlers.update_table_row(
      { table_id: 1784, row_id: 5, data: { main_instructions: 'new' }, response: 'full' }, 1);
    expect(res.data).toEqual({ main_instructions: 'new', name: 'A' });
    expect(res.changed).toBeUndefined();
  });

  it('adds a head preview on include_head:true', async () => {
    const res = await dataToolHandlers.update_table_row(
      { table_id: 1784, row_id: 5, data: { main_instructions: long }, include_head: true }, 1);
    expect(res.head.main_instructions.startsWith('y')).toBe(true);
    expect(res.head.main_instructions.endsWith('…')).toBe(true);
  });
});

// ─────────────────────────── Handler: batch_update_rows (T1b) ───────────────────────────
describe('batch_update_rows (T1b)', () => {
  beforeEach(() => {
    dbGet.mockImplementation(async (sql) => {
      if (/universal_tables/.test(sql)) return { id: 1784 };
      return { data: { name: 'X' } };
    });
  });

  it('is lean by default (success = row ids)', async () => {
    const res = await dataToolHandlers.batch_update_rows(
      { table_id: 1784, updates: [{ row_id: 1, data: { name: 'A' } }] }, 1);
    expect(res.success).toEqual([1]);
  });

  it('returns merged rows on response:"full"', async () => {
    const res = await dataToolHandlers.batch_update_rows(
      { table_id: 1784, updates: [{ row_id: 1, data: { name: 'A' } }], response: 'full' }, 1);
    expect(res.success).toEqual([{ row_id: 1, data: { name: 'A' } }]);
  });
});

// ─────────────────────────── Handler: upsert_section (T2) ───────────────────────────
describe('upsert_section (T2)', () => {
  const MARKER = '## ⚙️ Friction footer';
  const SECTION = `${MARKER}\n- friction note`;

  it('appends the section when absent and returns a digest (not the field)', async () => {
    dbGet.mockResolvedValue({ id: 5, table_id: 1784, data: { main_instructions: 'core prompt' } });
    const res = await dataToolHandlers.upsert_section(
      { table_id: 1784, row_id: 5, field: 'main_instructions', marker: MARKER, content: SECTION }, 1);
    expect(res.success).toBe(true);
    expect(res.changed).toEqual(['main_instructions']);
    expect(res.main_instructions).toBeUndefined(); // never echoes the whole field
    expect(lastWrittenData().main_instructions).toBe('core prompt\n\n' + SECTION);
  });

  it('replaces an existing section in place', async () => {
    const existing = `core\n\n${MARKER}\n- OLD`;
    dbGet.mockResolvedValue({ id: 5, table_id: 1784, data: { main_instructions: existing } });
    await dataToolHandlers.upsert_section(
      { table_id: 1784, row_id: 5, field: 'main_instructions', marker: MARKER, content: SECTION }, 1);
    expect(lastWrittenData().main_instructions).toBe('core\n\n' + SECTION);
  });

  it('is byte-idempotent across a double run (replaces manual SHA-256 verification)', async () => {
    let stored = 'core prompt';
    dbGet.mockImplementation(async () => ({ id: 5, table_id: 1784, data: { main_instructions: stored } }));

    await dataToolHandlers.upsert_section(
      { table_id: 1784, row_id: 5, field: 'main_instructions', marker: MARKER, content: SECTION }, 1);
    const afterFirst = lastWrittenData().main_instructions;
    stored = afterFirst; // persist for the second run

    await dataToolHandlers.upsert_section(
      { table_id: 1784, row_id: 5, field: 'main_instructions', marker: MARKER, content: SECTION }, 1);
    const afterSecond = lastWrittenData().main_instructions;

    expect(afterSecond).toBe(afterFirst);
    expect(afterSecond.match(/⚙️ Friction footer/g)).toHaveLength(1);
  });

  it('rejects content that does not begin with the marker (idempotency guard)', async () => {
    dbGet.mockResolvedValue({ id: 5, table_id: 1784, data: { main_instructions: 'core' } });
    const res = await dataToolHandlers.upsert_section(
      { table_id: 1784, row_id: 5, field: 'main_instructions', marker: MARKER, content: 'no marker here' }, 1);
    expect(res.error).toMatch(/must begin with the marker/);
    expect(dbRun).not.toHaveBeenCalled();
  });

  it('validates required args and text-field type', async () => {
    expect((await dataToolHandlers.upsert_section({ table_id: 1, row_id: 5, marker: MARKER, content: SECTION }, 1)).error)
      .toMatch(/field is required/);
    dbGet.mockResolvedValue({ id: 5, table_id: 1784, data: { main_instructions: { not: 'text' } } });
    expect((await dataToolHandlers.upsert_section(
      { table_id: 1784, row_id: 5, field: 'main_instructions', marker: MARKER, content: SECTION }, 1)).error)
      .toMatch(/non-text value/);
  });
});
