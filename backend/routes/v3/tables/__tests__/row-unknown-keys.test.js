// QA-20816-01 (ADR-203 S2 schema rejection) — a row write carrying a key the
// table schema does not declare must be rejected, and nothing may be written.
//
// Before: POST /tables/:id/rows and PUT /tables/:id/rows/:rowId persisted
// whatever keys arrived; MCP add_table_row / update_table_row did the same.
// `{title, qa_unknown}` on a `title`-only table answered 201 and GET echoed
// the stray key while the grid showed only `title`.
//
// DB-backed (godcrm_test, ADR-0009): the guard is a real table_columns query and
// the HTTP paths run select/atom validators before the insert; a mocked
// connection would only test the mock.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NON_EXISTENT_ID } from '../../../../tests/helpers/sentinel-ids.js';
import request from 'supertest';
import express from 'express';
import { dbRun, dbGet } from '../../../../database/connection.js';
import { generateBaseId } from '../../../../utils/baseId.js';
import { createEphemeralWorkspace } from '../../../../tests/helpers/workspace-fixture.js';
import { ATOMS_V2_TABLE_ID } from '../../../../services/atoms-archive.js';
import { guardRowKeys, splitUnknownRowKeys } from '../../../../services/row-schema-guard.js';
import tablesRouter from '../index.js';

let currentUser = null;
const app = express();
app.use(express.json());
app.use('/api/v3', (req, _res, next) => { req.user = currentUser; next(); }, tablesRouter);
const as = (user) => { currentUser = user; return request(app); };

let ws;          // owner workspace: one table with a single `title` column
let titleColId;  // id of that column (clients may key by column id)
let bare;        // second table in the same project with NO columns
let docContent;  // third table: table_type=document_content with a `level` column

const rowData = async (id) => {
  const row = await dbGet('SELECT data FROM table_rows WHERE id = ?', [id]);
  if (!row) return null;
  return typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
};
const rowCount = (tableId) => dbGet('SELECT COUNT(*)::int AS n FROM table_rows WHERE table_id = ?', [tableId]).then(r => r.n);

async function seedRow(tableId, data) {
  const r = await dbRun(
    'INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)',
    [tableId, generateBaseId(), JSON.stringify(data), ws.userId]
  );
  return r.lastInsertRowid;
}

beforeAll(async () => {
  ws = await createEphemeralWorkspace({ label: 'unknown-keys' });
  const col = await dbRun(
    'INSERT INTO table_columns (table_id, column_name, display_name, type, order_index) VALUES (?, ?, ?, ?, ?)',
    [ws.tableId, 'title', 'Title', 'text', 0]
  );
  titleColId = col.lastInsertRowid;
  const t = await dbRun(
    'INSERT INTO universal_tables (project_id, name) VALUES (?, ?)',
    [ws.projectId, `Bare Table ${ws.token}`]
  );
  bare = t.lastInsertRowid;
  const d = await dbRun(
    'INSERT INTO universal_tables (project_id, name, table_type) VALUES (?, ?, ?)',
    [ws.projectId, `doc_fixture_${ws.token}`, 'document_content']
  );
  docContent = d.lastInsertRowid;
  await dbRun(
    'INSERT INTO table_columns (table_id, column_name, display_name, type, order_index) VALUES (?, ?, ?, ?, ?)',
    [docContent, 'level', 'Level', 'text', 0]
  );
  currentUser = { id: ws.userId, email: ws.email, role: 'user' };
});

afterAll(async () => {
  await dbRun('DELETE FROM table_rows WHERE table_id IN (?, ?, ?)', [ws.tableId, bare, docContent]);
  await dbRun('DELETE FROM table_columns WHERE table_id IN (?, ?)', [ws.tableId, docContent]);
  await ws.cleanup();
});

describe('splitUnknownRowKeys (pure)', () => {
  const columns = [{ id: 7, column_name: 'title' }];

  it('accepts column names and column ids, rejects the rest', () => {
    const r = splitUnknownRowKeys(columns, { title: 'a', 7: 'b', qa_unknown: 'x' });
    expect(r.unknown).toEqual(['qa_unknown']);
    expect(r.data).toEqual({ title: 'a', 7: 'b' });
  });

  it('drops row-envelope fields without calling them unknown', () => {
    const r = splitUnknownRowKeys(columns, { title: 'a', id: 1, base_id: 'x', created_at: 't', updated_at: 't', change_reason: 'r' });
    expect(r.unknown).toEqual([]);
    expect(r.data).toEqual({ title: 'a' });
  });

  it('keeps keys already stored on the row (round-trip of backend-written fields)', () => {
    const r = splitUnknownRowKeys(columns, { title: 'a', task_ref: 5, brand_new: 1 }, { title: 'old', task_ref: 5 });
    expect(r.unknown).toEqual(['brand_new']);
    expect(r.data).toEqual({ title: 'a', task_ref: 5 });
  });

  it('stores platform contract keys the backend reads without a column (parent_document_id)', () => {
    const r = splitUnknownRowKeys(columns, { title: 'ticket', parent_document_id: 12 });
    expect(r.unknown).toEqual([]);
    expect(r.data).toEqual({ title: 'ticket', parent_document_id: 12 });
  });
});

describe('guardRowKeys exemptions', () => {
  it('passes atoms_v2 through untouched — typed-atom contracts live in their own validators', async () => {
    const data = { type: 'ticket_ref', widget_ref: 1, doc_id: 2, props: { ticket_id: 3 } };
    expect(await guardRowKeys(ATOMS_V2_TABLE_ID, data)).toEqual({ data, unknown: [] });
  });

  it('passes a table with no declared columns through untouched', async () => {
    const data = { anything: 1 };
    expect(await guardRowKeys(bare, data)).toEqual({ data, unknown: [] });
  });

  it('passes documents preset tables (table_type=document_content) through — the item model is the contract', async () => {
    const data = { level: 'atom', atom_title: 'x', is_hidden: false, image_max_height: 300 };
    expect(await guardRowKeys(docContent, data)).toEqual({ data, unknown: [] });
    const res = await as(currentUser).post(`/api/v3/tables/${docContent}/rows`).send({ data });
    expect(res.status).toBe(201);
    expect(await rowData(res.body.data.id)).toEqual(data);
  });
});

describe('POST /tables/:id/rows', () => {
  it('QA-20816-01: unknown key → 400 and no row is written', async () => {
    const before = await rowCount(ws.tableId);
    const res = await as(currentUser).post(`/api/v3/tables/${ws.tableId}/rows`)
      .send({ data: { title: 'QA-20816 invalid', qa_unknown: 'invalid' } });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNKNOWN_COLUMN');
    expect(res.body.error.details.unknown_fields).toEqual(['qa_unknown']);
    expect(await rowCount(ws.tableId)).toBe(before);
  });

  it('declared keys (name or column id) → 201, stored as given', async () => {
    const res = await as(currentUser).post(`/api/v3/tables/${ws.tableId}/rows`)
      .send({ data: { [titleColId]: 'by id' } });
    expect(res.status).toBe(201);
    expect(await rowData(res.body.data.id)).toEqual({ [titleColId]: 'by id' });
  });

  it('envelope fields echoed inside data are not persisted', async () => {
    const res = await as(currentUser).post(`/api/v3/tables/${ws.tableId}/rows`)
      .send({ data: { title: 'env', id: NON_EXISTENT_ID, created_at: '2020-01-01' } });
    expect(res.status).toBe(201);
    expect(res.body.data.id).not.toBe(NON_EXISTENT_ID);
    expect(await rowData(res.body.data.id)).toEqual({ title: 'env' });
  });

  it('a table without declared columns still accepts any keys', async () => {
    const res = await as(currentUser).post(`/api/v3/tables/${bare}/rows`)
      .send({ data: { free: 'form' } });
    expect(res.status).toBe(201);
    expect(await rowData(res.body.data.id)).toEqual({ free: 'form' });
  });
});

describe('PUT /tables/:id/rows/:rowId', () => {
  it('QA-20816-01: new unknown key → 400 and the row is untouched', async () => {
    const rowId = await seedRow(ws.tableId, { title: 'seed' });
    const res = await as(currentUser).put(`/api/v3/tables/${ws.tableId}/rows/${rowId}`)
      .send({ data: { title: 'edited', qa_unknown: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNKNOWN_COLUMN');
    expect(res.body.error.details.unknown_fields).toEqual(['qa_unknown']);
    expect(await rowData(rowId)).toEqual({ title: 'seed' });
  });

  it('round-trip of a backend-written field already on the row → 200, nothing new added', async () => {
    const rowId = await seedRow(ws.tableId, { title: 'linked', task_ref: 41 });
    const res = await as(currentUser).put(`/api/v3/tables/${ws.tableId}/rows/${rowId}`)
      .send({ data: { id: rowId, base_id: 'echo', title: 'linked-edited', task_ref: 41 } });
    expect(res.status).toBe(200);
    expect(await rowData(rowId)).toEqual({ title: 'linked-edited', task_ref: 41 });
  });
});

describe('MCP data tools', () => {
  let tools;
  beforeAll(async () => {
    ({ dataToolHandlers: tools } = await import('../../../../services/agent-tools/data-tools.js'));
  });

  it('add_table_row: unknown key → error with rejected_fields, no row written', async () => {
    const before = await rowCount(ws.tableId);
    const res = await tools.add_table_row({ table_id: ws.tableId, data: { title: 'mcp', 'Reported By': 'agent' } }, ws.userId);
    expect(res.success).toBeUndefined();
    expect(res.error).toMatch(/Unknown column/);
    expect(res.rejected_fields).toEqual([{ column: 'Reported By', reason: 'unknown_column' }]);
    expect(await rowCount(ws.tableId)).toBe(before);
  });

  it('add_table_row: declared keys → row_id returned', async () => {
    const res = await tools.add_table_row({ table_id: ws.tableId, data: { title: 'mcp ok' } }, ws.userId);
    expect(res.success).toBe(true);
    expect(await rowData(res.row_id)).toEqual({ title: 'mcp ok' });
  });

  it('update_table_row: unknown key → error, row untouched; existing stray key still round-trips', async () => {
    const rowId = await seedRow(ws.tableId, { title: 'seed', task_ref: 9 });
    const bad = await tools.update_table_row({ table_id: ws.tableId, row_id: rowId, data: { summary: 'new' } }, ws.userId);
    expect(bad.error).toMatch(/Unknown column/);
    expect(bad.rejected_fields).toEqual([{ column: 'summary', reason: 'unknown_column' }]);
    expect(await rowData(rowId)).toEqual({ title: 'seed', task_ref: 9 });

    const ok = await tools.update_table_row({ table_id: ws.tableId, row_id: rowId, data: { title: 'seed2', task_ref: 9 } }, ws.userId);
    expect(ok.success).toBe(true);
    expect(await rowData(rowId)).toEqual({ title: 'seed2', task_ref: 9 });
  });
});

describe('228649: batch and section writes cannot bypass the schema', () => {
  it('REST batch rejects the invalid row, commits the valid row, and strips envelope fields', async () => {
    const badId = await seedRow(ws.tableId, { title: 'unchanged' });
    const goodId = await seedRow(ws.tableId, { title: 'before', task_ref: 9 });
    const res = await as(currentUser).post(`/api/v3/tables/${ws.tableId}/rows/batch-update`)
      .send({ updates: [
        { rowId: badId, data: { title: 'bad', area: 'ghost' } },
        { rowId: goodId, data: { [titleColId]: 'after', task_ref: 9, id: 999999 } },
      ] });
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(1);
    expect(res.body.data.errors).toEqual([
      expect.objectContaining({ rowId: String(badId), code: 'UNKNOWN_COLUMN', unknown_fields: ['area'] }),
    ]);
    expect(await rowData(badId)).toEqual({ title: 'unchanged' });
    expect(await rowData(goodId)).toEqual({ title: 'after', task_ref: 9 });
  });

  it('MCP batch rejects the invalid row and preserves the partial-success contract', async () => {
    const { dataToolHandlers: tools } = await import('../../../../services/agent-tools/data-tools.js');
    const badId = await seedRow(ws.tableId, { title: 'unchanged' });
    const goodId = await seedRow(ws.tableId, { title: 'before', task_ref: 9 });
    const res = await tools.batch_update_rows({ table_id: ws.tableId, updates: [
      { row_id: badId, data: { title: 'bad', area: 'ghost' } },
      { row_id: goodId, data: { title: 'after', task_ref: 9, id: 999999 } },
    ] }, ws.userId);
    expect(res.success).toEqual([goodId]);
    expect(res.failed).toEqual([
      expect.objectContaining({ row_id: badId, rejected_fields: [{ column: 'area', reason: 'unknown_column' }] }),
    ]);
    expect(await rowData(badId)).toEqual({ title: 'unchanged' });
    expect(await rowData(goodId)).toEqual({ title: 'after', task_ref: 9 });
  });

  it.each(['REST', 'MCP'])('%s batch keeps document-content fields and table/row isolation', async (path) => {
    const docId = await seedRow(docContent, { atom_title: 'before' });
    const foreignId = await seedRow(ws.tableId, { title: 'untouched' });
    if (path === 'REST') {
      const res = await as(currentUser).post(`/api/v3/tables/${docContent}/rows/batch-update`)
        .send({ updates: [
          { rowId: docId, data: { atom_title: 'after' } },
          { rowId: foreignId, data: { atom_title: 'wrong table' } },
        ] });
      expect(res.body.data.updated).toBe(1);
      expect(res.body.data.errors).toHaveLength(1);
    } else {
      const { dataToolHandlers: tools } = await import('../../../../services/agent-tools/data-tools.js');
      const res = await tools.batch_update_rows({ table_id: docContent, updates: [
        { row_id: docId, data: { atom_title: 'after' } },
        { row_id: foreignId, data: { atom_title: 'wrong table' } },
      ] }, ws.userId);
      expect(res.success).toEqual([docId]);
      expect(res.failed).toHaveLength(1);
    }
    expect(await rowData(docId)).toEqual({ atom_title: 'after' });
    expect(await rowData(foreignId)).toEqual({ title: 'untouched' });
  });

  it.each(['area', 'id'])('upsert_section refuses undeclared/envelope field %s without a write', async (field) => {
    const { dataToolHandlers: tools } = await import('../../../../services/agent-tools/data-tools.js');
    const rowId = await seedRow(ws.tableId, { title: 'unchanged' });
    const res = await tools.upsert_section({ table_id: ws.tableId, row_id: rowId, field,
      marker: '## Note', content: '## Note\nGhost' }, ws.userId);
    expect(res.error).toMatch(/Unknown column/);
    expect(await rowData(rowId)).toEqual({ title: 'unchanged' });
  });

  it('upsert_section still writes declared fields and document content', async () => {
    const { dataToolHandlers: tools } = await import('../../../../services/agent-tools/data-tools.js');
    for (const [tableId, field] of [[ws.tableId, 'title'], [docContent, 'atom_title']]) {
      const rowId = await seedRow(tableId, {});
      const res = await tools.upsert_section({ table_id: tableId, row_id: rowId, field,
        marker: '## Note', content: '## Note\nValid' }, ws.userId);
      expect(res.success).toBe(true);
      expect(await rowData(rowId)).toEqual({ [field]: '## Note\nValid' });
    }
  });
});
