// ADR-205 D3 — queryRowsByKeys: parameterized IN over an external/internal source table,
// identifiers asserted, MySQL chunked by 500.
import { describe, test, expect, vi, beforeEach } from 'vitest';

const createConnection = vi.fn();
vi.mock('mysql2/promise', () => ({ createConnection }));

const dbAll = vi.fn();
vi.mock('../database/connection.js', () => ({ dbAll, dbGet: vi.fn(), dbRun: vi.fn() }));

const getDataSource = vi.fn();
vi.mock('../services/data-source/crud.js', async (importOriginal) => ({ ...(await importOriginal()), get: getDataSource }));

const { encryptCredential } = await import('../utils/encryption.js');
const { queryRowsByKeys, MYSQL_IN_CHUNK } = await import('../services/data-source/queries.js');

const mysqlSource = () => ({
  id: 'ds_m', type: 'local_mysql', db_host: '127.0.0.1', db_port: 3306,
  db_name: 'shop', db_username: 'ro', db_password_encrypted: encryptCredential('pw'),
});

beforeEach(() => { createConnection.mockReset(); dbAll.mockReset(); getDataSource.mockReset(); });

describe('queryRowsByKeys', () => {
  test('empty keys → [] without touching any storage', async () => {
    expect(await queryRowsByKeys('ds_m', 'products', 'sku', [])).toEqual([]);
    expect(getDataSource).not.toHaveBeenCalled();
  });

  test('internal source: escaped identifiers + IN placeholders', async () => {
    getDataSource.mockResolvedValue({ id: 'ds_i', type: 'internal' });
    dbAll.mockResolvedValue([{ code: 'A' }]);
    const rows = await queryRowsByKeys('ds_i', 'products', 'code', ['A', 'B']);
    expect(rows).toEqual([{ code: 'A' }]);
    expect(dbAll).toHaveBeenCalledWith('SELECT * FROM "products" WHERE "code" IN (?, ?)', ['A', 'B']);
  });

  test('MySQL source: parameterized IN, chunked by MYSQL_IN_CHUNK, connection closed', async () => {
    getDataSource.mockResolvedValue(mysqlSource());
    const execute = vi.fn(async (sql, params) => [params.map((k) => ({ sku: k }))]);
    const end = vi.fn(async () => {});
    createConnection.mockResolvedValue({ execute, end });

    const keys = Array.from({ length: MYSQL_IN_CHUNK + 1 }, (_, i) => `k${i}`);
    const rows = await queryRowsByKeys('ds_m', 'products', 'sku', keys);

    expect(rows).toHaveLength(MYSQL_IN_CHUNK + 1);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][0]).toBe(`SELECT * FROM \`products\` WHERE \`sku\` IN (${Array(MYSQL_IN_CHUNK).fill('?').join(', ')})`);
    expect(execute.mock.calls[0][1]).toEqual(keys.slice(0, MYSQL_IN_CHUNK));
    expect(execute.mock.calls[1][1]).toEqual([keys[MYSQL_IN_CHUNK]]);
    expect(end).toHaveBeenCalledTimes(1);
  });

  test('MySQL source: rejects unsafe table or column identifiers before connecting', async () => {
    getDataSource.mockResolvedValue(mysqlSource());
    await expect(queryRowsByKeys('ds_m', 'products`; DROP', 'sku', ['A'])).rejects.toThrow(/Invalid table name/);
    await expect(queryRowsByKeys('ds_m', 'products', 'sku`=1 OR 1', ['A'])).rejects.toThrow(/Invalid column name/);
    expect(createConnection).not.toHaveBeenCalled();
  });

  test('unsupported source type → error', async () => {
    getDataSource.mockResolvedValue({ id: 'x', type: 'local_postgresql' });
    await expect(queryRowsByKeys('x', 'products', 'sku', ['A'])).rejects.toThrow(/not supported/);
  });
});
