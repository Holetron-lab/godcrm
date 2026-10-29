// @vitest-environment node
import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import router from '../columns.js';
import { dbAll, dbGet, dbRun } from '../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../tests/helpers/workspace-fixture.js';
import { columnToolHandlers } from '../../../services/agent-tools/column-tools.js';
import { dataToolHandlers } from '../../../services/agent-tools/data-tools.js';
import { ImportService } from '../../../services/ImportService.js';
import { COLUMN_TYPE_ALIASES } from '../../../../shared/column-types.js';

let ws;
const app = express();
app.use(express.json());
app.use('/api/v3', (req, _res, next) => { req.user = { id: ws.userId, role: 'owner' }; next(); }, router);
const types = [...Object.entries(COLUMN_TYPE_ALIASES), ...['datetime', 'image', 'audio', 'apiKey', 'array', 'id', 'link'].map(type => [type, type])];

beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  const schema = await dbAll("SELECT column_name FROM information_schema.columns WHERE table_name = 'table_columns'");
  expect(schema.some(c => c.column_name === 'type')).toBe(true);
});
beforeEach(async () => { ws = await createEphemeralWorkspace({ label: 'type-compat', dashboard: false }); });
afterEach(async () => { await ws?.cleanup(); });

describe('ADR-204 compatible column writers', () => {
  it('MCP create_table uses the same aliases and rejects unknown definitions atomically', async () => {
    const result = await dataToolHandlers.create_table({ project_id: ws.projectId, name: 'compatible', show_in_nav: false,
      columns: types.map(([type]) => ({ name: type.toLowerCase(), type })) }, ws.userId);
    const columns = await dbAll('SELECT type FROM table_columns WHERE table_id = ? ORDER BY order_index', [result.table_id]);
    expect(columns.map(c => c.type)).toEqual(types.map(([, canonical]) => canonical));
    await expect(dataToolHandlers.create_table({ project_id: ws.projectId, name: 'rejected', show_in_nav: false,
      columns: [{ name: 'bad', type: 'unknown' }] }, ws.userId)).rejects.toThrow();
    expect(await dbGet("SELECT id FROM universal_tables WHERE project_id = ? AND name = 'rejected'", [ws.projectId])).toBeFalsy();
  });
  it.each(types)('REST persists %s as %s on create and patch', async (input, canonical) => {
    const create = await request(app).post(`/api/v3/tables/${ws.tableId}/columns`)
      .send({ name: 'value', display_name: 'Value', column_type: input });
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    const id = create.body.data.id;
    expect((await dbGet('SELECT type FROM table_columns WHERE id = ?', [id])).type).toBe(canonical);
    const patch = await request(app).patch(`/api/v3/tables/${ws.tableId}/columns/${id}`)
      .send({ column_type: input });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    expect(patch.body.data.column_type).toBe(canonical);
  });

  it.each(types)('MCP persists %s as %s on create and update', async (input, canonical) => {
    const result = await columnToolHandlers.manage_columns({ table_id: ws.tableId, action: 'create', name: 'Value', type: input }, ws.userId);
    expect(result.success).toBe(true);
    expect((await dbGet('SELECT type FROM table_columns WHERE id = ?', [result.column_id])).type).toBe(canonical);
    const update = await columnToolHandlers.manage_columns({ table_id: ws.tableId, column_id: result.column_id, action: 'update', type: input }, ws.userId);
    expect(update.success).toBe(true);
    expect((await dbGet('SELECT type FROM table_columns WHERE id = ?', [result.column_id])).type).toBe(canonical);
  });

  it('imports aliases without modifying values, settings or readonly flags', async () => {
    const data = Object.fromEntries(types.map(([type]) => [type, 'first\nsecond']));
    const result = await ImportService.importTable(ws.projectId, {
      type: 'table', table: { name: 'Imported' },
      columns: types.map(([type]) => ({ name: type, columnType: type, config: { custom: true }, isReadonly: true })),
      rows: [data],
    });
    const columns = await dbAll('SELECT column_name, type, config, is_readonly FROM table_columns WHERE table_id = ?', [result.tableId]);
    for (const [input, canonical] of types) {
      const column = columns.find(c => c.column_name === input);
      expect(column.type).toBe(canonical);
      expect(JSON.parse(column.config)).toEqual({ custom: true });
      expect(Boolean(column.is_readonly)).toBe(true);
    }
    expect((await dbGet('SELECT data FROM table_rows WHERE table_id = ?', [result.tableId])).data).toEqual(data);
  });

  it.each(['unknown', 'constructor', '', null, 123])('rejects invalid type %j without a partial metadata update', async type => {
    const id = (await dbRun("INSERT INTO table_columns (table_id, column_name, type, display_name) VALUES (?, 'value', 'text', 'Original')", [ws.tableId])).lastInsertRowid;
    const response = await request(app).patch(`/api/v3/tables/${ws.tableId}/columns/${id}`)
      .send({ column_type: type, display_name: 'Changed' });
    expect(response.status).toBe(400);
    const result = await columnToolHandlers.manage_columns({ table_id: ws.tableId, column_id: id, action: 'update', type, name: 'Changed' }, ws.userId);
    expect(result.error).toBeTruthy();
    expect(await dbGet('SELECT type, display_name FROM table_columns WHERE id = ?', [id])).toEqual({ type: 'text', display_name: 'Original' });
  });

  it('rejects an unknown imported type and rolls back the new table', async () => {
    await expect(ImportService.importTable(ws.projectId, { type: 'table', table: { name: 'Rejected' }, columns: [{ name: 'value', columnType: 'unknown' }], rows: [] })).rejects.toThrow(/Unknown column type/);
    expect(await dbGet("SELECT id FROM universal_tables WHERE project_id = ? AND name = 'Rejected'", [ws.projectId])).toBeFalsy();
  });
});
