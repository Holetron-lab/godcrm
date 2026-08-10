// Plan B (GERATRON 2026-07-20) — module tables are provisioned at module-creation
// time, English-keyed by default (documents-module style), returning a table mapping.
// This is the reusable primitive that makes the SC-SIM 8-table rename migration (078)
// a non-event: a module never hand-creates Cyrillic-keyed tables again.
//
// Unit test — mocks the DB (matches agent-table-resolver.test.js convention).

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockDbRun = vi.fn();
const mockDbGet = vi.fn();
const mockWithTransactionAsync = vi.fn();

vi.mock('../../database/connection.js', () => ({
  dbRun: (...a) => mockDbRun(...a),
  dbGet: (...a) => mockDbGet(...a),
  sqlNow: () => 'NOW()',
  withTransactionAsync: (...a) => mockWithTransactionAsync(...a),
}));

vi.mock('../../utils/logger.js', () => ({
  apiLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { provisionModuleTables, seedModuleRows } = await import('../ModuleTableProvisioner.js');

const BLUEPRINT = {
  key: 'sample',
  tables: [
    {
      key: 'schemes',
      name: 'sim_schemes',
      display_name: 'Схемы симуляций',
      icon: '🗺️',
      table_type: 'sim_schemes',
      columns: [
        { column_name: 'name', display_name: 'Название', type: 'text' },
        { column_name: 'graph_json', display_name: 'Граф', type: 'json' },
      ],
    },
  ],
};

beforeEach(() => {
  mockDbRun.mockReset();
  mockDbGet.mockReset();
  mockWithTransactionAsync.mockReset();
});

// An in-memory table_rows backing store so seedModuleRows' idempotency (natural-key
// dedup across calls) can be exercised for real, not just asserted on mock call counts.
function installFakeTransaction() {
  const store = []; // { table_id, base_id, data (JSON string), created_by }
  mockWithTransactionAsync.mockImplementation(async (cb) => {
    let seq = 1000;
    const trx = {
      all: async (sql, params) => {
        if (/SELECT data FROM table_rows WHERE table_id = \?/i.test(sql)) {
          const [tableId] = params;
          return store.filter((r) => r.table_id === tableId).map((r) => ({ data: r.data }));
        }
        return [];
      },
      run: async (sql, params) => {
        if (/^\s*INSERT INTO table_rows/i.test(sql)) {
          const [table_id, base_id, data, created_by] = params;
          store.push({ table_id, base_id, data, created_by });
          return { lastInsertRowid: ++seq, changes: 1 };
        }
        return { changes: 0 };
      },
    };
    return cb(trx);
  });
  return store;
}

describe('provisionModuleTables', () => {
  it('creates a new table with English-keyed columns and returns the mapping', async () => {
    mockDbGet.mockResolvedValue(undefined); // nothing exists yet
    let seq = 100;
    mockDbRun.mockImplementation(() => Promise.resolve({ lastInsertRowid: ++seq }));

    const mapping = await provisionModuleTables(7814, BLUEPRINT, { userId: 1 });

    // table row created
    expect(mapping.schemes).toBeDefined();
    expect(mapping.schemes.table_id).toBe(101);
    expect(mapping.schemes.name).toBe('sim_schemes');
    expect(mapping.schemes.created).toBe(true);

    // English-keyed columns returned in the mapping
    expect(mapping.schemes.columns.map(c => c.column_name)).toEqual(['name', 'graph_json']);

    // one INSERT for the table + one per column
    const inserts = mockDbRun.mock.calls.map(c => String(c[0]));
    expect(inserts.filter(s => /INSERT INTO universal_tables/i.test(s))).toHaveLength(1);
    expect(inserts.filter(s => /INSERT INTO table_columns/i.test(s))).toHaveLength(2);
  });

  it('is idempotent — reuses an existing table by (project_id, name), no re-insert', async () => {
    mockDbGet.mockResolvedValue({ id: 555 }); // table already exists
    mockDbRun.mockResolvedValue({ lastInsertRowid: 999 });

    const mapping = await provisionModuleTables(7814, BLUEPRINT, { userId: 1 });

    expect(mapping.schemes.table_id).toBe(555);
    expect(mapping.schemes.created).toBe(false);
    // no table or column inserts happened
    expect(mockDbRun).not.toHaveBeenCalled();
  });

  it('rejects a non-ASCII (Cyrillic) column_name — enforces English-by-default', async () => {
    mockDbGet.mockResolvedValue(undefined);
    mockDbRun.mockResolvedValue({ lastInsertRowid: 1 });

    const bad = {
      key: 'bad',
      tables: [{
        key: 't', name: 'sim_bad', display_name: 'Bad',
        columns: [{ column_name: 'персонал', display_name: 'Персонал', type: 'number' }],
      }],
    };

    await expect(provisionModuleTables(7814, bad, { userId: 1 }))
      .rejects.toThrow(/column_name/i);
  });
});

const SEED_BLUEPRINT = {
  key: 'my_module',
  tables: BLUEPRINT.tables,
  seed: [
    {
      table: 'schemes',
      key: ['name'],
      rows: [
        { name: 'Demo scheme A', graph_json: { nodes: [] } },
        { name: 'Demo scheme B', graph_json: { nodes: [1] } },
      ],
    },
  ],
};

// mapping as provisionModuleTables would return it
const MAPPING = { schemes: { table_id: 101, name: 'sim_schemes', created: true, columns: [] } };

describe('seedModuleRows', () => {
  it('inserts declared demo rows into the universal table_rows layer and returns counts', async () => {
    const store = installFakeTransaction();

    const counts = await seedModuleRows(MAPPING, SEED_BLUEPRINT, { userId: 7 });

    expect(counts.schemes).toEqual({ seeded: 2, reused: 0 });
    expect(store).toHaveLength(2);
    // rows landed in the (table_id, base_id, JSON data, created_by) shape
    expect(store[0].table_id).toBe(101);
    expect(store[0].base_id).toEqual(expect.any(String));
    expect(store[0].created_by).toBe(7);
    expect(JSON.parse(store[0].data)).toEqual({ name: 'Demo scheme A', graph_json: { nodes: [] } });
  });

  it('is idempotent by natural key — seeding twice inserts nothing the second time', async () => {
    const store = installFakeTransaction();

    const first = await seedModuleRows(MAPPING, SEED_BLUEPRINT, { userId: 7 });
    expect(first.schemes).toEqual({ seeded: 2, reused: 0 });
    expect(store).toHaveLength(2);

    const second = await seedModuleRows(MAPPING, SEED_BLUEPRINT, { userId: 7 });
    expect(second.schemes).toEqual({ seeded: 0, reused: 2 });
    expect(store).toHaveLength(2); // no duplicates
  });

  it('dedups duplicate rows within a single seed batch', async () => {
    const store = installFakeTransaction();
    const dupBlueprint = {
      key: 'my_module',
      seed: [{
        table: 'schemes',
        key: ['name'],
        rows: [
          { name: 'Only once', graph_json: {} },
          { name: 'Only once', graph_json: { changed: true } }, // same natural key
        ],
      }],
    };

    const counts = await seedModuleRows(MAPPING, dupBlueprint, { userId: 1 });

    expect(counts.schemes).toEqual({ seeded: 1, reused: 1 });
    expect(store).toHaveLength(1);
  });

  it('is a no-op when the blueprint declares no seed section', async () => {
    installFakeTransaction();
    const counts = await seedModuleRows(MAPPING, BLUEPRINT, { userId: 1 });
    expect(counts).toEqual({});
    expect(mockWithTransactionAsync).not.toHaveBeenCalled();
  });

  it('rejects a seed group targeting a table absent from the mapping', async () => {
    installFakeTransaction();
    const bad = { key: 'x', seed: [{ table: 'ghost', key: ['name'], rows: [{ name: 'a' }] }] };
    await expect(seedModuleRows(MAPPING, bad, { userId: 1 }))
      .rejects.toThrow(/not in the provisioned mapping/i);
  });

  it('rejects a seed group with no natural key (idempotency would be undefined)', async () => {
    installFakeTransaction();
    const bad = { key: 'x', seed: [{ table: 'schemes', rows: [{ name: 'a' }] }] };
    await expect(seedModuleRows(MAPPING, bad, { userId: 1 }))
      .rejects.toThrow(/non-empty `key`/i);
  });

  it('rejects a seed row missing one of its natural-key columns', async () => {
    installFakeTransaction();
    const bad = {
      key: 'x',
      seed: [{ table: 'schemes', key: ['name'], rows: [{ graph_json: {} }] }],
    };
    await expect(seedModuleRows(MAPPING, bad, { userId: 1 }))
      .rejects.toThrow(/missing natural-key column/i);
  });

  it('composes inside a caller-supplied trx (atomic provision+seed) without opening its own', async () => {
    // A bare in-memory trx handle — the caller (e.g. an install trigger inside its own
    // withTransactionAsync) hands this to seedModuleRows so provision+seed are one transaction.
    const store = [];
    let seq = 2000;
    const trx = {
      all: async (sql, params) =>
        /SELECT data FROM table_rows WHERE table_id = \?/i.test(sql)
          ? store.filter((r) => r.table_id === params[0]).map((r) => ({ data: r.data }))
          : [],
      run: async (sql, params) => {
        if (/^\s*INSERT INTO table_rows/i.test(sql)) {
          const [table_id, base_id, data, created_by] = params;
          store.push({ table_id, base_id, data, created_by });
          return { lastInsertRowid: ++seq, changes: 1 };
        }
        return { changes: 0 };
      },
    };

    const counts = await seedModuleRows(MAPPING, SEED_BLUEPRINT, { userId: 9, trx });

    expect(counts.schemes).toEqual({ seeded: 2, reused: 0 });
    expect(store).toHaveLength(2);
    // the whole point: it used the caller's trx, it did NOT open its own transaction
    expect(mockWithTransactionAsync).not.toHaveBeenCalled();

    // idempotency holds across a second call sharing the same trx/store
    const second = await seedModuleRows(MAPPING, SEED_BLUEPRINT, { userId: 9, trx });
    expect(second.schemes).toEqual({ seeded: 0, reused: 2 });
    expect(store).toHaveLength(2);
  });
});
