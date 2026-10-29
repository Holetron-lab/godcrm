// @vitest-environment node
/**
 * MCP mutation handlers must fire automation triggers — parity with the v3 HTTP routes.
 *
 * Root cause this guards: the "Blog → public mirror on publish" automation
 * (3720/177443) is a row_update trigger gated on Status==published. It used to fire
 * ONLY through the CRM UI / v3 API PUT route, never through MCP update_table_row — so an
 * agent flipping Status via MCP wrote nothing to the public mirror. These tests pin that
 * the MCP handlers now call fireRowCreate/UpdateTriggers exactly like their HTTP twins.
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

vi.mock('../../../utils/baseId.js', () => ({
  generateBaseId: () => 'BASEID01',
}));

vi.mock('../../SelectValueResolver.js', () => ({
  resolveSelectValues: vi.fn(async (_tableId, data) => ({ resolvedData: data, errors: [], rejections: [] })),
  validateAllColumns: vi.fn(async () => ({ errors: [], rejections: [] })),
}));
// QA-20816-01 schema guard is DB-backed (row-unknown-keys.test.js); pass-through here.
vi.mock('../../row-schema-guard.js', () => ({
  guardRowKeys: vi.fn(async (_tableId, data) => ({ data, unknown: [] })),
  unknownKeysMessage: (u) => `Unknown columns: ${u.join(', ')}`,
}));

vi.mock('../../atoms-archive.js', () => ({
  applyAtomVersioning: vi.fn(async ({ newData }) => newData),
  isAtomsV2Table: () => false,
}));

vi.mock('../coerceDataInput.js', () => ({
  coerceDataObject: (data) => data,
}));

const fireRowCreateTriggers = vi.fn(() => Promise.resolve());
const fireRowUpdateTriggers = vi.fn(() => Promise.resolve());

vi.mock('../../AutomationTriggerService.js', () => ({
  fireRowCreateTriggers: (...a) => fireRowCreateTriggers(...a),
  fireRowUpdateTriggers: (...a) => fireRowUpdateTriggers(...a),
}));

const { dataToolHandlers } = await import('../data-tools.js');

beforeEach(() => {
  dbGet.mockReset();
  dbRun.mockReset();
  dbAll.mockReset();
  dbAll.mockResolvedValue([]);
  fireRowCreateTriggers.mockClear();
  fireRowUpdateTriggers.mockClear();
});

describe('update_table_row fires row_update automations', () => {
  it('calls fireRowUpdateTriggers with merged new data + old data on Status flip', async () => {
    dbGet.mockResolvedValueOnce({ id: 180638, table_id: 100244, data: { Title: 'Post', Status: 'draft' } });
    dbRun.mockResolvedValueOnce({});

    const res = await dataToolHandlers.update_table_row(
      { table_id: 100244, row_id: 180638, data: { Status: 'published' } },
      1
    );

    expect(res.success).toBe(true);
    expect(fireRowUpdateTriggers).toHaveBeenCalledTimes(1);
    const [tableId, rowId, newData, oldData] = fireRowUpdateTriggers.mock.calls[0];
    expect(tableId).toBe(100244);
    expect(rowId).toBe(180638);
    expect(newData).toMatchObject({ Title: 'Post', Status: 'published' }); // merged
    expect(oldData).toMatchObject({ Status: 'draft' });                    // pre-update
  });

  it('does NOT fire when the row is missing (no write happened)', async () => {
    dbGet.mockResolvedValueOnce(undefined);

    const res = await dataToolHandlers.update_table_row(
      { table_id: 100244, row_id: 999, data: { Status: 'published' } },
      1
    );

    expect(res.error).toBeTruthy();
    expect(fireRowUpdateTriggers).not.toHaveBeenCalled();
  });

  it('a throw inside the trigger does not break the update (non-blocking)', async () => {
    dbGet.mockResolvedValueOnce({ id: 1, table_id: 100244, data: { Status: 'draft' } });
    dbRun.mockResolvedValueOnce({});
    fireRowUpdateTriggers.mockImplementationOnce(() => Promise.reject(new Error('boom')));

    const res = await dataToolHandlers.update_table_row(
      { table_id: 100244, row_id: 1, data: { Status: 'published' } },
      1
    );

    expect(res.success).toBe(true); // update returns regardless of trigger outcome
  });
});

describe('add_table_row fires row_create automations', () => {
  it('calls fireRowCreateTriggers with the new row id + inserted data', async () => {
    dbRun.mockResolvedValueOnce({ lastInsertRowid: 5001 });

    const res = await dataToolHandlers.add_table_row(
      { table_id: 100245, data: { Title: 'Mirror', Status: 'published' } },
      1
    );

    expect(res.success).toBe(true);
    expect(res.row_id).toBe(5001);
    expect(fireRowCreateTriggers).toHaveBeenCalledTimes(1);
    const [tableId, rowId, data] = fireRowCreateTriggers.mock.calls[0];
    expect(tableId).toBe(100245);
    expect(rowId).toBe(5001);
    expect(data).toMatchObject({ Title: 'Mirror', Status: 'published' });
  });
});

describe('batch_update_rows fires row_update automations per row', () => {
  it('fires once per successfully updated row with that row’s old/new data', async () => {
    dbGet
      .mockResolvedValueOnce({ id: 100245 })                                   // table existence check
      .mockResolvedValueOnce({ data: { Status: 'draft' } })                    // row 1 old
      .mockResolvedValueOnce({ data: { Status: 'draft' } });                   // row 2 old
    dbRun.mockResolvedValue({});

    const res = await dataToolHandlers.batch_update_rows(
      {
        table_id: 100244,
        updates: [
          { row_id: 11, data: { Status: 'published' } },
          { row_id: 22, data: { Status: 'published' } },
        ],
      },
      1
    );

    expect(res.success).toEqual([11, 22]);
    expect(fireRowUpdateTriggers).toHaveBeenCalledTimes(2);
    expect(fireRowUpdateTriggers.mock.calls[0][1]).toBe(11);
    expect(fireRowUpdateTriggers.mock.calls[1][1]).toBe(22);
  });
});
