// @vitest-environment node
/**
 * Passport authority — who may issue / revoke an agent passport.
 *
 * Owner rule (conversation 3692, 2026-09-30): the SAME human must hold both a
 * global admin role (`users.role` ∈ owner|admin) AND admin-level access in the
 * agent's residence space. Neither half alone is sufficient; a global admin who
 * wants to naturalize an agent gets added to that space as admin first.
 *
 * Runs against the real `godcrm_test` chain (user → space → project → table →
 * row → agent user) so the residence JOIN and the three space-admin sources
 * (space owner, access-control table, explicit user_access_permissions grant)
 * are exercised as SQL, not as mocks.
 */
import '../../test/setup.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const { dbRun, toBool } = await import('../../database/connection.js');
const { createEphemeralWorkspace, fixtureToken } = await import('../../tests/helpers/workspace-fixture.js');
const { resolvePassportAuthority } = await import('../passportAuthority.js');

async function insertUser({ role = 'user', user_type = 'human', agentRowId = null, agentTableId = null }) {
  const token = fixtureToken();
  const row = await dbRun(
    `INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified, role, user_type,
                        managed_by_agent_row_id, managed_by_agent_table_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [`test-passport-${token}@test.godcrm.local`, 'test-hash', `Passport ${token}`, 'test-encrypted-key',
      toBool(true), role, user_type, agentRowId, agentTableId]
  );
  return row.lastInsertRowid;
}

let ws;        // residence space of the agent (owner = ws.userId)
let other;     // an unrelated space (owner = other.userId)
let agentRowId;
let agentUserId;
let aclTableId;
const extraUsers = [];

beforeAll(async () => {
  ws = await createEphemeralWorkspace({ label: 'passport-residence' });
  other = await createEphemeralWorkspace({ label: 'passport-other', dashboard: false });

  const row = await dbRun(
    'INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)',
    [ws.tableId, `agent-${ws.token}`, JSON.stringify({ name: 'Fixture Agent', slug: `fixture-agent-${ws.token}` })]
  );
  agentRowId = row.lastInsertRowid;
  agentUserId = await insertUser({ user_type: 'agent', agentRowId, agentTableId: ws.tableId });
  extraUsers.push(agentUserId);

  // A second table in the same project acts as the space's access-control users table.
  const acl = await dbRun('INSERT INTO universal_tables (project_id, name) VALUES (?, ?)',
    [ws.projectId, `ACL ${ws.token}`]);
  aclTableId = acl.lastInsertRowid;
});

afterAll(async () => {
  await dbRun('DELETE FROM user_access_permissions WHERE space_id IN (?, ?)', [ws.spaceId, other.spaceId]);
  await dbRun('DELETE FROM table_rows WHERE table_id = ?', [aclTableId]);
  for (const id of extraUsers) await dbRun('DELETE FROM users WHERE id = ?', [id]);
  await other.cleanup();
  await ws.cleanup();
});

async function actor(role) {
  const id = await insertUser({ role });
  extraUsers.push(id);
  return id;
}

describe('resolvePassportAuthority — residence', () => {
  it('derives the residence space from the stored user → agent row → table → project chain', async () => {
    const res = await resolvePassportAuthority({ actorUserId: ws.userId, userId: agentUserId });
    expect(res.space.id).toBe(ws.spaceId);
    expect(res.agent_row_id).toBe(agentRowId);
  });

  it('accepts a bare agent row id (no user row yet) and resolves the same space', async () => {
    const res = await resolvePassportAuthority({ actorUserId: ws.userId, rowId: agentRowId });
    expect(res.space.id).toBe(ws.spaceId);
  });

  it('fails closed with residence_not_found for a non-agent user id', async () => {
    const res = await resolvePassportAuthority({ actorUserId: ws.userId, userId: ws.userId });
    expect(res).toMatchObject({ allowed: false, reason: 'residence_not_found' });
  });

  it('fails closed when nothing identifies a target', async () => {
    const res = await resolvePassportAuthority({ actorUserId: ws.userId });
    expect(res).toMatchObject({ allowed: false, reason: 'residence_not_found' });
  });
});

describe('resolvePassportAuthority — matrix', () => {
  it('denies an unauthenticated actor', async () => {
    const res = await resolvePassportAuthority({ actorUserId: null, userId: agentUserId });
    expect(res).toMatchObject({ allowed: false, reason: 'not_authenticated' });
  });

  it('denies an agent principal even with a global admin role (no self-naturalization)', async () => {
    const id = await insertUser({ role: 'admin', user_type: 'agent' });
    extraUsers.push(id);
    const res = await resolvePassportAuthority({ actorUserId: id, userId: agentUserId });
    expect(res).toMatchObject({ allowed: false, reason: 'agent_principal' });
  });

  it('space owner WITHOUT a global admin role → denied global_role_required', async () => {
    // ws.userId owns the residence space but has the default global role 'user'.
    const res = await resolvePassportAuthority({ actorUserId: ws.userId, userId: agentUserId });
    expect(res).toMatchObject({
      allowed: false, reason: 'global_role_required',
      actor: { global_admin: false }, space: { id: ws.spaceId, admin: true, via: 'owner' },
    });
  });

  it('space owner WITH global admin role → allowed (via owner)', async () => {
    await dbRun("UPDATE users SET role = 'admin' WHERE id = ?", [ws.userId]);
    const res = await resolvePassportAuthority({ actorUserId: ws.userId, userId: agentUserId });
    expect(res).toMatchObject({
      allowed: true, reason: 'ok',
      actor: { user_id: ws.userId, role: 'admin', global_admin: true },
      space: { id: ws.spaceId, admin: true, via: 'owner' },
    });
  });

  it('global admin with no membership in the residence space → denied space_admin_required', async () => {
    const id = await actor('admin');
    const res = await resolvePassportAuthority({ actorUserId: id, userId: agentUserId });
    expect(res).toMatchObject({
      allowed: false, reason: 'space_admin_required',
      actor: { global_admin: true }, space: { id: ws.spaceId, admin: false, via: null },
    });
  });

  it('global OWNER role is not exempt: owner of a DIFFERENT space is denied for this agent', async () => {
    await dbRun("UPDATE users SET role = 'owner' WHERE id = ?", [other.userId]);
    const res = await resolvePassportAuthority({ actorUserId: other.userId, userId: agentUserId });
    expect(res).toMatchObject({ allowed: false, reason: 'space_admin_required', space: { id: ws.spaceId } });
  });

  it('global admin + explicit admin grant (user_access_permissions) → allowed via explicit_grant', async () => {
    const id = await actor('admin');
    await dbRun('INSERT INTO user_access_permissions (user_id, space_id, access_level) VALUES (?, ?, ?)',
      [id, ws.spaceId, 'admin']);
    const res = await resolvePassportAuthority({ actorUserId: id, userId: agentUserId });
    expect(res).toMatchObject({ allowed: true, reason: 'ok', space: { admin: true, via: 'explicit_grant' } });
  });

  it('global admin + explicit EDITOR grant → denied (admin level required)', async () => {
    const id = await actor('admin');
    await dbRun('INSERT INTO user_access_permissions (user_id, space_id, access_level) VALUES (?, ?, ?)',
      [id, ws.spaceId, 'editor']);
    const res = await resolvePassportAuthority({ actorUserId: id, userId: agentUserId });
    expect(res).toMatchObject({ allowed: false, reason: 'space_admin_required' });
  });

  it('explicit admin grant in a DIFFERENT space does not count', async () => {
    const id = await actor('admin');
    await dbRun('INSERT INTO user_access_permissions (user_id, space_id, access_level) VALUES (?, ?, ?)',
      [id, other.spaceId, 'admin']);
    const res = await resolvePassportAuthority({ actorUserId: id, userId: agentUserId });
    expect(res).toMatchObject({ allowed: false, reason: 'space_admin_required' });
  });

  it('plain user with an explicit admin grant but no global role → denied global_role_required', async () => {
    const id = await actor('user');
    await dbRun('INSERT INTO user_access_permissions (user_id, space_id, access_level) VALUES (?, ?, ?)',
      [id, ws.spaceId, 'admin']);
    const res = await resolvePassportAuthority({ actorUserId: id, userId: agentUserId });
    expect(res).toMatchObject({ allowed: false, reason: 'global_role_required', space: { admin: true } });
  });

  it('global admin mapped to admin through the space access-control table → allowed via access_table', async () => {
    const id = await actor('admin');
    await dbRun('INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)',
      [aclTableId, `acl-${id}`, JSON.stringify({ system_user_id: id, role: 'space-admin' })]);
    await dbRun('UPDATE spaces SET access_control = ? WHERE id = ?', [JSON.stringify({
      enabled: true, users_table_id: aclTableId, role_column_id: 'role',
      role_mappings: [{ columnValue: 'space-admin', accessLevel: 'admin' }, { columnValue: 'reader', accessLevel: 'viewer' }],
    }), ws.spaceId]);

    const res = await resolvePassportAuthority({ actorUserId: id, userId: agentUserId });
    expect(res).toMatchObject({ allowed: true, reason: 'ok', space: { admin: true, via: 'access_table' } });
  });

  it('global admin mapped to VIEWER through the access-control table → denied', async () => {
    const id = await actor('admin');
    await dbRun('INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)',
      [aclTableId, `acl-${id}`, JSON.stringify({ system_user_id: id, role: 'reader' })]);
    const res = await resolvePassportAuthority({ actorUserId: id, userId: agentUserId });
    expect(res).toMatchObject({ allowed: false, reason: 'space_admin_required' });
  });

  it('answers a space-level query (no agent) for roster gating', async () => {
    const res = await resolvePassportAuthority({ actorUserId: ws.userId, spaceId: ws.spaceId });
    expect(res).toMatchObject({ allowed: true, space: { id: ws.spaceId, admin: true, via: 'owner' } });
    expect(res.agent_row_id).toBeNull();
  });

  it('space-level query for an unknown space fails closed', async () => {
    const res = await resolvePassportAuthority({ actorUserId: ws.userId, spaceId: 0 });
    expect(res).toMatchObject({ allowed: false, reason: 'residence_not_found' });
  });
});
