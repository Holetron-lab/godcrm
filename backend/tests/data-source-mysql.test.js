// data-source/mysql.js — stored password is used, connection test is real and honest.
//
// Bug (ticket 231940): row controllers opened MySQL with `password: ''` and
// testConnection() was a stub that always answered "not implemented". mysql2 is mocked
// here; the wire-level check runs against the staging MySQL fixture.
import { describe, test, expect, vi, beforeEach } from 'vitest';

const createConnection = vi.fn();
vi.mock('mysql2/promise', () => ({ createConnection }));

const dbRun = vi.fn(async () => ({}));
const dbGet = vi.fn();
vi.mock('../database/connection.js', () => ({ dbRun, dbGet, dbAll: vi.fn() }));

const { encryptCredential } = await import('../utils/encryption.js');
const { openMysqlConnection, testConnection } = await import('../services/data-source/mysql.js');

const SECRET = 'sekret-pw-42';
const source = () => ({
  id: 'ds_test', type: 'local_mysql', db_host: '127.0.0.1', db_port: 3307,
  db_name: 'shop', db_username: 'crm_ro', db_password_encrypted: encryptCredential(SECRET),
});

function fakeConnection(queryImpl) {
  return { query: vi.fn(queryImpl), execute: vi.fn(queryImpl), end: vi.fn(async () => {}) };
}

beforeEach(() => {
  createConnection.mockReset();
  dbRun.mockClear();
  dbGet.mockReset();
});

describe('openMysqlConnection', () => {
  test('connects with the decrypted stored password, not an empty string', async () => {
    createConnection.mockResolvedValue(fakeConnection());
    await openMysqlConnection(source());
    expect(createConnection).toHaveBeenCalledTimes(1);
    const opts = createConnection.mock.calls[0][0];
    expect(opts).toMatchObject({ host: '127.0.0.1', port: 3307, database: 'shop', user: 'crm_ro', password: SECRET });
  });

  test('accepts the wizard\'s plain "mysql" type as a direct connection', async () => {
    createConnection.mockResolvedValue(fakeConnection());
    await openMysqlConnection({ ...source(), type: 'mysql' });
    expect(createConnection).toHaveBeenCalledTimes(1);
  });

  test('refuses SSH-tunnel sources with an honest error instead of ignoring ssh_host', async () => {
    await expect(openMysqlConnection({ ...source(), ssh_host: 'msk' })).rejects.toThrow(/SSH tunnel connector is not implemented/);
    expect(createConnection).not.toHaveBeenCalled();
  });

  test('refuses non-MySQL types', async () => {
    await expect(openMysqlConnection({ ...source(), type: 'local_postgresql' })).rejects.toThrow(/Unsupported data source type/);
  });
});

describe('testConnection', () => {
  test('wrong password → success:false with the driver error, password absent from result and DB row', async () => {
    dbGet.mockResolvedValue(source());
    const denied = Object.assign(new Error("Access denied for user 'crm_ro'@'localhost' (using password: YES)"), { code: 'ER_ACCESS_DENIED_ERROR' });
    createConnection.mockRejectedValue(denied);

    const result = await testConnection('ds_test');

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('ER_ACCESS_DENIED_ERROR');
    expect(result.message).toMatch(/Access denied/);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(dbRun).toHaveBeenCalledTimes(1);
    const [sql, params] = dbRun.mock.calls[0];
    expect(sql).toMatch(/UPDATE data_sources/);
    expect(params).toEqual([result.tested_at, 'failed', result.message, 'ds_test']);
  });

  test('unreachable host → success:false with the connection error', async () => {
    dbGet.mockResolvedValue(source());
    createConnection.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3307'), { code: 'ECONNREFUSED' }));
    const result = await testConnection('ds_test');
    expect(result).toMatchObject({ success: false, error: 'ECONNREFUSED' });
  });

  test('good credentials → success:true with version, latency, and the row marked connected', async () => {
    dbGet.mockResolvedValue(source());
    const conn = fakeConnection(async () => [[{ version: '8.0.43' }]]);
    createConnection.mockResolvedValue(conn);

    const result = await testConnection('ds_test');

    expect(result).toMatchObject({ success: true, status: 'connected', database_version: '8.0.43' });
    expect(typeof result.latency_ms).toBe('number');
    expect(conn.end).toHaveBeenCalled();
    expect(dbRun.mock.calls[0][1]).toEqual([result.tested_at, 'connected', null, 'ds_test']);
  });
});
