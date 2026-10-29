// ADR-200 W1 / AC#1 — POST /api/v3/tables is all-or-nothing.
//
// Before W1 the handler inserted the universal_tables row with dbRun, then looped
// dbRun per column — each statement autocommitting. A failure on the 5th column left
// a table with four columns behind, and nothing could roll it back. This suite injects
// exactly that failure and asserts nothing is committed.
//
// Unit test — mocks the DB (matches module-table-provisioner.test.js convention). The
// fake transaction models PostgreSQL semantics that matter here: writes are STAGED and
// only merged into the committed store when the callback returns; if it throws, the
// staged writes are discarded (ROLLBACK).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockWithTransactionAsync = vi.fn();

vi.mock('../../../../database/connection.js', () => ({
  dbAll: vi.fn(async () => []),
  dbGet: vi.fn(async () => null),
  dbRun: vi.fn(async () => ({ lastInsertRowid: 0 })),
  toBool: (v) => (v ? 1 : 0),
  sqlNow: () => 'NOW()',
  withTransactionAsync: (...a) => mockWithTransactionAsync(...a),
}));

// The controller now statically imports data-source/queries.js, whose transitive deps
// (encryption.js) build child loggers from the root `logger` — stub that too.
vi.mock('../../../../utils/logger.js', () => {
  const stub = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { apiLogger: stub, logger: { ...stub, child: () => stub } };
});

const tableCreateController = (await import('../tableCreateController.js')).default;

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: 42, role: 'owner' }; next(); });
app.use('/api/v3', tableCreateController);

// The committed store — only what survives COMMIT ever lands here.
let committed;

/**
 * Install a fake transaction.
 * @param {number|null} failOnColumnInsert 1-based index of the table_columns INSERT that
 *   should blow up mid-loop (the failure injection). null = everything succeeds.
 */
function installFakeTransaction(failOnColumnInsert = null) {
  committed = { tables: [], columns: [] };

  mockWithTransactionAsync.mockImplementation(async (cb) => {
    const staged = { tables: [], columns: [] };
    let seq = 500;
    let columnInserts = 0;

    const trx = {
      run: async (sql, params) => {
        if (/^\s*INSERT INTO universal_tables/i.test(sql)) {
          const id = ++seq;
          staged.tables.push({ id, project_id: params[0], name: params[1], display_name: params[2], created_by: params[10] });
          return { lastInsertRowid: id, changes: 1 };
        }
        if (/^\s*INSERT INTO table_columns/i.test(sql)) {
          columnInserts++;
          if (failOnColumnInsert && columnInserts === failOnColumnInsert) {
            // What a real constraint violation looks like from pg: the statement rejects
            // and the surrounding transaction is doomed.
            throw new Error('null value in column "column_name" violates not-null constraint');
          }
          const id = ++seq;
          staged.columns.push({ id, table_id: params[0], column_name: params[1] });
          return { lastInsertRowid: id, changes: 1 };
        }
        return { changes: 0 };
      },
      get: async (sql, params) =>
        /FROM universal_tables/i.test(sql)
          ? staged.tables.find((t) => t.id === params[0]) || null
          : null,
      all: async () => [],
    };

    const result = await cb(trx); // a throw here propagates — staged writes never merge
    committed.tables.push(...staged.tables);
    committed.columns.push(...staged.columns);
    return result;
  });
}

const FIVE_COLUMNS = ['a', 'b', 'c', 'd', 'e'].map((n, i) => ({
  name: n, displayName: n.toUpperCase(), type: 'text', orderIndex: i,
}));

beforeEach(() => {
  mockWithTransactionAsync.mockReset();
});

describe('POST /api/v3/tables — atomic table+columns creation (ADR-200 W1)', () => {
  it('commits the table row and every column together on the happy path', async () => {
    installFakeTransaction();

    const res = await request(app)
      .post('/api/v3/tables')
      .send({ name: 'orders', projectId: 7814, columns: FIVE_COLUMNS });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.columns).toHaveLength(5);
    expect(committed.tables).toHaveLength(1);
    expect(committed.columns).toHaveLength(5);
    // the whole handler ran inside ONE transaction, not one per statement
    expect(mockWithTransactionAsync).toHaveBeenCalledTimes(1);
  });

  it('leaves NO row in universal_tables or table_columns when a column insert fails midway', async () => {
    installFakeTransaction(3); // blow up on the 3rd of 5 columns

    const res = await request(app)
      .post('/api/v3/tables')
      .send({ name: 'orders', projectId: 7814, columns: FIVE_COLUMNS });

    expect(res.status).toBe(500);
    expect(res.body.error?.code || res.body.code).toBe('TABLE_CREATE_FAILED');

    // AC#1: not a single row survives — no orphan table, no partial column set
    expect(committed.tables).toEqual([]);
    expect(committed.columns).toEqual([]);
  });

  it('rejects a request with no name before opening a transaction', async () => {
    installFakeTransaction();

    const res = await request(app).post('/api/v3/tables').send({ projectId: 7814 });

    expect(res.status).toBe(400);
    expect(mockWithTransactionAsync).not.toHaveBeenCalled();
  });
});


describe('table technical key', () => {
  it.each(['Тикеты', 'my tickets', 'tickets\n', '', 123, null])('rejects invalid key %j before writing', async (name) => {
    installFakeTransaction();
    const res = await request(app).post('/api/v3/tables').send({ name, projectId: 7814 });
    expect(res.status).toBe(400);
    expect(mockWithTransactionAsync).not.toHaveBeenCalled();
  });
});


it('preserves the localized display title separately from the technical key', async () => {
  installFakeTransaction();
  const res = await request(app).post('/api/v3/tables').send({ name: 'tickets', displayName: 'Тикеты', projectId: 7814 });
  expect(res.status).toBe(200);
  expect(res.body.data.table).toMatchObject({ name: 'tickets', display_name: 'Тикеты', created_by: 42 });
});


it('rejects a non-string display title before writing', async () => {
  installFakeTransaction();
  const res = await request(app).post('/api/v3/tables').send({ name: 'tickets', displayName: { title: 'Тикеты' }, projectId: 7814 });
  expect(res.status).toBe(400);
  expect(mockWithTransactionAsync).not.toHaveBeenCalled();
});
