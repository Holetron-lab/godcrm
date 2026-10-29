/**
 * Add-widget picker sources — GET /spaces/:id/widgets-available and
 * GET /spaces/:id/tables-available. Regression for the 404 after 858a5a11
 * unmounted the modules router the picker depended on.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import spacesRoutes from '../index.js';
import { dbRun } from '../../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../../tests/helpers/workspace-fixture.js';

const app = express();
app.use(express.json());
let currentUser = { id: 0, role: 'user' };
app.use((req, _res, next) => {
  req.user = currentUser;
  next();
});
app.use('/api/v3/spaces', spacesRoutes);

const as = (id, role = 'user') => { currentUser = { id, role }; };

describe('Add-widget picker sources', () => {
  let ws;        // populated space: one widget, one nav table
  let other;     // second space owned by another user
  let widgetId;

  beforeAll(async () => {
    ws = await createEphemeralWorkspace({ label: 'widget-src' });
    other = await createEphemeralWorkspace({ label: 'widget-src-other' });

    const w = await dbRun(
      `INSERT INTO widgets (dashboard_id, widget_type, preset_name, title, config, position, owner_kind, owner_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [ws.dashboardId, 'preset', 'table_view', `Picker Widget ${ws.token}`, '{"a":1}', '{"x":0,"y":0,"w":6,"h":4}', 'dashboard', ws.dashboardId]
    );
    widgetId = w.lastInsertRowid;
    await dbRun('UPDATE universal_tables SET show_in_nav = 1 WHERE id = ?', [ws.tableId]);
    // The other space keeps its table out of nav → its lists are empty.
    await dbRun('UPDATE universal_tables SET show_in_nav = 0 WHERE id = ?', [other.tableId]);
  });

  afterAll(async () => {
    await dbRun('DELETE FROM widgets WHERE id = ?', [widgetId]);
    await other.cleanup();
    await ws.cleanup();
  });

  test('owner sees the space widgets with project info', async () => {
    as(ws.userId);
    const res = await request(app).get(`/api/v3/spaces/${ws.spaceId}/widgets-available`).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      widget_id: widgetId,
      dashboard_id: ws.dashboardId,
      widget_type: 'preset',
      preset_name: 'table_view',
      config: { a: 1 },
      project_id: ws.projectId,
      is_module: false,
      is_pinned: false,
    });
    expect(typeof res.body.data[0].project_name).toBe('string');
  });

  test('owner sees the space nav tables with row_count', async () => {
    as(ws.userId);
    const res = await request(app).get(`/api/v3/spaces/${ws.spaceId}/tables-available`).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      table_id: ws.tableId,
      project_id: ws.projectId,
      is_system: false,
      row_count: 0,
    });
  });

  test('a space without sources returns empty lists, not an error', async () => {
    as(other.userId);
    const widgets = await request(app).get(`/api/v3/spaces/${other.spaceId}/widgets-available`).expect(200);
    const tables = await request(app).get(`/api/v3/spaces/${other.spaceId}/tables-available`).expect(200);
    expect(widgets.body.data).toEqual([]);
    expect(tables.body.data).toEqual([]);
  });

  test('a stranger gets 403 on both lists', async () => {
    as(other.userId);
    for (const path of ['widgets-available', 'tables-available']) {
      const res = await request(app).get(`/api/v3/spaces/${ws.spaceId}/${path}`).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  test('unknown space → 404, garbage id → 400', async () => {
    as(ws.userId);
    await request(app).get('/api/v3/spaces/999999999/widgets-available').expect(404);
    await request(app).get('/api/v3/spaces/abc/tables-available').expect(400);
  });
});
