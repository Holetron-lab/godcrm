// @vitest-environment node
// QA-21021-02: exercise real SQL with the missing-FK contour seen on staging.
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest';
import express from 'express';
import request from 'supertest';
import projectsRoutes from '../projects.js';
import registerSpaceCrud from '../spaces/crud.js';
import { deleteProject } from '../../../services/ProjectService.js';
import { deleteSpace } from '../../../services/SpaceService.js';
import { dbGet, dbRun, resetAdapter, destroyAdapter } from '../../../database/connection.js';

const schema = `qa_parent_delete_${randomUUID().replaceAll('-', '')}`;
const app = express();
let user;
app.use((req, _res, next) => { req.user = user; next(); });
app.use('/projects', projectsRoutes);
const spaces = express.Router();
registerSpaceCrud(spaces);
app.use('/spaces', spaces);

beforeAll(async () => {
  await resetAdapter();
  const actual = await dbGet('SELECT current_database() AS name');
  expect(actual.name).toBe('godcrm_test');
  await dbRun(`CREATE SCHEMA ${schema}`);
  const url = new URL(`postgresql://${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT}/${actual.name}`);
  url.username = process.env.POSTGRES_USER;
  url.password = process.env.POSTGRES_PASSWORD;
  url.searchParams.set('options', `-c search_path=${schema}`);
  await resetAdapter({ connectionString: url.toString() });
  for (const table of ['spaces', 'projects', 'dashboards', 'universal_tables', 'table_columns', 'table_rows', 'widgets']) {
    // LIKE copies column types/defaults, deliberately NOT foreign keys.
    await dbRun(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS)`);
  }
});

afterAll(async () => {
  await dbRun(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await destroyAdapter();
});

beforeEach(async () => {
  user = { id: 101, role: 'user' };
  await dbRun('TRUNCATE spaces, projects, dashboards, universal_tables, table_columns, table_rows, widgets');
  await dbRun("INSERT INTO spaces (id, owner_id, name, type) VALUES (1, 101, 'manual-qa-parent', 'personal')");
  await dbRun("INSERT INTO projects (id, owner_id, space_id, name, type) VALUES (2, 101, 1, 'manual-qa-child', 'project')");
});

describe('parent DELETE without database cascades', () => {
  test.each(['dashboards', 'universal_tables'])('project with %s refuses deletion and retains children', async (table) => {
    await dbRun(`INSERT INTO ${table} (id, project_id, name) VALUES (3, 2, 'manual-qa-child')`);
    const res = await request(app).delete('/projects/2').expect(409);
    expect(res.body.error.code).toBe('PROJECT_NOT_EMPTY');
    expect(await dbGet('SELECT id FROM projects WHERE id = 2')).toEqual({ id: 2 });
    expect(await dbGet(`SELECT project_id FROM ${table} WHERE id = 3`)).toEqual({ project_id: 2 });
  });

  test('space with a project refuses deletion and retains the entire nested tree', async () => {
    await dbRun("INSERT INTO universal_tables (id, project_id, name) VALUES (3, 2, 'manual-qa-table')");
    await dbRun("INSERT INTO table_columns (id, table_id, column_name, type) VALUES (4, 3, 'title', 'text')");
    await dbRun("INSERT INTO table_rows (id, table_id, base_id, data) VALUES (5, 3, 'qa-parent-delete', '{}')");
    const res = await request(app).delete('/spaces/1').expect(409);
    expect(res.body.error.code).toBe('SPACE_NOT_EMPTY');
    for (const table of ['spaces', 'projects', 'universal_tables', 'table_columns', 'table_rows']) {
      expect(Number((await dbGet(`SELECT count(*) AS n FROM ${table}`)).n)).toBe(1);
    }
  });

  test('space dashboard alone prevents deletion, including its widget', async () => {
    await dbRun('DELETE FROM projects');
    await dbRun("INSERT INTO dashboards (id, space_id, name) VALUES (3, 1, 'manual-qa-overview')");
    await dbRun("INSERT INTO widgets (id, dashboard_id, owner_kind, owner_id, widget_type, title) VALUES (4, 3, 'space', 1, 'preset', 'manual-qa-widget')");
    await request(app).delete('/spaces/1').expect(409);
    expect(await dbGet('SELECT id FROM spaces WHERE id = 1')).toEqual({ id: 1 });
    expect(await dbGet('SELECT dashboard_id FROM widgets WHERE id = 4')).toEqual({ dashboard_id: 3 });
  });

  test('direct service calls enforce the same refusal', async () => {
    await dbRun("INSERT INTO dashboards (id, project_id, name) VALUES (3, 2, 'manual-qa-dashboard')");
    await expect(deleteProject(2)).rejects.toMatchObject({ code: 'PROJECT_NOT_EMPTY' });
    await expect(deleteSpace(1)).rejects.toMatchObject({ code: 'SPACE_NOT_EMPTY' });
  });

  test('empty parents remain deletable, with unrelated children preserved', async () => {
    await dbRun("INSERT INTO dashboards (id, project_id, space_id, name) VALUES (3, 99, 99, 'unrelated')");
    await request(app).delete('/projects/2').expect(200);
    await request(app).delete('/spaces/1').expect(200);
    expect(await dbGet('SELECT id FROM projects WHERE id = 2')).toBeNull();
    expect(await dbGet('SELECT id FROM spaces WHERE id = 1')).toBeNull();
    expect(await dbGet('SELECT id FROM dashboards WHERE id = 3')).toEqual({ id: 3 });
  });

  test.each(['projects', 'spaces'])('%s preserves authorization and not-found responses', async (parent) => {
    user = { id: 999, role: 'user' };
    const id = parent === 'projects' ? 2 : 1;
    await request(app).delete(`/${parent}/${id}`).expect(403);
    await request(app).delete(`/${parent}/999`).expect(404);
    expect(await dbGet(`SELECT id FROM ${parent} WHERE id = ?`, [id])).toEqual({ id });
  });

  test.each(['projects', 'spaces'])('%s rejects malformed IDs without deleting a valid prefix', async (parent) => {
    await request(app).delete(`/${parent}/2oops`).expect(400);
    await request(app).delete(`/${parent}/0`).expect(400);
  });

  test('system projects remain protected', async () => {
    await dbRun("UPDATE projects SET type = 'personal_space' WHERE id = 2");
    await request(app).delete('/projects/2').expect(403);
  });
});
