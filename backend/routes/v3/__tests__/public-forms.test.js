/**
 * Public form link tests — /api/v3/public/forms/:tableId (chat 3660).
 *
 * The form config is the contract: access follows the space-visibility scale
 * (internal = table viewer, open = any signed-in user, external = anyone with
 * the link); hidden/read-only fields are server-filled and the
 * client can only set what the form exposes (plus hidden fields the owner
 * explicitly allowed from the URL).
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import publicRoutes from '../public.js';
import { __resetPublicAccessForTests } from '../../../middleware/publicAccess.js';
import { dbRun, dbGet, destroyAdapter, resetAdapter } from '../../../database/connection.js';
import { buildSubmissionData, resolveFormAccess } from '../../../services/forms/publicFormSubmission.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_in_production';
const bearer = (id, role = 'user') =>
  `Bearer ${jwt.sign({ id, email: `u${id}@test.godcrm.local`, role }, JWT_SECRET)}`;

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/v3/public', publicRoutes);

async function createUser() {
  const email = `pf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@hltrn.cc`;
  const r = await dbRun(
    'INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified, role) VALUES (?, ?, ?, ?, ?, ?)',
    [email, 'hash', 'Form Owner', 'k', 1, 'user']
  );
  return r.lastInsertRowid;
}

async function createWorkspace(ownerId) {
  const space = await dbRun(
    `INSERT INTO spaces (owner_id, name, type, visibility) VALUES (?, ?, ?, ?)`,
    [ownerId, 'Form Space', 'business', 'internal']
  );
  const project = await dbRun(
    `INSERT INTO projects (owner_id, space_id, name, type) VALUES (?, ?, ?, ?)`,
    [ownerId, space.lastInsertRowid, 'Form Project', 'business']
  );
  const table = await dbRun(
    `INSERT INTO universal_tables (project_id, name, display_name) VALUES (?, ?, ?)`,
    [project.lastInsertRowid, 'returns', 'Возвраты']
  );
  return { spaceId: space.lastInsertRowid, projectId: project.lastInsertRowid, tableId: table.lastInsertRowid };
}

async function createColumn(tableId, columnName, type, extra = {}) {
  const r = await dbRun(
    `INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [tableId, columnName, columnName, type, JSON.stringify(extra.config || {}), extra.order ?? 0, 1, extra.required ? 1 : 0]
  );
  return r.lastInsertRowid;
}

async function publishForm(tableId, config, formType = 'custom') {
  await dbRun(
    `INSERT INTO system_form_configs (table_id, form_type, name, config, is_default) VALUES (?, ?, ?, ?, 1)`,
    [tableId, formType, null, JSON.stringify(config)]
  );
}

describe('Public forms (/api/v3/public/forms)', () => {
  let ownerId;
  let ws;
  let cols;
  let config;

  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    process.env.SKIP_DEV_USER = 'true';
    await resetAdapter();
    __resetPublicAccessForTests();

    ownerId = await createUser();
    ws = await createWorkspace(ownerId);
    cols = {
      order: await createColumn(ws.tableId, 'order_no', 'text', { order: 0 }),
      amount: await createColumn(ws.tableId, 'amount', 'number', { order: 1 }),
      status: await createColumn(ws.tableId, 'status', 'text', { order: 2 }),
      date: await createColumn(ws.tableId, 'request_date', 'date', { order: 3 }),
      source: await createColumn(ws.tableId, 'source', 'text', { order: 4 }),
    };
    config = {
      version: 1,
      layout: 'grid',
      fields: [
        { id: 'f1', type: 'field', columnId: String(cols.order), width: 'full', order: 0, required: true },
        { id: 'f2', type: 'field', columnId: String(cols.amount), width: 'half', order: 1 },
        { id: 'f3', type: 'field', columnId: String(cols.status), width: 'half', order: 2, hidden: true, defaultValue: 'new' },
        { id: 'f4', type: 'field', columnId: String(cols.date), width: 'half', order: 3, hidden: true, defaultValue: '{{now}}' },
        { id: 'f5', type: 'field', columnId: String(cols.source), width: 'half', order: 4, hidden: true, urlParam: true },
      ],
      elements: [],
      settings: { viewMode: 'standard', access: 'external' },
    };
  });

  afterEach(async () => {
    await dbRun('DELETE FROM table_rows WHERE table_id = ?', [ws.tableId]);
    await dbRun('DELETE FROM system_form_configs WHERE table_id = ?', [ws.tableId]);
    await dbRun('DELETE FROM table_columns WHERE table_id = ?', [ws.tableId]);
    await dbRun('DELETE FROM universal_tables WHERE id = ?', [ws.tableId]);
    await dbRun('DELETE FROM projects WHERE id = ?', [ws.projectId]);
    await dbRun('DELETE FROM spaces WHERE id = ?', [ws.spaceId]);
    await dbRun('DELETE FROM users WHERE id = ?', [ownerId]);
    await destroyAdapter();
  });

  test('404 when the table has no published (custom) form', async () => {
    await publishForm(ws.tableId, config, 'add_row');
    await request(app).get(`/api/v3/public/forms/${ws.tableId}`).expect(404);
  });

  test('external form: anonymous GET returns only client-facing fields and columns', async () => {
    await publishForm(ws.tableId, config);
    const res = await request(app).get(`/api/v3/public/forms/${ws.tableId}`).expect(200);
    const { table, columns, config: cfg, viewer } = res.body.data;
    expect(table.name).toBe('Возвраты');
    expect(viewer.authenticated).toBe(false);
    expect(cfg.settings.access).toBe('external');
    // hidden fields without urlParam are not shipped as columns; the urlParam one is
    expect(columns.map((c) => c.column_name).sort()).toEqual(['amount', 'order_no', 'source']);
    // hidden-field defaults never leave the server
    const statusField = cfg.fields.find((f) => f.id === 'f3');
    expect(statusField.defaultValue).toBeUndefined();
  });

  test('internal form (default): anonymous → 401, stranger → 403, owner → 200', async () => {
    await publishForm(ws.tableId, { ...config, settings: { viewMode: 'standard' } });
    const anon = await request(app).get(`/api/v3/public/forms/${ws.tableId}`).expect(401);
    expect(anon.body.error.code).toBe('AUTH_REQUIRED');

    const strangerId = await createUser();
    try {
      await request(app).get(`/api/v3/public/forms/${ws.tableId}`)
        .set('Authorization', bearer(strangerId)).expect(403);
    } finally {
      await dbRun('DELETE FROM users WHERE id = ?', [strangerId]);
    }

    const ok = await request(app).get(`/api/v3/public/forms/${ws.tableId}`)
      .set('Authorization', bearer(ownerId)).expect(200);
    expect(ok.body.data.viewer.authenticated).toBe(true);
  });

  test('open form: anonymous → 401, any signed-in user → 200', async () => {
    await publishForm(ws.tableId, { ...config, settings: { access: 'open' } });
    await request(app).get(`/api/v3/public/forms/${ws.tableId}`).expect(401);
    const strangerId = await createUser();
    try {
      const res = await request(app).get(`/api/v3/public/forms/${ws.tableId}`)
        .set('Authorization', bearer(strangerId)).expect(200);
      expect(res.body.data.config.settings.access).toBe('open');
    } finally {
      await dbRun('DELETE FROM users WHERE id = ?', [strangerId]);
    }
  });

  test('external form: submit writes client fields, server defaults, and URL-allowed hidden field', async () => {
    await publishForm(ws.tableId, config);
    const res = await request(app)
      .post(`/api/v3/public/forms/${ws.tableId}/submit`)
      .send({ data: {
        order_no: 'A-1',
        [cols.amount]: 150,
        status: 'hacked',            // hidden, not urlParam → ignored
        source: 'telegram',          // hidden + urlParam → accepted
        not_a_column: 'x',           // unknown → dropped
      } })
      .expect(201);
    expect(res.body.data.id).toBeTruthy();

    const row = await dbGet('SELECT data, created_by FROM table_rows WHERE id = ?', [res.body.data.id]);
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    expect(data[cols.order]).toBe('A-1');
    expect(data[cols.amount]).toBe(150);
    expect(data[cols.status]).toBe('new');
    expect(data[cols.source]).toBe('telegram');
    expect(typeof data[cols.date]).toBe('string');
    expect(Number.isNaN(Date.parse(data[cols.date]))).toBe(false);
    expect(Object.keys(data)).not.toContain('not_a_column');
    expect(row.created_by).toBeNull();
  });

  test('external form: missing required field → 400 with field names', async () => {
    await publishForm(ws.tableId, config);
    const res = await request(app)
      .post(`/api/v3/public/forms/${ws.tableId}/submit`)
      .send({ data: { amount: 1 } })
      .expect(400);
    expect(res.body.error.code).toBe('REQUIRED_FIELD_MISSING');
    expect(res.body.error.details.fields).toEqual(['order_no']);
  });

  test('internal form: anonymous submit → 401, owner submit stamps created_by', async () => {
    await publishForm(ws.tableId, { ...config, settings: {} });
    await request(app).post(`/api/v3/public/forms/${ws.tableId}/submit`)
      .send({ data: { order_no: 'B-2' } }).expect(401);
    const res = await request(app).post(`/api/v3/public/forms/${ws.tableId}/submit`)
      .set('Authorization', bearer(ownerId))
      .send({ data: { order_no: 'B-2' } }).expect(201);
    const row = await dbGet('SELECT created_by FROM table_rows WHERE id = ?', [res.body.data.id]);
    expect(row.created_by).toBe(ownerId);
  });
});

describe('publicFormSubmission helpers', () => {
  test('resolveFormAccess falls back to internal', () => {
    expect(resolveFormAccess(undefined)).toBe('internal');
    expect(resolveFormAccess({ settings: { access: 'public' } })).toBe('internal');
    expect(resolveFormAccess({ settings: { access: 'open' } })).toBe('open');
    expect(resolveFormAccess({ settings: { access: 'external' } })).toBe('external');
  });

  test('buildSubmissionData: readonly field ignores client value, {{user}} resolves, column copy works', () => {
    const columns = [
      { id: 1, column_name: 'title' },
      { id: 2, column_name: 'owner' },
      { id: 3, column_name: 'copy' },
    ];
    const config = { fields: [
      { columnId: '1', readonly: true, defaultValue: 'fixed' },
      { columnId: '2', hidden: true, defaultValue: '{{user}}' },
      { columnId: '3', hidden: true, defaultValue: '{{title}}' },
    ] };
    const { data, missing } = buildSubmissionData({ config, columns, input: { title: 'client', '2': 999 }, userId: 42 });
    expect(missing).toEqual([]);
    expect(data).toEqual({ 1: 'fixed', 2: 42, 3: 'client' });
  });
});
