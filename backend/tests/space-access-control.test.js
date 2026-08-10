// Space Access Control Tests
// Comprehensive tests for checkUserSpaceAccess, checkUserAccessViaTableV2,
// getSpacesByUser filtering, and user_access_permissions
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { dbAll, dbGet, dbRun, destroyAdapter, resetAdapter } from '../database/connection.js';
import {
  checkUserSpaceAccess,
  checkUserAccessViaTableV2,
  getUserAccessData,
  canAccessSpace,
  canAccessProject,
  canAccessTable,
  canAccessColumn,
} from '../services/space/access.js';
import { getSpacesByUser } from '../services/space/crud.js';

// ─── ID mapping: use 90000+ range to avoid collisions with production data ───
// Users: 90001 (owner), 90002 (admin), 90010 (regular), 90011 (vika)
// Spaces: 90001, 90011, 90033, 90035, 90050, 90060, 90070
// Tables: 90100, 90200, 90300, 90400, 90500, 90600

const U_OWNER = 90001;
const U_ADMIN = 90002;
const U_REGULAR = 90010;
const U_VIKA = 90011;

const ALL_USER_IDS = [U_OWNER, U_ADMIN, U_REGULAR, U_VIKA];
const ALL_SPACE_IDS = [90001, 90011, 90033, 90035, 90050, 90060, 90070];
const ALL_TABLE_IDS = [90100, 90200, 90300, 90400, 90500, 90600];

// ─── Minimal schema setup ───

async function setupMinimalSchema() {
  await resetAdapter();
  // Tables already exist in PostgreSQL — just clean up previous test data
  await cleanupTestData();
}

async function cleanupTestData() {
  try {
    await dbRun(`DELETE FROM user_access_permissions WHERE user_id IN (${ALL_USER_IDS.join(',')})`);
    await dbRun(`DELETE FROM table_rows WHERE base_id LIKE 'test-%'`);
    for (const tid of ALL_TABLE_IDS) {
      await dbRun(`DELETE FROM table_columns WHERE table_id = $1`, [tid]);
      await dbRun(`DELETE FROM universal_tables WHERE id = $1`, [tid]);
      await dbRun(`DELETE FROM projects WHERE id = $1`, [tid]);
    }
    for (const sid of ALL_SPACE_IDS) {
      await dbRun(`DELETE FROM dashboards WHERE space_id = $1`, [sid]);
    }
    await dbRun(`DELETE FROM spaces WHERE id IN (${ALL_SPACE_IDS.join(',')})`);
    await dbRun(`DELETE FROM users WHERE id IN (${ALL_USER_IDS.join(',')})`);
  } catch (e) {
    // Ignore cleanup errors
  }
}

// ─── Helpers ───

let _rowCounter = 1;

async function createUser(id, email, role = 'user') {
  await dbRun(
    `INSERT INTO users (id, email, name, role, password_hash, encryption_key_encrypted)
     VALUES (?, ?, ?, ?, 'hash', 'none')
     ON CONFLICT (id) DO NOTHING`,
    [id, email, email.split('@')[0], role]
  );
}

async function createSpaceRow(id, name, ownerId, type = 'business', visibility = 'internal', accessControl = null) {
  await dbRun(
    `INSERT INTO spaces (id, owner_id, name, type, visibility, access_control)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, ownerId, name, type, visibility, accessControl ? JSON.stringify(accessControl) : null]
  );
  await dbRun(
    `INSERT INTO dashboards (space_id, name, icon, is_default, order_index)
     VALUES (?, ?, '📊', 1, 0)`,
    [id, `${name} Overview`]
  );
}

async function createUsersTable(tableId) {
  // Need a project for the table
  await dbRun(`INSERT INTO projects (id, name, type, owner_id) VALUES (?, 'TestProject', 'default', $2) ON CONFLICT (id) DO NOTHING`, [tableId, U_OWNER]);
  await dbRun(`INSERT INTO universal_tables (id, project_id, name) VALUES (?, ?, 'Access Users')`, [tableId, tableId]);

  const columns = [
    [tableId * 10 + 1, 'system_user_id'],
    [tableId * 10 + 2, 'email'],
    [tableId * 10 + 3, 'name'],
    [tableId * 10 + 4, 'role'],
    [tableId * 10 + 5, 'active'],
    [tableId * 10 + 6, 'allowed_spaces'],
    [tableId * 10 + 7, 'denied_spaces'],
    [tableId * 10 + 8, 'allowed_projects'],
    [tableId * 10 + 9, 'denied_projects'],
  ];
  for (const [colId, colName] of columns) {
    await dbRun(
      `INSERT INTO table_columns (id, table_id, column_name, type)
       VALUES (?, ?, ?, 'text')`,
      [colId, tableId, colName]
    );
  }
}

async function addUserRow(tableId, userId, email, role, active = true, extras = {}) {
  const colPrefix = tableId * 10;
  const data = {
    system_user_id: userId,
    email,
    name: email.split('@')[0],
    role,
    active,
    allowed_spaces: [],
    denied_spaces: [],
    allowed_projects: [],
    denied_projects: [],
    ...extras,
  };
  // Also store by column ID (so both name and id lookups work)
  data[String(colPrefix + 1)] = userId;
  data[String(colPrefix + 2)] = email;
  data[String(colPrefix + 4)] = role;
  data[String(colPrefix + 5)] = active;

  const baseId = `test-${tableId}-${userId}-${_rowCounter++}`;
  await dbRun(
    `INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)`,
    [tableId, baseId, JSON.stringify(data)]
  );
}

async function grantPermission(userId, spaceId, accessLevel, grantedBy = U_OWNER) {
  await dbRun(
    `INSERT INTO user_access_permissions (user_id, space_id, access_level, granted_by)
     VALUES (?, ?, ?, ?)`,
    [userId, spaceId, accessLevel, grantedBy]
  );
}

// ─── Tests ───

describe('Space Access Control', () => {
  beforeEach(async () => {
    _rowCounter = 1;
    await setupMinimalSchema();
    await createUser(U_OWNER, 'owner@test.com', 'owner');
    await createUser(U_ADMIN, 'admin@test.com', 'admin');
    await createUser(U_REGULAR, 'regular@test.com', 'user');
    await createUser(U_VIKA, 'vika@test.com', 'user');
  });

  afterEach(async () => {
    await cleanupTestData();
    await destroyAdapter();
  });

  // ═══════════════════════════════════════════════════════════
  // 1. checkUserSpaceAccess — basic rules
  // ═══════════════════════════════════════════════════════════

  describe('checkUserSpaceAccess — basic rules', () => {
    test('owner always has access', async () => {
      const space = { id: 90001, owner_id: U_REGULAR, type: 'business', visibility: 'internal' };
      expect(await checkUserSpaceAccess(U_REGULAR, 'user', space, null)).toBe(true);
    });

    test('non-owner without access_control is denied', async () => {
      const space = { id: 90001, owner_id: U_OWNER, type: 'business', visibility: 'internal' };
      expect(await checkUserSpaceAccess(U_REGULAR, 'user', space, null)).toBe(false);
    });

    test('admin role can see admin spaces', async () => {
      const space = { id: 90001, owner_id: U_OWNER, type: 'admin', visibility: 'internal' };
      expect(await checkUserSpaceAccess(U_ADMIN, 'admin', space, null)).toBe(true);
    });

    test('owner role can see admin spaces', async () => {
      const space = { id: 90001, owner_id: 99999, type: 'admin', visibility: 'internal' };
      expect(await checkUserSpaceAccess(U_OWNER, 'owner', space, null)).toBe(true);
    });

    test('regular user cannot see admin spaces', async () => {
      const space = { id: 90001, owner_id: U_OWNER, type: 'admin', visibility: 'internal' };
      expect(await checkUserSpaceAccess(U_REGULAR, 'user', space, null)).toBe(false);
    });

    test('personal spaces — only owner can access', async () => {
      const space = { id: 90001, owner_id: U_REGULAR, type: 'personal', visibility: 'internal' };
      expect(await checkUserSpaceAccess(U_REGULAR, 'user', space, null)).toBe(true);
      expect(await checkUserSpaceAccess(U_VIKA, 'user', space, null)).toBe(false);
      // Even admin cannot see other's personal space
      expect(await checkUserSpaceAccess(U_ADMIN, 'admin', space, null)).toBe(false);
    });

    test('open visibility — any authenticated user has access', async () => {
      const space = { id: 90001, owner_id: U_OWNER, type: 'business', visibility: 'open' };
      expect(await checkUserSpaceAccess(U_REGULAR, 'user', space, null)).toBe(true);
      expect(await checkUserSpaceAccess(U_VIKA, 'user', space, null)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 2. user_access_permissions — explicit grants
  // ═══════════════════════════════════════════════════════════

  describe('checkUserSpaceAccess — explicit permissions (user_access_permissions)', () => {
    test('explicit admin grant gives access', async () => {
      await grantPermission(U_VIKA, 90035, 'admin');
      const space = { id: 90035, owner_id: U_OWNER, type: 'business', visibility: 'internal' };
      expect(await checkUserSpaceAccess(U_VIKA, 'user', space, null)).toBe(true);
    });

    test('explicit viewer grant gives access', async () => {
      await grantPermission(U_VIKA, 90035, 'viewer');
      const space = { id: 90035, owner_id: U_OWNER, type: 'business', visibility: 'internal' };
      expect(await checkUserSpaceAccess(U_VIKA, 'user', space, null)).toBe(true);
    });

    test('explicit denied blocks access', async () => {
      await grantPermission(U_VIKA, 90035, 'denied');
      const space = { id: 90035, owner_id: U_OWNER, type: 'business', visibility: 'internal' };
      expect(await checkUserSpaceAccess(U_VIKA, 'user', space, null)).toBe(false);
    });

    test('no explicit permission — no access', async () => {
      const space = { id: 90035, owner_id: U_OWNER, type: 'business', visibility: 'internal' };
      expect(await checkUserSpaceAccess(U_VIKA, 'user', space, null)).toBe(false);
    });

    test('explicit permission checked BEFORE table access_control', async () => {
      const TABLE_ID = 90100;
      await createUsersTable(TABLE_ID);
      // User has denied in table but admin in explicit permissions
      await addUserRow(TABLE_ID, U_VIKA, 'vika@test.com', 'denied');
      await grantPermission(U_VIKA, 90035, 'admin');

      const ac = {
        enabled: true,
        users_table_id: TABLE_ID,
        role_column_id: String(TABLE_ID * 10 + 4),
        role_mappings: [
          { columnValue: 'denied', accessLevel: 'denied' },
          { columnValue: 'admin', accessLevel: 'admin' },
        ],
      };
      const space = { id: 90035, owner_id: U_OWNER, type: 'business', visibility: 'internal' };
      // Explicit permission (step 3.6) should grant access before table check (step 6)
      expect(await checkUserSpaceAccess(U_VIKA, 'user', space, ac)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 3. checkUserAccessViaTableV2 — table-based access
  // ═══════════════════════════════════════════════════════════

  describe('checkUserAccessViaTableV2', () => {
    const TABLE_ID = 90200;

    beforeEach(async () => {
      await createUsersTable(TABLE_ID);
    });

    const makeAC = (overrides = {}) => ({
      enabled: true,
      users_table_id: TABLE_ID,
      role_column_id: String(TABLE_ID * 10 + 4),
      role_mappings: [
        { columnValue: 'owner', accessLevel: 'owner' },
        { columnValue: 'admin', accessLevel: 'admin' },
        { columnValue: 'editor', accessLevel: 'editor' },
        { columnValue: 'viewer', accessLevel: 'viewer' },
        { columnValue: 'denied', accessLevel: 'denied' },
      ],
      ...overrides,
    });

    test('user with admin role → allowed', async () => {
      await addUserRow(TABLE_ID, U_VIKA, 'vika@test.com', 'admin');
      const r = await checkUserAccessViaTableV2(U_VIKA, makeAC());
      expect(r.allowed).toBe(true);
      expect(r.accessLevel).toBe('admin');
    });

    test('user with viewer role → allowed', async () => {
      await addUserRow(TABLE_ID, U_VIKA, 'vika@test.com', 'viewer');
      const r = await checkUserAccessViaTableV2(U_VIKA, makeAC());
      expect(r.allowed).toBe(true);
      expect(r.accessLevel).toBe('viewer');
    });

    test('user with denied role → blocked', async () => {
      await addUserRow(TABLE_ID, U_VIKA, 'vika@test.com', 'denied');
      const r = await checkUserAccessViaTableV2(U_VIKA, makeAC());
      expect(r.allowed).toBe(false);
      expect(r.accessLevel).toBe('denied');
    });

    test('user not in table → blocked', async () => {
      const r = await checkUserAccessViaTableV2(U_VIKA, makeAC());
      expect(r.allowed).toBe(false);
    });

    test('inactive user → blocked', async () => {
      await addUserRow(TABLE_ID, U_VIKA, 'vika@test.com', 'admin', false);
      const r = await checkUserAccessViaTableV2(U_VIKA, makeAC());
      expect(r.allowed).toBe(false);
      expect(r.accessLevel).toBe('denied');
    });

    test('matching by email when system_user_id not set', async () => {
      const data = {
        email: 'vika@test.com',
        role: 'editor',
        active: true,
        [String(TABLE_ID * 10 + 2)]: 'vika@test.com',
        [String(TABLE_ID * 10 + 4)]: 'editor',
      };
      const baseId = `test-email-match-${_rowCounter++}`;
      await dbRun(
        `INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)`,
        [TABLE_ID, baseId, JSON.stringify(data)]
      );

      const r = await checkUserAccessViaTableV2(U_VIKA, makeAC());
      expect(r.allowed).toBe(true);
      expect(r.accessLevel).toBe('editor');
    });

    test('role_column_id as column name works', async () => {
      await addUserRow(TABLE_ID, U_VIKA, 'vika@test.com', 'admin');
      const r = await checkUserAccessViaTableV2(U_VIKA, makeAC({ role_column_id: 'role' }));
      expect(r.allowed).toBe(true);
      expect(r.accessLevel).toBe('admin');
    });

    test('unmapped role → blocked', async () => {
      await addUserRow(TABLE_ID, U_VIKA, 'vika@test.com', 'superuser');
      const r = await checkUserAccessViaTableV2(U_VIKA, makeAC());
      expect(r.allowed).toBe(false);
    });

    test('missing config → blocked', async () => {
      const r = await checkUserAccessViaTableV2(U_VIKA, { enabled: true });
      expect(r.allowed).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 4. getSpacesByUser — end-to-end filtering
  // ═══════════════════════════════════════════════════════════

  describe('getSpacesByUser — filtering', () => {
    const TABLE_ID = 90300;

    const makeAC = () => ({
      enabled: true,
      users_table_id: TABLE_ID,
      role_column_id: String(TABLE_ID * 10 + 4),
      role_mappings: [
        { columnValue: 'owner', accessLevel: 'owner' },
        { columnValue: 'admin', accessLevel: 'admin' },
        { columnValue: 'editor', accessLevel: 'editor' },
        { columnValue: 'viewer', accessLevel: 'viewer' },
        { columnValue: 'denied', accessLevel: 'denied' },
      ],
    });

    beforeEach(async () => {
      await createUsersTable(TABLE_ID);
    });

    test('owner sees their own spaces', async () => {
      await createSpaceRow(90001, 'My Space', U_VIKA, 'business');
      const spaces = await getSpacesByUser(U_VIKA, 'user');
      expect(spaces.some(s => s.id === 90001)).toBe(true);
      expect(spaces.find(s => s.id === 90001).user_access_level).toBe('owner_owner');
    });

    test('user with table-based admin sees the space', async () => {
      await createSpaceRow(90035, 'SIXTYNINE', U_OWNER, 'business', 'internal', makeAC());
      await addUserRow(TABLE_ID, U_VIKA, 'vika@test.com', 'admin');

      const spaces = await getSpacesByUser(U_VIKA, 'user');
      const s35 = spaces.find(s => s.id === 90035);
      expect(s35).toBeDefined();
      expect(s35.user_access_level).toBe('admin');
    });

    test('user NOT in table and no perm → space NOT shown', async () => {
      await createSpaceRow(90035, 'SIXTYNINE', U_OWNER, 'business', 'internal', makeAC());
      const spaces = await getSpacesByUser(U_VIKA, 'user');
      expect(spaces.find(s => s.id === 90035)).toBeUndefined();
    });

    test('user with explicit admin perm sees the space', async () => {
      await createSpaceRow(90035, 'SIXTYNINE', U_OWNER, 'business', 'internal');
      await grantPermission(U_VIKA, 90035, 'admin');

      const spaces = await getSpacesByUser(U_VIKA, 'user');
      const s35 = spaces.find(s => s.id === 90035);
      expect(s35).toBeDefined();
      expect(s35.user_access_level).toBe('admin');
    });

    test('user with explicit perm + access_control enabled sees space', async () => {
      await createSpaceRow(90035, 'SIXTYNINE', U_OWNER, 'business', 'internal', makeAC());
      await grantPermission(U_VIKA, 90035, 'admin');
      // User NOT in users table, but has explicit perm

      const spaces = await getSpacesByUser(U_VIKA, 'user');
      const s35 = spaces.find(s => s.id === 90035);
      expect(s35).toBeDefined();
    });

    test('user_access_level from explicit perm when no table access', async () => {
      await createSpaceRow(90035, 'SIXTYNINE', U_OWNER, 'business', 'internal');
      await grantPermission(U_VIKA, 90035, 'editor');

      const spaces = await getSpacesByUser(U_VIKA, 'user');
      const s35 = spaces.find(s => s.id === 90035);
      expect(s35).toBeDefined();
      expect(s35.user_access_level).toBe('editor');
    });

    test('table level overrides explicit perm for access_level when both exist', async () => {
      await createSpaceRow(90035, 'SIXTYNINE', U_OWNER, 'business', 'internal', makeAC());
      await addUserRow(TABLE_ID, U_VIKA, 'vika@test.com', 'admin');
      await grantPermission(U_VIKA, 90035, 'viewer');

      const spaces = await getSpacesByUser(U_VIKA, 'user');
      const s35 = spaces.find(s => s.id === 90035);
      expect(s35).toBeDefined();
      // Table-based admin takes priority over explicit viewer
      expect(s35.user_access_level).toBe('admin');
    });

    test('open visibility space shown to everyone', async () => {
      await createSpaceRow(90050, 'Open Space', U_OWNER, 'business', 'open');
      const spaces = await getSpacesByUser(U_VIKA, 'user');
      expect(spaces.some(s => s.id === 90050)).toBe(true);
    });

    test('personal space hidden from non-owner', async () => {
      await createSpaceRow(90060, 'Personal', U_REGULAR, 'personal');
      const spaces = await getSpacesByUser(U_VIKA, 'user');
      expect(spaces.find(s => s.id === 90060)).toBeUndefined();
    });

    test('admin user sees admin-type spaces', async () => {
      await createSpaceRow(90001, 'Admin Space', U_OWNER, 'admin');
      const spacesAdmin = await getSpacesByUser(U_ADMIN, 'admin');
      expect(spacesAdmin.some(s => s.id === 90001)).toBe(true);

      const spacesUser = await getSpacesByUser(U_VIKA, 'user');
      expect(spacesUser.find(s => s.id === 90001)).toBeUndefined();
    });

    test('denied in table → space NOT shown', async () => {
      await createSpaceRow(90035, 'SIXTYNINE', U_OWNER, 'business', 'internal', makeAC());
      await addUserRow(TABLE_ID, U_VIKA, 'vika@test.com', 'denied');
      const spaces = await getSpacesByUser(U_VIKA, 'user');
      expect(spaces.find(s => s.id === 90035)).toBeUndefined();
    });

    test('inactive in table → space NOT shown', async () => {
      await createSpaceRow(90035, 'SIXTYNINE', U_OWNER, 'business', 'internal', makeAC());
      await addUserRow(TABLE_ID, U_VIKA, 'vika@test.com', 'admin', false);
      const spaces = await getSpacesByUser(U_VIKA, 'user');
      expect(spaces.find(s => s.id === 90035)).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 5. getUserAccessData + canAccessSpace/Project/Table/Column
  // ═══════════════════════════════════════════════════════════

  describe('canAccessSpace / canAccessProject / canAccessTable / canAccessColumn', () => {
    test('admin with no restrictions → access', () => {
      const d = { role: 'admin', active: true, allowed_spaces: [], denied_spaces: [] };
      expect(canAccessSpace(d, 90035)).toBe(true);
    });

    test('denied role → no access', () => {
      const d = { role: 'denied', active: true, allowed_spaces: [], denied_spaces: [] };
      expect(canAccessSpace(d, 90035)).toBe(false);
    });

    test('inactive → no access', () => {
      const d = { role: 'admin', active: false, allowed_spaces: [], denied_spaces: [] };
      expect(canAccessSpace(d, 90035)).toBe(false);
    });

    test('denied_spaces takes priority over allowed_spaces', () => {
      const d = { role: 'editor', active: true, allowed_spaces: ['90035'], denied_spaces: ['90035'] };
      expect(canAccessSpace(d, 90035)).toBe(false);
    });

    test('allowed_spaces whitelist works', () => {
      const d = { role: 'editor', active: true, allowed_spaces: ['90035', '90036'], denied_spaces: [] };
      expect(canAccessSpace(d, 90035)).toBe(true);
      expect(canAccessSpace(d, 99)).toBe(false);
    });

    test('empty allowed list = allow all', () => {
      const d = { role: 'editor', active: true, allowed_spaces: [], denied_spaces: [] };
      expect(canAccessSpace(d, 90035)).toBe(true);
      expect(canAccessSpace(d, 99)).toBe(true);
    });

    test('canAccessProject follows same logic', () => {
      const d = { role: 'editor', active: true, allowed_projects: ['10'], denied_projects: [] };
      expect(canAccessProject(d, 10)).toBe(true);
      expect(canAccessProject(d, 99)).toBe(false);
    });

    test('canAccessTable — denied takes priority', () => {
      const d = { role: 'viewer', active: true, allowed_tables: [], denied_tables: ['100'] };
      expect(canAccessTable(d, 100)).toBe(false);
      expect(canAccessTable(d, 200)).toBe(true);
    });

    test('canAccessColumn — admin bypasses unless denied', () => {
      expect(canAccessColumn({ role: 'admin', active: true, allowed_columns: [], denied_columns: [] }, 1)).toBe(true);
      expect(canAccessColumn({ role: 'admin', active: true, allowed_columns: [], denied_columns: ['5'] }, 5)).toBe(false);
    });

    test('null data → false for all', () => {
      expect(canAccessSpace(null, 1)).toBe(false);
      expect(canAccessProject(null, 1)).toBe(false);
      expect(canAccessTable(null, 1)).toBe(false);
      expect(canAccessColumn(null, 1)).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 6. getUserAccessData
  // ═══════════════════════════════════════════════════════════

  describe('getUserAccessData', () => {
    const TABLE_ID = 90400;

    beforeEach(async () => {
      await createUsersTable(TABLE_ID);
    });

    const makeAC = () => ({
      enabled: true,
      users_table_id: TABLE_ID,
      user_id_column: 'system_user_id',
    });

    test('returns user data with role and arrays', async () => {
      await addUserRow(TABLE_ID, U_VIKA, 'vika@test.com', 'admin', true, {
        allowed_spaces: ['90035'],
        denied_spaces: ['99'],
      });
      const data = await getUserAccessData(U_VIKA, makeAC());
      expect(data).not.toBeNull();
      expect(data.role).toBe('admin');
      expect(data.active).toBe(true);
    });

    test('returns null for non-existent user', async () => {
      const data = await getUserAccessData(999, makeAC());
      expect(data).toBeNull();
    });

    test('returns null when disabled', async () => {
      const data = await getUserAccessData(U_VIKA, { enabled: false });
      expect(data).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 7. Bug reproduction: Vika scenario
  // ═══════════════════════════════════════════════════════════

  describe('BUG REPRODUCTION: Vika (user 11) + space 35', () => {
    const TABLE_ID = 90500;

    const makeAC = () => ({
      enabled: true,
      users_table_id: TABLE_ID,
      role_column_id: String(TABLE_ID * 10 + 4),
      role_mappings: [
        { columnValue: 'owner', accessLevel: 'owner' },
        { columnValue: 'admin', accessLevel: 'admin' },
        { columnValue: 'editor', accessLevel: 'editor' },
        { columnValue: 'viewer', accessLevel: 'viewer' },
        { columnValue: 'denied', accessLevel: 'denied' },
      ],
    });

    beforeEach(async () => {
      await createUsersTable(TABLE_ID);
    });

    test('user in table + explicit perm → sees space with correct level', async () => {
      await createSpaceRow(90035, 'SIXTYNINE', U_OWNER, 'business', 'internal', makeAC());
      await addUserRow(TABLE_ID, U_VIKA, 'vika@test.com', 'admin');
      await grantPermission(U_VIKA, 90035, 'admin');

      const hasAccess = await checkUserSpaceAccess(U_VIKA, 'user',
        { id: 90035, owner_id: U_OWNER, type: 'business', visibility: 'internal' }, makeAC());
      expect(hasAccess).toBe(true);

      const spaces = await getSpacesByUser(U_VIKA, 'user');
      const s35 = spaces.find(s => s.id === 90035);
      expect(s35).toBeDefined();
      expect(s35.user_access_level).toBe('admin');
    });

    test('user only in table → sees space', async () => {
      await createSpaceRow(90035, 'SIXTYNINE', U_OWNER, 'business', 'internal', makeAC());
      await addUserRow(TABLE_ID, U_VIKA, 'vika@test.com', 'admin');

      const spaces = await getSpacesByUser(U_VIKA, 'user');
      expect(spaces.find(s => s.id === 90035)).toBeDefined();
    });

    test('user only has explicit perm (not in table) → sees space', async () => {
      await createSpaceRow(90035, 'SIXTYNINE', U_OWNER, 'business', 'internal', makeAC());
      await grantPermission(U_VIKA, 90035, 'admin');

      const hasAccess = await checkUserSpaceAccess(U_VIKA, 'user',
        { id: 90035, owner_id: U_OWNER, type: 'business', visibility: 'internal' }, makeAC());
      expect(hasAccess).toBe(true);

      const spaces = await getSpacesByUser(U_VIKA, 'user');
      expect(spaces.find(s => s.id === 90035)).toBeDefined();
    });

    test('EDGE: access_control enabled, user not in table, explicit perm → correct user_access_level', async () => {
      await createSpaceRow(90035, 'SIXTYNINE', U_OWNER, 'business', 'internal', makeAC());
      await grantPermission(U_VIKA, 90035, 'admin');

      const spaces = await getSpacesByUser(U_VIKA, 'user');
      const s35 = spaces.find(s => s.id === 90035);
      expect(s35).toBeDefined();
      expect(s35.user_access_level).toBe('admin');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 8. Full scenario: Multiple spaces
  // ═══════════════════════════════════════════════════════════

  describe('Full scenario: multiple spaces, correct filtering', () => {
    const TABLE_ID = 90600;

    const makeAC = () => ({
      enabled: true,
      users_table_id: TABLE_ID,
      role_column_id: String(TABLE_ID * 10 + 4),
      role_mappings: [
        { columnValue: 'admin', accessLevel: 'admin' },
        { columnValue: 'viewer', accessLevel: 'viewer' },
        { columnValue: 'denied', accessLevel: 'denied' },
      ],
    });

    beforeEach(async () => {
      await createUsersTable(TABLE_ID);
    });

    test('user sees exactly the right spaces', async () => {
      // Admin space — user (role=user) should NOT see
      await createSpaceRow(90001, 'Admin Space', U_OWNER, 'admin');
      // Another admin space
      await createSpaceRow(90011, 'Development', U_OWNER, 'admin');
      // Personal owned by user
      await createSpaceRow(90033, 'Personal Space', U_VIKA, 'personal');
      // Business with table-based access
      await createSpaceRow(90035, 'SIXTYNINE', U_OWNER, 'business', 'internal', makeAC());
      await addUserRow(TABLE_ID, U_VIKA, 'vika@test.com', 'admin');
      // Business without access — should NOT see
      await createSpaceRow(90070, 'Marketing', U_OWNER, 'business');

      const spaces = await getSpacesByUser(U_VIKA, 'user');
      const ids = spaces.map(s => s.id);

      expect(ids).toContain(90033);   // own personal
      expect(ids).toContain(90035);   // table-based admin
      expect(ids).not.toContain(90001);  // admin space
      expect(ids).not.toContain(90011); // admin space
      expect(ids).not.toContain(90070); // no access
    });
  });
});
