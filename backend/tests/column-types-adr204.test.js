// @vitest-environment node
/**
 * ADR-204 Stage 2a — dictionary keys, value/config validators, and the
 * REST / MCP / row write paths for `content` and `contact` (ticket 254364
 * AC1, AC2, AC3, AC8). DB-backed parts run on godcrm_test fixture rows.
 */
import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import knex from 'knex';
import router from '../routes/v3/columns.js';
import { dbGet, dbRun } from '../database/connection.js';
import { createEphemeralWorkspace } from './helpers/workspace-fixture.js';
import { columnToolHandlers } from '../services/agent-tools/column-tools.js';
import { ImportService } from '../services/ImportService.js';
import { validateAllColumns } from '../services/SelectValueResolver.js';
import { up } from '../database/migrations/knex/104_adr_0204_s2_content_contact_types.js';
import {
  COLUMN_TYPES, COLUMN_TYPE_ALIASES, persistColumnType, validateColumnValue, validateColumnConfig,
} from '../services/ColumnService.js';
import { verifyContentValue } from '../services/column-adapters/media-kind.js';

describe('dictionary (AC1)', () => {
  it('content and contact are canonical keys; legacy types are not their aliases', () => {
    expect(COLUMN_TYPES).toContain('content');
    expect(COLUMN_TYPES).toContain('contact');
    for (const legacy of ['image', 'audio', 'email', 'phone', 'user']) {
      expect(COLUMN_TYPES).toContain(legacy);
      expect(COLUMN_TYPE_ALIASES[legacy]).toBeUndefined();
      expect(persistColumnType(legacy)).toBe(legacy);
    }
    expect(COLUMN_TYPE_ALIASES.person).toBe('user');
    expect(persistColumnType('content')).toBe('content');
    expect(persistColumnType('contact')).toBe('contact');
  });
});

describe('value validators (AC2)', () => {
  const content = (value) => validateColumnValue({ type: 'content', config: {} }, value);
  const contact = (value, config = {}) => validateColumnValue({ type: 'contact', config }, value);

  it('content: null or ordered array of {url, kind} with optional string metadata', () => {
    expect(content(null)).toBe(true);
    expect(content([{ url: 'a.jpg', kind: 'image' }, { url: 'b.mp3', kind: 'audio', title: 't', performer: 'p', poster: 'c.jpg' }])).toBe(true);
    expect(content([])).toBe(false);
    expect(content('a.jpg')).toBe(false);
    expect(content([{ url: '', kind: 'image' }])).toBe(false);
    expect(content([{ url: 'a.jpg', kind: 'gif' }])).toBe(false);
    expect(content([{ url: 'a.jpg', kind: 'image', title: 7 }])).toBe(false);
  });

  it('contact: external needs typed fields, linked needs a source; table needs tableId+idColumn', () => {
    expect(contact(null)).toBe(true);
    expect(contact([{ kind: 'external', fields: { email: 'a@b.c' } }])).toBe(true);
    expect(contact([{ kind: 'external', fields: {} }])).toBe(false);
    expect(contact([{ kind: 'external', fields: { phone: 7 } }])).toBe(false);
    expect(contact([{ kind: 'linked', source: 'system', id: 3 }])).toBe(true);
    expect(contact([{ kind: 'linked', source: 'table', id: 'r1' }])).toBe(false);
    expect(contact([{ kind: 'linked', source: 'table', id: 'r1', tableId: 100, idColumn: 'id' }])).toBe(true);
    expect(contact([{ kind: 'linked', source: 'ldap', id: 1 }])).toBe(false);
    expect(contact([{ kind: 'other' }])).toBe(false);
  });

  it('contact: single column holds at most one element unless allowMultiple', () => {
    const two = [{ kind: 'external', fields: { email: 'a@b.c' } }, { kind: 'linked', source: 'system', id: 1 }];
    expect(contact(two)).toBe(false);
    expect(contact(two, { allowMultiple: true })).toBe(true);
    expect(contact(two, { contact: { version: 1, allowMultiple: true } })).toBe(true);
  });

  it('config: version 1 and a known mode are stamped; bad values are refused', () => {
    expect(validateColumnConfig('content', { image: {} })).toEqual({ ok: true, normalized: { image: {}, content: { version: 1, mode: 'gallery' } } });
    expect(validateColumnConfig('content', { content: { mode: 'audio' } }).normalized.content).toEqual({ version: 1, mode: 'audio' });
    expect(validateColumnConfig('content', { content: { mode: 'carousel' } }).ok).toBe(false);
    expect(validateColumnConfig('content', { content: { version: 2 } }).ok).toBe(false);
    expect(validateColumnConfig('contact', null)).toEqual({ ok: true, normalized: { contact: { version: 1 } } });
    expect(validateColumnConfig('text', { any: 1 })).toEqual({ ok: true, normalized: { any: 1 } });
  });

  it('media kind: payload kind is checked against the file, never trusted', async () => {
    const resolve = async (url) => ({ '/uploads/spaces/1/a.png': 'image', 'https://x/clip.mp4': 'video' }[url] ?? null);
    expect(await verifyContentValue([{ url: '/uploads/spaces/1/a.png', kind: 'image' }], resolve)).toEqual([]);
    expect(await verifyContentValue([{ url: '/uploads/spaces/1/a.png', kind: 'audio' }], resolve)).toEqual(['item 0: declared audio but the file is image']);
    expect(await verifyContentValue([{ url: 'https://x/blob', kind: 'image' }], resolve)).toHaveLength(1);
    expect(await verifyContentValue(null, resolve)).toEqual([]);
  });
});

describe('write paths on godcrm_test (AC3, AC8)', () => {
  let ws;
  const app = express();
  app.use(express.json());
  app.use('/api/v3', (req, _res, next) => { req.user = { id: ws.userId, role: 'owner' }; next(); }, router);

  beforeAll(async () => {
    expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
    const db = knex({ client: 'pg', connection: {
      host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT), database: process.env.POSTGRES_DB,
      user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
    } });
    try { await up(db); } finally { await db.destroy(); }
  });
  beforeEach(async () => { ws = await createEphemeralWorkspace({ label: 'adr204-write', dashboard: false }); });
  afterEach(async () => { await ws?.cleanup(); });

  it('REST creates content/contact with the versioned config block, rejects a bad mode', async () => {
    const create = await request(app).post(`/api/v3/tables/${ws.tableId}/columns`)
      .send({ name: 'media', display_name: 'Media', column_type: 'content' });
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    const stored = await dbGet('SELECT type, config FROM table_columns WHERE id = ?', [create.body.data.id]);
    expect(stored.type).toBe('content');
    expect(JSON.parse(stored.config).content).toEqual({ version: 1, mode: 'gallery' });

    const bad = await request(app).post(`/api/v3/tables/${ws.tableId}/columns`)
      .send({ name: 'bad', display_name: 'Bad', column_type: 'content', config: { content: { mode: 'carousel' } } });
    expect(bad.status).toBe(400);

    const patch = await request(app).patch(`/api/v3/tables/${ws.tableId}/columns/${create.body.data.id}`)
      .send({ column_type: 'contact' });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    expect(patch.body.data.column_type).toBe('contact');
    expect(patch.body.data.config.contact).toEqual({ version: 1 });
  });

  it('MCP manage_columns persists the keys and the config block', async () => {
    const result = await columnToolHandlers.manage_columns({ table_id: ws.tableId, action: 'create', name: 'Who', type: 'contact' }, ws.userId);
    expect(result.success).toBe(true);
    const stored = await dbGet('SELECT type, config FROM table_columns WHERE id = ?', [result.column_id]);
    expect(stored.type).toBe('contact');
    expect(JSON.parse(stored.config).contact).toEqual({ version: 1 });
    const update = await columnToolHandlers.manage_columns({ table_id: ws.tableId, column_id: result.column_id, action: 'update', type: 'content', config: { content: { mode: 'audio' } } }, ws.userId);
    expect(update.success).toBe(true);
    const switched = await dbGet('SELECT type, config FROM table_columns WHERE id = ?', [result.column_id]);
    expect(switched.type).toBe('content');
    expect(JSON.parse(switched.config)).toMatchObject({ icon: '📝', contact: { version: 1 }, content: { version: 1, mode: 'audio' } });
    expect(await columnToolHandlers.manage_columns({ table_id: ws.tableId, action: 'create', name: 'Nope', type: 'content', config: { content: { version: 3 } } }, ws.userId)).toMatchObject({ error: expect.stringMatching(/version/) });
  });

  it('row validation verifies media against the files registry and the extension allow-list', async () => {
    await dbRun("INSERT INTO table_columns (table_id, column_name, display_name, type, config) VALUES (?, 'media', 'Media', 'content', '{\"content\":{\"version\":1,\"mode\":\"gallery\"}}')", [ws.tableId]);
    const url = `/uploads/spaces/${ws.spaceId}/adr204-${ws.token}.bin`;
    await dbRun('INSERT INTO files (id, name, original_name, mime_type, size, path, url, space_id) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
      [`adr204-${ws.token}`, 'x.bin', 'x.bin', 'image/png', '/tmp/x.bin', url, ws.spaceId]);
    try {
      expect((await validateAllColumns(ws.tableId, { media: [{ url, kind: 'image' }] })).errors).toEqual([]);
      expect((await validateAllColumns(ws.tableId, { media: [{ url, kind: 'video' }] })).errors[0]).toMatch(/declared video but the file is image/);
      expect((await validateAllColumns(ws.tableId, { media: [{ url: 'https://cdn/x.mp3', kind: 'audio' }] })).errors).toEqual([]);
      expect((await validateAllColumns(ws.tableId, { media: [{ url: '/uploads/spaces/1/unknown.png', kind: 'image' }] })).errors).toEqual([]); // unregistered path: extension fallback
      expect((await validateAllColumns(ws.tableId, { media: [{ url: 'https://cdn/blob', kind: 'image' }] })).errors[0]).toMatch(/cannot be verified/);
      expect((await validateAllColumns(ws.tableId, { media: 'https://cdn/x.jpg' })).errors[0]).toMatch(/invalid content value/);
      expect((await validateAllColumns(ws.tableId, { media: null })).errors).toEqual([]);
    } finally {
      await dbRun('DELETE FROM files WHERE id = ?', [`adr204-${ws.token}`]);
    }
  });

  it('import rolls back on an inadmissible content value', async () => {
    const payload = (value) => ({ type: 'table', table: { name: `Imported ${ws.token}` },
      columns: [{ name: 'media', columnType: 'content', config: { content: { version: 1, mode: 'gallery' } } }], rows: [{ media: value }] });
    await expect(ImportService.importTable(ws.projectId, payload([{ url: 'https://cdn/blob', kind: 'image' }]))).rejects.toThrow(/cannot be verified/);
    expect(await dbGet("SELECT id FROM universal_tables WHERE project_id = ? AND name = ?", [ws.projectId, `Imported ${ws.token}`])).toBeFalsy();
    const ok = await ImportService.importTable(ws.projectId, payload([{ url: 'https://cdn/x.jpg', kind: 'image' }]));
    expect(ok.rowsImported).toBe(1);
  });
});
