// ADR-205 D3 — RelationLensResolver unit tests (3 storages × single/multi × missing/truncated).
// connection.js, data-source crud and queries are mocked: the resolver is pure routing +
// mapping over whatever the storage returns.
import { describe, test, expect, vi, beforeEach } from 'vitest';

const dbAll = vi.fn();
const dbGet = vi.fn();
vi.mock('../database/connection.js', () => ({
  dbAll, dbGet, dbRun: vi.fn(),
  safeJsonParse: (v, d = null) => { if (v == null) return d; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return d; } },
}));

const queryRowsByKeys = vi.fn();
vi.mock('../services/data-source/queries.js', () => ({ queryRowsByKeys }));

const { attachRelationLens, splitRelationValue, MAX_KEYS_PER_COLUMN } =
  await import('../services/RelationLensResolver.js');

const relation = (over = {}) => ({ enabled: true, tableId: '77', valueColumn: 'id', labelColumn: 'name', ...over });
const column = (name, rel, id = 5) => ({ id, column_name: name, type: 'text', config: JSON.stringify({ relation: rel }) });
const localTable = { id: 77, data_source_id: null, source_table_name: null, source_id_column: null, is_system: false, sync_target: null, project_id: 1 };

// dbAll is mocked below the `?`→`$n` conversion, so SQL arrives with `?` placeholders.
const PARENT_COLUMNS = /SELECT id, column_name, config FROM table_columns WHERE table_id = \?$/;
const RELATED_COLUMNS = /SELECT id, column_name FROM table_columns WHERE table_id = \?$/;

beforeEach(() => {
  dbAll.mockReset(); dbGet.mockReset(); queryRowsByKeys.mockReset();
});

describe('splitRelationValue — backend mirror of the frontend parser', () => {
  test.each([
    [null, 'json', []],
    ['', 'comma', []],
    ['[1, "b"]', 'json', ['1', 'b']],
    ['[1,2]', 'comma', ['1', '2']],           // JSON array wins regardless of format
    ['a, b,,c', 'comma', ['a', 'b', 'c']],
    ['a;b', 'semicolon', ['a', 'b']],
    ['a\nb', 'newline', ['a', 'b']],
    ['a,b', 'single', ['a,b']],
    ['a,b', 'json', ['a', 'b']],              // auto-detect
    ['a;b', undefined, ['a', 'b']],
    ['solo', undefined, ['solo']],
    [[3, 4], 'json', ['3', '4']],             // jsonb already parsed to an array
    [42, undefined, ['42']],
  ])('%j / %s → %j', (value, format, expected) => {
    expect(splitRelationValue(value, format)).toEqual(expected);
  });
});

describe('attachRelationLens — local table_rows', () => {
  test('valueColumn=id: resolves by id, counts missing, keys only from the given page', async () => {
    dbAll.mockImplementation(async (sql) => {
      if (PARENT_COLUMNS.test(sql)) return [column('state', relation())];
      if (RELATED_COLUMNS.test(sql)) return [];
      if (/FROM table_rows WHERE table_id = \? AND id IN/.test(sql)) {
        return [{ id: 10, data: JSON.stringify({ name: 'backlog', color: '#111' }) }, { id: 11, data: { name: 'done' } }];
      }
      throw new Error('unexpected ' + sql);
    });
    dbGet.mockResolvedValue(localTable);

    const out = await attachRelationLens({
      tableId: 1, rows: [{ data: { state: 10 } }, { data: { state: '11' } }, { data: { state: 999 } }, { data: {} }],
    });

    expect(out.relations.state['10']).toEqual({ value: 'backlog', label: 'backlog', color: '#111' });
    expect(out.relations.state['11']).toEqual({ value: 'done', label: 'done' });
    expect(out.relations.state['999']).toBeUndefined();
    expect(out.relations_meta.state).toEqual({ resolved: 2, missing: 1, truncated: false });
    const idQuery = dbAll.mock.calls.find(([sql]) => /id IN/.test(sql));
    expect(idQuery[1]).toEqual([77, 10, 11, 999]);
  });

  test('valueColumn≠id: JSON field match on data by column name or legacy column id', async () => {
    dbAll.mockImplementation(async (sql) => {
      if (PARENT_COLUMNS.test(sql)) return [column('sku', relation({ valueColumn: 'code', labelColumn: 'title' }))];
      if (RELATED_COLUMNS.test(sql)) return [{ id: 301, column_name: 'code' }, { id: 302, column_name: 'title' }];
      if (/COALESCE\(data::jsonb->>\?, data::jsonb->>\?\) IN/.test(sql)) {
        return [{ id: 1, data: { code: 'A1', title: 'Chair' } }, { id: 2, data: { 301: 'B2', 302: 'Table' } }];
      }
      throw new Error('unexpected ' + sql);
    });
    dbGet.mockResolvedValue(localTable);

    const out = await attachRelationLens({ tableId: 1, rows: [{ data: { sku: 'A1' } }, { data: { sku: 'B2' } }] });

    expect(out.relations.sku).toEqual({ A1: { value: 'Chair', label: 'Chair' }, B2: { value: 'Table', label: 'Table' } });
    const q = dbAll.mock.calls.find(([sql]) => /COALESCE/.test(sql));
    expect(q[1]).toEqual([77, 'code', '301', 'A1', 'B2']);
  });

  test('multi-value keys resolve per key (comma + json), description column included', async () => {
    dbAll.mockImplementation(async (sql) => {
      if (PARENT_COLUMNS.test(sql)) {
        return [
          column('tags', relation({ multiple: true, storageFormat: 'comma', descriptionColumn: 'note' }), 1),
          column('imgs', relation({ multiple: true, storageFormat: 'json', tableId: 77 }), 2),
        ];
      }
      if (RELATED_COLUMNS.test(sql)) return [];
      if (/id IN/.test(sql)) return [{ id: 1, data: { name: 'one', note: 'first' } }, { id: 2, data: { name: 'two' } }];
      throw new Error('unexpected ' + sql);
    });
    dbGet.mockResolvedValue(localTable);

    const out = await attachRelationLens({ tableId: 1, rows: [{ data: { tags: '1, 2', imgs: [2, 1] } }] });

    expect(out.relations.tags['1']).toEqual({ value: 'one', label: 'one', description: 'first' });
    expect(out.relations.tags['2']).toEqual({ value: 'two', label: 'two' });
    expect(out.relations.imgs['1'].value).toBe('one');
    expect(out.relations_meta.imgs).toEqual({ resolved: 2, missing: 0, truncated: false });
  });

  test('reads the key from data by column id when the row is keyed by ids', async () => {
    dbAll.mockImplementation(async (sql) => {
      if (PARENT_COLUMNS.test(sql)) return [column('state', relation(), 44)];
      if (RELATED_COLUMNS.test(sql)) return [];
      if (/id IN/.test(sql)) return [{ id: 7, data: { name: 'x' } }];
      throw new Error('unexpected ' + sql);
    });
    dbGet.mockResolvedValue(localTable);
    const out = await attachRelationLens({ tableId: 1, rows: [{ data: { 44: 7 } }] });
    expect(out.relations.state['7'].value).toBe('x');
  });

  test('caps distinct keys per column and flags truncated', async () => {
    const page = Array.from({ length: MAX_KEYS_PER_COLUMN + 5 }, (_, i) => ({ data: { state: i + 1 } }));
    dbAll.mockImplementation(async (sql) => {
      if (PARENT_COLUMNS.test(sql)) return [column('state', relation())];
      if (RELATED_COLUMNS.test(sql)) return [];
      if (/id IN/.test(sql)) return [];
      throw new Error('unexpected ' + sql);
    });
    dbGet.mockResolvedValue(localTable);
    const out = await attachRelationLens({ tableId: 1, rows: page });
    const q = dbAll.mock.calls.find(([sql]) => /id IN/.test(sql));
    expect(q[1].length - 1).toBe(MAX_KEYS_PER_COLUMN);
    expect(out.relations_meta.state).toEqual({ resolved: 0, missing: MAX_KEYS_PER_COLUMN, truncated: true });
  });

  test('no relation columns → empty maps and no row queries', async () => {
    dbAll.mockResolvedValue([column('plain', undefined)]);
    const out = await attachRelationLens({ tableId: 1, rows: [{ data: { plain: 'x' } }] });
    expect(out).toEqual({ relations: {}, relations_meta: {} });
    expect(dbGet).not.toHaveBeenCalled();
  });

  test('column whose keys are all empty on this page → no query, zero counts', async () => {
    dbAll.mockResolvedValue([column('state', relation())]);
    dbGet.mockResolvedValue(localTable);
    const out = await attachRelationLens({ tableId: 1, rows: [{ data: { state: null } }, { data: { state: '' } }] });
    expect(out.relations.state).toEqual({});
    expect(out.relations_meta.state).toEqual({ resolved: 0, missing: 0, truncated: false });
    expect(dbAll).toHaveBeenCalledTimes(1);
  });
});

describe('attachRelationLens — data-source related tables', () => {
  const dsTable = { ...localTable, data_source_id: 'ds_1', source_table_name: 'products', source_id_column: 'product_id' };

  test('data source (internal or MySQL): one queryRowsByKeys per column, valueColumn id → source_id_column', async () => {
    dbAll.mockImplementation(async (sql) => {
      if (PARENT_COLUMNS.test(sql)) return [column('product', relation({ labelColumn: 'title' }))];
      if (RELATED_COLUMNS.test(sql)) return [];
      throw new Error('unexpected ' + sql);
    });
    dbGet.mockResolvedValue(dsTable);
    queryRowsByKeys.mockResolvedValue([{ product_id: 1, title: 'Chair' }]);

    const out = await attachRelationLens({ tableId: 1, rows: [{ data: { product: 1 } }, { data: { product: 2 } }] });

    expect(queryRowsByKeys).toHaveBeenCalledWith('ds_1', 'products', 'product_id', ['1', '2']);
    expect(out.relations.product).toEqual({ 1: { value: 'Chair', label: 'Chair' } });
    expect(out.relations_meta.product).toEqual({ resolved: 1, missing: 1, truncated: false });
  });

  test('data source: labelColumn given as a column id resolves to the source column name', async () => {
    dbAll.mockImplementation(async (sql) => {
      if (PARENT_COLUMNS.test(sql)) return [column('product', relation({ labelColumn: '302' }))];
      if (RELATED_COLUMNS.test(sql)) return [{ id: 302, column_name: 'title' }];
      throw new Error('unexpected ' + sql);
    });
    dbGet.mockResolvedValue(dsTable);
    queryRowsByKeys.mockResolvedValue([{ product_id: 1, title: 'Chair' }]);
    const out = await attachRelationLens({ tableId: 1, rows: [{ data: { product: 1 } }] });
    expect(out.relations.product['1'].value).toBe('Chair');
  });

  test('MySQL data source: delegates to queryRowsByKeys with the key column, multi keys per row', async () => {
    dbAll.mockImplementation(async (sql) => {
      if (PARENT_COLUMNS.test(sql)) {
        return [column('photos', relation({ valueColumn: 'sku', labelColumn: 'image_path', multiple: true, storageFormat: 'comma' }))];
      }
      if (RELATED_COLUMNS.test(sql)) return [];
      throw new Error('unexpected ' + sql);
    });
    dbGet.mockResolvedValue(dsTable);
    queryRowsByKeys.mockResolvedValue([{ sku: 'A', image_path: 'img/a.jpg' }, { sku: 'B', image_path: 'img/b.jpg' }]);

    const out = await attachRelationLens({ tableId: 1, rows: [{ data: { photos: 'A, B' } }, { data: { photos: 'B, C' } }] });

    expect(queryRowsByKeys).toHaveBeenCalledWith('ds_1', 'products', 'sku', ['A', 'B', 'C']);
    expect(out.relations.photos).toEqual({ A: { value: 'img/a.jpg', label: 'img/a.jpg' }, B: { value: 'img/b.jpg', label: 'img/b.jpg' } });
    expect(out.relations_meta.photos).toEqual({ resolved: 2, missing: 1, truncated: false });
  });

  test('system/mail related table → skipped with unsupported flag', async () => {
    dbAll.mockResolvedValue([column('msg', relation())]);
    dbGet.mockResolvedValue({ ...localTable, is_system: true, sync_target: 'mail_messages' });
    const out = await attachRelationLens({ tableId: 1, rows: [{ data: { msg: 5 } }] });
    expect(out.relations.msg).toEqual({});
    expect(out.relations_meta.msg).toEqual({ resolved: 0, missing: 0, truncated: false, unsupported: true });
  });

  test('related table missing → skipped with unsupported flag, no throw', async () => {
    dbAll.mockResolvedValue([column('gone', relation({ tableId: '404' }))]);
    dbGet.mockResolvedValue(undefined);
    const out = await attachRelationLens({ tableId: 1, rows: [{ data: { gone: 5 } }] });
    expect(out.relations_meta.gone.unsupported).toBe(true);
  });

  test('project-restricted API key cannot read a related table in another project → denied, no leak', async () => {
    dbAll.mockImplementation(async (sql) => {
      if (PARENT_COLUMNS.test(sql)) return [column('state', relation())];
      throw new Error('unexpected ' + sql);
    });
    dbGet.mockResolvedValue({ ...localTable, project_id: 99 });
    const out = await attachRelationLens({ tableId: 1, rows: [{ data: { state: 10 } }], user: { id: 1, projectId: 1 } });
    expect(out.relations.state).toEqual({});
    expect(out.relations_meta.state).toEqual({ resolved: 0, missing: 0, truncated: false, denied: true });
    expect(dbAll).toHaveBeenCalledTimes(1);
  });
});
