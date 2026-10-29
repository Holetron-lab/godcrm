/**
 * GET /tables/:id/rows on a data-source table — header sorting is pushed down to the source.
 *
 * Bug (conversation 3660): the MySQL branch ignored ?sortColumn/?sortDirection, so the grid
 * (server-sorting mode for any table over one page) re-fetched the same unsorted page.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const dbGet = vi.fn();
const dbAll = vi.fn(async () => []);
vi.mock('../../../database/connection.js', () => ({ dbGet, dbAll, dbRun: vi.fn() }));

const execute = vi.fn(async () => [[{ id: 1, price: 10 }]]);
vi.mock('../../../services/data-source/mysql.js', () => ({
  isMysqlSource: () => true,
  openMysqlConnection: async () => ({ execute, end: vi.fn(async () => {}) }),
}));
vi.mock('../../../services/DataSourceService.js', () => ({
  default: class { async get() { return { id: 'ds_1', type: 'local_mysql' }; } },
}));

const { default: router } = await import('../tables/tableRowListController.js');
const app = express();
app.use('/api/v3', router);

const table = { data_source_id: 'ds_1', source_table_name: 'products', source_id_column: 'id', is_system: 0, sync_target: null, project_id: 1 };
const columns = { 59: { column_name: 'price', is_from_source: 1 }, 60: { column_name: 'note', is_from_source: 0 } };

beforeEach(() => {
  execute.mockClear();
  dbGet.mockReset();
  dbGet.mockImplementation(async (sql, params) => {
    if (sql.includes('FROM universal_tables')) return table;
    if (sql.includes('FROM table_columns')) return columns[params[1]] ?? null;
    return null;
  });
});

const selectSql = () => execute.mock.calls[0][0];

describe('external table sorting', () => {
  it('orders the source query by the requested column', async () => {
    const res = await request(app).get('/api/v3/tables/100/rows?sortColumn=59&sortDirection=desc');
    expect(res.status).toBe(200);
    expect(selectSql()).toMatch(/FROM `products`\s+ORDER BY `price` DESC LIMIT 50 OFFSET 0/);
  });

  it('sorts by the source id for the row-id key', async () => {
    const res = await request(app).get('/api/v3/tables/100/rows?sortColumn=__row_id&sortDirection=asc');
    expect(res.status).toBe(200);
    expect(selectSql()).toContain('ORDER BY `id` ASC');
  });

  it('keeps the natural order for a virtual column, which the source cannot sort', async () => {
    const res = await request(app).get('/api/v3/tables/100/rows?sortColumn=60&sortDirection=asc');
    expect(res.status).toBe(200);
    expect(selectSql()).not.toContain('ORDER BY');
  });

  it('keeps the natural order without a sort request', async () => {
    const res = await request(app).get('/api/v3/tables/100/rows');
    expect(res.status).toBe(200);
    expect(selectSql()).not.toContain('ORDER BY');
  });

  it('rejects a column of another table and a direction without a column', async () => {
    expect((await request(app).get('/api/v3/tables/100/rows?sortColumn=61&sortDirection=asc')).status).toBe(400);
    expect((await request(app).get('/api/v3/tables/100/rows?sortDirection=asc')).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
});
