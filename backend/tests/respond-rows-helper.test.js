// ADR-205 D2/AC1 — respondRows: without `include=relations` the payload passes through
// untouched (same object, no extra keys, resolver never called); with it, the lens map is
// attached as sibling fields.
import { describe, test, expect, vi, beforeEach } from 'vitest';

const attachRelationLens = vi.fn();
vi.mock('../services/RelationLensResolver.js', () => ({ attachRelationLens }));
vi.mock('../database/connection.js', () => ({ dbGet: vi.fn(), dbAll: vi.fn(), dbRun: vi.fn(), safeJsonParse: (v) => v }));
vi.mock('../services/SpaceService.js', () => ({ getUserAccessData: vi.fn(), checkUserAccessViaTableV2: vi.fn() }));
vi.mock('../services/EffectiveRoleService.js', () => ({ getEffectiveRole: vi.fn(), ACCESS_LEVEL_VALUES: {} }));

const { respondRows, wantsRelations } = await import('../routes/v3/tables/helpers.js');

function fakeRes() {
  const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
  return res;
}

beforeEach(() => attachRelationLens.mockReset());

describe('wantsRelations', () => {
  test.each([
    [undefined, false], ['', false], ['relations', true], ['meta,relations', true], ['relation', false], [['x', 'relations'], true],
  ])('%j → %s', (include, expected) => {
    expect(wantsRelations(include)).toBe(expected);
  });
});

describe('respondRows', () => {
  test('no include: same payload object, resolver not called', async () => {
    const res = fakeRes();
    const payload = { rows: [{ id: 1, data: { a: 1 } }], pagination: { page: 1 } };
    await respondRows(res, payload, { tableId: 5, include: undefined });
    expect(attachRelationLens).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data).toBe(payload);
    expect(Object.keys(payload)).toEqual(['rows', 'pagination']);
  });

  test('include=relations on a list: relations + relations_meta attached next to rows', async () => {
    const res = fakeRes();
    attachRelationLens.mockResolvedValue({ relations: { c: { 1: { value: 'x', label: 'x' } } }, relations_meta: { c: { resolved: 1, missing: 0, truncated: false } } });
    const rows = [{ id: 1, data: { c: 1 } }];
    const user = { id: 9 };
    await respondRows(res, { rows, pagination: { page: 1 } }, { tableId: 5, include: 'relations', user });
    expect(attachRelationLens).toHaveBeenCalledWith({ tableId: 5, rows, user });
    const sent = res.json.mock.calls[0][0].data;
    expect(sent.rows).toBe(rows);
    expect(sent.relations.c['1'].value).toBe('x');
    expect(sent.relations_meta.c.resolved).toBe(1);
  });

  test('include=relations on a single row: resolver sees [row]', async () => {
    const res = fakeRes();
    attachRelationLens.mockResolvedValue({ relations: {}, relations_meta: {} });
    const row = { id: 1, data: { c: 1 } };
    await respondRows(res, { row, columns: [] }, { tableId: 5, include: 'relations' });
    expect(attachRelationLens).toHaveBeenCalledWith({ tableId: 5, rows: [row], user: undefined });
    expect(res.json.mock.calls[0][0].data).toMatchObject({ row, columns: [], relations: {}, relations_meta: {} });
  });
});
