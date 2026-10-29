/**
 * POST /tables/:id/summary on a MySQL-backed table — totals come from the source.
 *
 * Bug (conversation 3660): the endpoint answered 422 for every data-source table, so the
 * footer summed only the pages the browser had loaded (275 of 15 675 rows).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const table = { id: 100, project_id: 1, space_id: 1, data_source_id: 'ds_1', source_table_name: 'products', is_system: 0, sync_target: null };
const columns = [
  { id: 59, column_name: 'price', type: 'number', config: null, is_from_source: 1 },
  { id: 60, column_name: 'brand', type: 'select', config: null, is_from_source: 1 },
  { id: 61, column_name: 'note', type: 'text', config: null, is_from_source: 0 },
  // A nested-table column carries is_from_source but has no column in the source.
  { id: 62, column_name: 'instances', type: 'table', config: null, is_from_source: 1 },
];
const dbGet = vi.fn(async () => table);
const dbAll = vi.fn(async () => columns);
vi.mock('../../../database/connection.js', () => ({ dbGet, dbAll, withTransactionAsync: vi.fn() }));
vi.mock('../../../services/EffectiveRoleService.js', () => ({
  getEffectiveRole: async () => ({ effectiveRole: 'owner', source: 'space' }),
  ACCESS_LEVEL_VALUES: { viewer: 1, owner: 4 },
}));
vi.mock('../../../services/SpaceService.js', () => ({ canAccessTable: () => true, canAccessProject: () => true, canAccessSpace: () => true }));
vi.mock('../tables/helpers.js', () => ({
  filterColumnsByRole: (cols) => cols,
  resolveUserRoleForTable: async () => ({ userRole: 'owner', userAccessData: null }),
}));

const execute = vi.fn(async (sql) => {
  if (sql.startsWith('SHOW COLUMNS')) return [[{ Field: 'id' }, { Field: 'price' }, { Field: 'brand' }]];
  if (sql.includes('GROUP BY')) return [[{ value: 'Holy Metal', count: 20 }, { value: 'BodyVibe', count: 5 }]];
  return [[{ total: 15675, f0: 15600, u0: 900, s0: '1527250.00', a0: '97.9', mn0: 1, mx0: 9000, f1: 15000, u1: 7 }]];
});
const end = vi.fn(async () => {});
vi.mock('../../../services/data-source/mysql.js', () => ({
  isMysqlSource: (source) => source?.type === 'local_mysql',
  openMysqlConnection: async () => ({ execute, end }),
}));
const sourceType = { current: 'local_mysql' };
vi.mock('../../../services/DataSourceService.js', () => ({
  default: class { async get() { return { id: 'ds_1', type: sourceType.current }; } },
}));

const { default: router } = await import('../tables/tableSummaryController.js');
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: 1, role: 'owner' }; next(); });
app.use('/api/v3', router);

const summarize = (data = { columnIds: ['59', '60', '61', '62'] }) => request(app).post('/api/v3/tables/100/summary').send({ data });

beforeEach(() => { execute.mockClear(); end.mockClear(); sourceType.current = 'local_mysql'; });

describe('source table summary', () => {
  it('aggregates the whole source table in one query plus a GROUP BY per option column', async () => {
    const res = await summarize();
    expect(res.status).toBe(200);
    const [fields, aggregate, options] = execute.mock.calls.map(([sql]) => sql.replace(/\s+/g, ' '));
    expect(fields).toBe('SHOW COLUMNS FROM `products`');
    expect(aggregate).toContain('COUNT(*) AS total');
    // Text comparison: NULLIF(date_col, '') is "Incorrect DATE value" under strict SQL mode.
    expect(aggregate).toContain("COUNT(NULLIF(CAST(`price` AS CHAR), '')) AS f0");
    expect(aggregate).toContain('SUM(`price`) AS s0, AVG(`price`) AS a0, MIN(`price`) AS mn0, MAX(`price`) AS mx0');
    expect(aggregate).not.toContain('`note`');
    expect(aggregate).not.toContain('`instances`');
    expect(options).toContain('GROUP BY `brand` ORDER BY count DESC LIMIT 20');
    expect(end).toHaveBeenCalledTimes(1);

    expect(res.body.data.total).toBe(15675);
    expect(res.body.data.columns['59']).toMatchObject({ count: 15675, countFilled: 15600, countEmpty: 75, countUnique: 900, numericCount: 15600, sum: 1527250, avg: 97.9, min: 1, max: 9000 });
    expect(res.body.data.columns['60'].valueCounts).toEqual({ 'Holy Metal': 20, BodyVibe: 5 });
    // A virtual column lives in table_rows, which the source cannot see; a nested-table column has no source column at all.
    expect(res.body.data.columns['61']).toMatchObject({ count: 15675, countFilled: 0, countEmpty: 15675 });
    expect(res.body.data.columns['62']).toMatchObject({ count: 15675, countFilled: 0, countEmpty: 15675 });
  });

  it('refuses a filtered scope, which the browser applies to the loaded rows only', async () => {
    expect((await summarize({ columnIds: ['59'], searchQuery: 'ring' })).status).toBe(422);
    expect((await summarize({ columnIds: ['59'], selectFilters: { 60: ['Holy Metal'] } })).status).toBe(422);
    expect((await summarize({ columnIds: ['59'], rowIds: ['5'] })).status).toBe(422);
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps 422 for a source type it cannot aggregate and 400 for a foreign column', async () => {
    sourceType.current = 'internal';
    expect((await summarize()).status).toBe(422);
    sourceType.current = 'local_mysql';
    expect((await summarize({ columnIds: ['77'] })).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
});
