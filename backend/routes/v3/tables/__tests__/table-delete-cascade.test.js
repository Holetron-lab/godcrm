// @vitest-environment node
// QA21086-02: real PostgreSQL, including the deployed missing-FK contour.
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest';
import express from 'express';
import request from 'supertest';
import router from '../tableManageController.js';
import { dbAll, dbGet, dbRun, resetAdapter, destroyAdapter } from '../../../../database/connection.js';

const schema = `qa_table_delete_${randomUUID().replaceAll('-', '')}`;
const app = express();
let user;
app.use((req, _res, next) => { req.user = user; next(); });
app.use('/api/v3', router);

beforeAll(async () => {
  await resetAdapter();
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  await dbRun(`CREATE SCHEMA ${schema}`);
  const url = new URL(`postgresql://${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT}/godcrm_test`);
  url.username = process.env.POSTGRES_USER;
  url.password = process.env.POSTGRES_PASSWORD;
  url.searchParams.set('options', `-c search_path=${schema}`);
  await resetAdapter({ connectionString: url.toString() });
  for (const table of ['projects', 'universal_tables', 'table_columns', 'table_rows']) {
    // Explicit fixture IDs avoid consuming shared sequences; LIKE omits FKs.
    await dbRun(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS)`);
  }
});

afterAll(async () => {
  await dbRun(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await destroyAdapter();
});

beforeEach(async () => {
  user = { id: 101, role: 'user' };
  await dbRun('TRUNCATE projects, universal_tables, table_columns, table_rows');
  await dbRun("INSERT INTO projects (id, owner_id, name, type) VALUES (1, 101, 'qa-delete', 'project')");
  for (const id of [2, 3]) {
    await dbRun('INSERT INTO universal_tables (id, project_id, name) VALUES (?, 1, ?)', [id, `qa_table_${id}`]);
    await dbRun("INSERT INTO table_columns (id, table_id, column_name, type) VALUES (?, ?, 'title', 'text')", [id, id]);
    await dbRun("INSERT INTO table_rows (id, table_id, base_id, data) VALUES (?, ?, ?, '{}')", [id, id, `qa-delete-${id}`]);
  }
});

async function snapshot() {
  return Promise.all(['universal_tables', 'table_columns', 'table_rows'].map(table => dbAll(`SELECT * FROM ${table} ORDER BY id`)));
}

describe('generic table DELETE cascade', () => {
  test.each(['table', 'document_registry'])('removes %s columns and rows without FKs and preserves neighbors', async (type) => {
    await dbRun('UPDATE universal_tables SET table_type = ? WHERE id = 2', [type]);
    const before = await snapshot();
    await request(app).delete('/api/v3/tables/2').expect(200);
    const after = await snapshot();
    after.forEach((rows, i) => expect(rows).toEqual(before[i].filter(row => row.id === 3)));
    await request(app).delete('/api/v3/tables/2').expect(404);
  });

  test('rolls back removed children if the parent DELETE fails', async () => {
    await dbRun(`CREATE FUNCTION reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected parent delete failure'; END $$`);
    await dbRun('CREATE TRIGGER reject_delete BEFORE DELETE ON universal_tables FOR EACH ROW EXECUTE FUNCTION reject_delete()');
    try {
      const before = await snapshot();
      await request(app).delete('/api/v3/tables/2').expect(500);
      expect(await snapshot()).toEqual(before);
    } finally {
      await dbRun('DROP TRIGGER reject_delete ON universal_tables');
      await dbRun('DROP FUNCTION reject_delete()');
    }
  });

  test('preserves all data on unauthorized and system-table requests', async () => {
    const before = await snapshot();
    user = { id: 999, role: 'user' };
    await request(app).delete('/api/v3/tables/2').expect(403);
    await request(app).delete('/api/v3/tables/999').expect(404);
    expect(await snapshot()).toEqual(before);
    user = { id: 101, role: 'admin' };
    await dbRun('UPDATE universal_tables SET is_system = 1 WHERE id = 2');
    const system = await snapshot();
    await request(app).delete('/api/v3/tables/2').expect(403);
    expect(await snapshot()).toEqual(system);
  });

  test.each(['admin', 'owner'])('retains global %s permission', async role => {
    user = { id: 999, role };
    await request(app).delete('/api/v3/tables/2').expect(200);
    for (const rows of await snapshot()) expect(rows.map(row => row.id)).toEqual([3]);
  });

  test.each(['2oops', '0', '-2', '9007199254740992'])('rejects malformed ID %s without writes', async id => {
    const before = await snapshot();
    await request(app).delete(`/api/v3/tables/${id}`).expect(400);
    expect(await snapshot()).toEqual(before);
  });

  test('concurrent deletes return one success and one not-found', async () => {
    const responses = await Promise.all([request(app).delete('/api/v3/tables/2'), request(app).delete('/api/v3/tables/2')]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 404]);
    for (const rows of await snapshot()) expect(rows.map(row => row.id)).toEqual([3]);
  });
});

test('also deletes successfully when native FK cascades exist', async () => {
  await dbRun('ALTER TABLE universal_tables ADD PRIMARY KEY (id)');
  await dbRun('ALTER TABLE table_rows ADD FOREIGN KEY (table_id) REFERENCES universal_tables(id) ON DELETE CASCADE');
  await dbRun('ALTER TABLE table_columns ADD FOREIGN KEY (table_id) REFERENCES universal_tables(id) ON DELETE CASCADE');
  try {
    await request(app).delete('/api/v3/tables/2').expect(200);
    for (const rows of await snapshot()) expect(rows.map(row => row.id)).toEqual([3]);
  } finally {
    await dbRun('ALTER TABLE table_columns DROP CONSTRAINT table_columns_table_id_fkey');
    await dbRun('ALTER TABLE table_rows DROP CONSTRAINT table_rows_table_id_fkey');
    await dbRun('ALTER TABLE universal_tables DROP CONSTRAINT universal_tables_pkey');
  }
});

test('restores rows if column cleanup fails before parent deletion', async () => {
  await dbRun(`CREATE FUNCTION reject_column_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected column delete failure'; END $$`);
  await dbRun('CREATE TRIGGER reject_column_delete BEFORE DELETE ON table_columns FOR EACH ROW EXECUTE FUNCTION reject_column_delete()');
  try {
    const before = await snapshot();
    await request(app).delete('/api/v3/tables/2').expect(500);
    expect(await snapshot()).toEqual(before);
  } finally {
    await dbRun('DROP TRIGGER reject_column_delete ON table_columns');
    await dbRun('DROP FUNCTION reject_column_delete()');
  }
});
