// @vitest-environment node
// Agent table creation: validated keys and atomic sidebar registration.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const transaction = vi.fn();
const createWidget = vi.fn();
vi.mock('../../WidgetService.js', () => ({ createWidget: (...a) => createWidget(...a) }));
const dbGet = vi.fn();
const dbRun = vi.fn();
const dbAll = vi.fn();

vi.mock('../../../database/connection.js', () => ({
  dbGet: (...a) => dbGet(...a),
  dbRun: (...a) => dbRun(...a),
  dbAll: (...a) => dbAll(...a),
  isPostgres: () => true,
  sqlNow: () => 'NOW()',
  toBool: (v) => v ? 1 : 0,
  withTransactionAsync: (...a) => transaction(...a),
}));

vi.mock('../../../utils/baseId.js', () => ({
  generateBaseId: () => 'BASEID01',
}));

vi.mock('../../SelectValueResolver.js', () => ({
  resolveSelectValues: vi.fn(async (_tableId, data) => ({ resolvedData: data, errors: [], rejections: [] })),
  validateAllColumns: vi.fn(async () => ({ errors: [], rejections: [] })),
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
  fireRowCreateTriggers.mockClear();
  fireRowUpdateTriggers.mockClear();
});


describe('create_table key validation', () => {
  it.each(['Тикеты', 'my tickets', 'tickets\n', '', 123, null])('rejects invalid key %j before writing', async (name) => {
    dbRun.mockResolvedValue({ lastInsertRowid: 123 });
    await expect(dataToolHandlers.create_table({ project_id: 1, name, columns: [] }, 1)).rejects.toThrow();
    expect(dbRun).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});


describe('create_table sidebar widget', () => {
  let committed;
  beforeEach(() => {
    committed = [];
    transaction.mockReset();
    createWidget.mockReset();
    dbRun.mockResolvedValue({ lastInsertRowid: 21 });
    transaction.mockImplementation(async (fn) => {
      const staged = [];
      const trx = {
        run: vi.fn(async (sql, params) => { staged.push({ sql, params }); return { lastInsertRowid: 21 }; }),
        get: vi.fn(async () => ({ id: 31 })),
      };
      createWidget.mockImplementation(async (data, opts) => {
        expect(opts.trx).toBe(trx);
        staged.push({ widget: data });
        return { id: 41 };
      });
      const result = await fn(trx);
      committed.push(...staged);
      return result;
    });
  });

  it('creates the menu widget and localized table title in the same transaction by default', async () => {
    const result = await dataToolHandlers.create_table({ project_id: 1, name: 'tickets', display_name: 'Тикеты', columns: [{ name: 'title' }] }, 42);
    expect(result).toMatchObject({ table_id: 21, widget_id: 41 });
    expect(createWidget).toHaveBeenCalledWith(expect.objectContaining({
      dashboard_id: 31, preset_name: 'table_view', title: 'Тикеты', config: { table_id: 21 }, created_by: 42,
    }), expect.anything());
    expect(committed.filter(x => x.sql?.includes('INSERT INTO table_columns'))).toHaveLength(1);
    expect(dbRun).not.toHaveBeenCalled();
  });

  it('allows an explicitly hidden table without a widget', async () => {
    await dataToolHandlers.create_table({ project_id: 1, name: 'internal', show_in_nav: false, columns: [] }, 42);
    expect(transaction).toHaveBeenCalledOnce();
    expect(createWidget).not.toHaveBeenCalled();
    expect(committed[0].params[4]).toBe(0);
  });

  it('rolls back table and columns when widget creation fails', async () => {
    transaction.mockImplementationOnce(async (fn) => {
      const staged = [];
      createWidget.mockRejectedValueOnce(new Error('widget failure'));
      const result = await fn({
        get: async () => ({ id: 31 }),
        run: async (sql) => { staged.push(sql); return { lastInsertRowid: 21 }; },
      });
      committed.push(...staged);
      return result;
    });
    await expect(dataToolHandlers.create_table({ project_id: 1, name: 'tickets', columns: [{ name: 'title' }] }, 42)).rejects.toThrow('widget failure');
    expect(committed).toEqual([]);
    expect(dbRun).not.toHaveBeenCalled();
  });
});


it('creates a default dashboard when the project has none', async () => {
  const run = vi.fn(async () => ({ lastInsertRowid: 21 }));
  const get = vi.fn().mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce(null);
  transaction.mockImplementationOnce(fn => fn({ run, get }));
  createWidget.mockResolvedValueOnce({ id: 41 });
  const result = await dataToolHandlers.create_table({ project_id: 1, name: 'tickets', columns: [] }, 42);
  expect(run.mock.calls.some(([sql]) => sql.includes('INSERT INTO dashboards'))).toBe(true);
  expect(result.widget_id).toBe(41);
});

it('does not create a widget or commit when a column insert fails', async () => {
  createWidget.mockClear();
  const run = vi.fn().mockResolvedValueOnce({ lastInsertRowid: 21 }).mockRejectedValueOnce(new Error('column failure'));
  transaction.mockImplementationOnce(fn => fn({ run, get: async () => ({ id: 1 }) }));
  await expect(dataToolHandlers.create_table({ project_id: 1, name: 'tickets', columns: [{ name: 'title' }] }, 42)).rejects.toThrow('column failure');
  expect(createWidget).not.toHaveBeenCalled();
});
