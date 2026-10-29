// @vitest-environment node
// EffectiveRoleService against the REAL user_access_permissions schema.
//
// The service was written for a phantom `resource_type / resource_id / permission`
// layout; the live table (migration 009) stores the level in
// `space_id / project_id / table_id / column_id` and the role in `access_level`.
// Every caller mocked `canAdminister`, so the drift only surfaced in production
// as `column "permission" does not exist` on POST /messages/move (chat 3662).
// This suite runs the queries against godcrm_test on purpose — no mocks.

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralWorkspace } from '../../tests/helpers/workspace-fixture.js';
import { dbRun, destroyAdapter, resetAdapter, toBool } from '../../database/connection.js';
import { getEffectiveRole, canAdminister, getUsersWithRoles } from '../EffectiveRoleService.js';

let ws;
let granteeId;
let strangerId;

async function insertUser(label) {
  const row = await dbRun(
    `INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified)
     VALUES (?, ?, ?, ?, ?)`,
    [`test-${label}-${ws.token}@test.godcrm.local`, 'test-hash', `Test ${label}`, 'test-encrypted-key', toBool(true)]
  );
  return row.lastInsertRowid;
}

beforeAll(async () => {
  await resetAdapter();
  ws = await createEphemeralWorkspace({ label: 'effrole' });
  granteeId = await insertUser('effrole-grantee');
  strangerId = await insertUser('effrole-stranger');
  await dbRun(
    'INSERT INTO user_access_permissions (user_id, space_id, access_level, granted_by) VALUES (?, ?, ?, ?)',
    [granteeId, ws.spaceId, 'admin', ws.userId]
  );
  await dbRun(
    'INSERT INTO user_access_permissions (user_id, project_id, access_level, granted_by) VALUES (?, ?, ?, ?)',
    [granteeId, ws.projectId, 'viewer', ws.userId]
  );
  await dbRun(
    'INSERT INTO user_access_permissions (user_id, table_id, access_level, granted_by) VALUES (?, ?, ?, ?)',
    [granteeId, ws.tableId, 'denied', ws.userId]
  );
});

afterAll(async () => {
  await dbRun('DELETE FROM user_access_permissions WHERE user_id IN (?, ?)', [granteeId, strangerId]);
  await dbRun('DELETE FROM users WHERE id IN (?, ?)', [granteeId, strangerId]);
  await ws.cleanup();
  await destroyAdapter();
});

describe('getEffectiveRole on the live schema', () => {
  test('space creator is owner_owner without any grant row', async () => {
    const r = await getEffectiveRole(ws.userId, { spaceId: ws.spaceId });
    expect(r).toMatchObject({ effectiveRole: 'owner_owner', source: 'space' });
  });

  test('space-level grant resolves through space_id / access_level', async () => {
    const r = await getEffectiveRole(granteeId, { spaceId: ws.spaceId });
    expect(r).toMatchObject({ effectiveRole: 'admin', source: 'space' });
  });

  test('most specific level wins: project viewer overrides space admin', async () => {
    const r = await getEffectiveRole(granteeId, { projectId: ws.projectId });
    expect(r).toMatchObject({ effectiveRole: 'viewer', source: 'project' });
  });

  test('denied at table level blocks regardless of parent roles', async () => {
    const r = await getEffectiveRole(granteeId, { tableId: ws.tableId });
    expect(r).toMatchObject({ effectiveRole: 'denied', source: 'table' });
  });

  test('user with no grant row is denied (closed space)', async () => {
    const r = await getEffectiveRole(strangerId, { spaceId: ws.spaceId });
    expect(r).toMatchObject({ effectiveRole: 'denied', source: 'none' });
  });
});

describe('canAdminister — the gate behind POST /messages/move', () => {
  test('resolves instead of throwing, true for space admin, false for stranger', async () => {
    await expect(canAdminister(granteeId, { spaceId: ws.spaceId })).resolves.toBe(true);
    await expect(canAdminister(strangerId, { spaceId: ws.spaceId })).resolves.toBe(false);
  });
});

describe('getUsersWithRoles on the live schema', () => {
  test('lists owner_owner and every explicit grant inside the space', async () => {
    const users = await getUsersWithRoles(ws.spaceId);
    const byId = Object.fromEntries(users.map(u => [Number(u.userId), u]));

    expect(byId[Number(ws.userId)]).toMatchObject({ effectiveRole: 'owner_owner' });
    expect(byId[Number(granteeId)]).toMatchObject({ effectiveRole: 'admin' });
    expect(byId[Number(granteeId)].roles).toEqual({
      space: [{ role: 'admin', resourceId: expect.anything() }],
      project: [{ role: 'viewer', resourceId: expect.anything() }],
      table: [{ role: 'denied', resourceId: expect.anything() }]
    });
    expect(byId[Number(strangerId)]).toBeUndefined();
    // owner_owner sorts first
    expect(Number(users[0].userId)).toBe(Number(ws.userId));
  });
});
