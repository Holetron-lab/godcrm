// GET /api/v3/data-sources?workspace_id= — read access for space members.
//
// Regression for the crm.hltrn.cc /spaces report (2026-09-25): the SPA lists
// data sources for every space it opens (DataSourcesNav / TableToolbar), but the
// route's SEC-2 gate only admitted the space owner or a global admin, so an
// invited member got 403 on every space they were granted into.
//
// Runs against godcrm_test (ADR-0009): the grant lives in
// user_access_permissions and is resolved by the canonical
// checkUserSpaceAccess(), not by application-level mocks.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { dbRun } from '../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../tests/helpers/workspace-fixture.js';
import dataSourcesRoutesV3 from '../data-sources.js';

let app, owner, member, outsider;

const list = (spaceId, user) =>
  request(app).get(`/api/v3/data-sources?workspace_id=${spaceId}`).set('x-user-id', String(user.userId)).set('x-user-role', user.role || 'user');

beforeAll(async () => {
  owner = await createEphemeralWorkspace({ dashboard: false, table: false, label: 'ds-owner' });
  member = await createEphemeralWorkspace({ dashboard: false, table: false, label: 'ds-member' });
  outsider = await createEphemeralWorkspace({ dashboard: false, table: false, label: 'ds-outsider' });
  await dbRun(
    `INSERT INTO user_access_permissions (user_id, space_id, access_level, granted_by) VALUES (?, ?, 'viewer', ?)`,
    [member.userId, owner.spaceId, owner.userId]
  );

  app = express();
  app.use((req, _res, next) => { req.user = { id: Number(req.headers['x-user-id']), role: req.headers['x-user-role'] }; next(); });
  app.use('/api/v3/data-sources', dataSourcesRoutesV3);
});

afterAll(async () => {
  await dbRun(`DELETE FROM user_access_permissions WHERE space_id = ?`, [owner.spaceId]);
  await outsider?.cleanup();
  await member?.cleanup();
  await owner?.cleanup();
});

describe('GET /data-sources?workspace_id — space read access', () => {
  it('owner lists their space', async () => {
    const res = await list(owner.spaceId, owner);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('member with an explicit grant lists the space (was 403)', async () => {
    const res = await list(owner.spaceId, member);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('user without a grant still gets 403', async () => {
    const res = await list(owner.spaceId, outsider);
    expect(res.status).toBe(403);
  });

  it('project_id resolves to its space and applies the same gate', async () => {
    const ok = await request(app).get(`/api/v3/data-sources?project_id=${owner.projectId}`).set('x-user-id', String(member.userId)).set('x-user-role', 'user');
    expect(ok.status).toBe(200);
    const no = await request(app).get(`/api/v3/data-sources?project_id=${owner.projectId}`).set('x-user-id', String(outsider.userId)).set('x-user-role', 'user');
    expect(no.status).toBe(403);
  });
});
