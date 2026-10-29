// data-source/mysql.js — the ONE place a connection to an external MySQL data source is opened.
//
// Every consumer (schema listing, row queries, the row controllers, connection test) goes
// through openMysqlConnection so the stored, encrypted password is always used. Before this
// the controllers each hand-built a connection with `password: ''`, which only ever worked
// for a passwordless root on localhost.
//
// Transport: direct TCP only. The supported way to reach a remote box is a loopback SSH
// tunnel owned by the host (systemd unit) with the source pointed at 127.0.0.1:<port>;
// sources carrying ssh_host are refused with an honest error instead of silently ignoring it.
import { dbRun } from '../../database/connection.js';
import { dbLogger } from '../../utils/logger.js';
import { get, getDecryptedPassword } from './crud.js';

const MYSQL_TYPES = ['local_mysql', 'mysql', 'direct+mysql'];
const CONNECT_TIMEOUT_MS = 5000;

function isMysqlSource(dataSource) {
  return MYSQL_TYPES.includes(dataSource?.type);
}

/**
 * Open a mysql2/promise connection using the data source's decrypted password.
 * Caller owns the connection and must `end()` it.
 */
async function openMysqlConnection(dataSource) {
  if (!isMysqlSource(dataSource)) {
    throw new Error(`Unsupported data source type: ${dataSource?.type}`);
  }
  if (dataSource.ssh_host) {
    throw new Error('SSH tunnel connector is not implemented: run a loopback SSH tunnel on the host and point the data source at 127.0.0.1');
  }
  const mysql = await import('mysql2/promise');
  return mysql.createConnection({
    host: dataSource.db_host,
    port: Number(dataSource.db_port) || 3306,
    database: dataSource.db_name,
    user: dataSource.db_username,
    password: getDecryptedPassword(dataSource),
    connectTimeout: CONNECT_TIMEOUT_MS,
  });
}

/**
 * Really connect and run `SELECT VERSION()`. Persists the outcome on the data source row.
 * Shape matches the frontend TestConnectionResult (success/message/latency_ms/database_version/error).
 * The password never enters the result or the log line — only the driver's error code/message.
 */
async function testConnection(id) {
  const dataSource = await get(id);
  const startedAt = Date.now();
  const result = { success: false, status: 'failed', message: '', error: null, tested_at: new Date().toISOString() };

  try {
    const connection = await openMysqlConnection(dataSource);
    try {
      const [[row]] = await connection.query('SELECT VERSION() AS version');
      result.success = true;
      result.status = 'connected';
      result.database_version = row.version;
      result.latency_ms = Date.now() - startedAt;
      result.message = `Connected to MySQL ${row.version}`;
    } finally {
      await connection.end();
    }
  } catch (err) {
    result.error = err.code || 'CONNECTION_FAILED';
    result.message = err.message;
    dbLogger.warn({ dataSourceId: id, code: result.error, message: err.message }, 'Data source connection test failed');
  }

  await dbRun(`
    UPDATE data_sources
    SET last_test_at = ?, last_test_status = ?, last_test_error = ?
    WHERE id = ?
  `, [result.tested_at, result.status, result.success ? null : result.message, id]);

  return result;
}

export { MYSQL_TYPES, isMysqlSource, openMysqlConnection, testConnection };
