/**
 * ADR-0060-A P7/A2 — resolveLandingProject helper.
 *
 * 3-tier fallback contract:
 *   1. spaces.main_project_id if set + project.is_public + not System Data
 *   2. first public project ordered by (order_index, id), excluding System Data
 *   3. null
 *
 * Hits localhost `godcrm_test` via ADR-0009 isolation (booted by
 * backend/test/setup.js → vitest.config.ts).
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  dbRun,
  destroyAdapter,
  resetAdapter
} from '../../../database/connection.js';
import { resolveLandingProject } from '../resolveLandingProject.js';

async function createUser() {
  // Minimal columns — the test DB doesn't carry every column from PROD.
  const r = await dbRun(
    `INSERT INTO users (email, password_hash, name, encryption_key_encrypted)
     VALUES (?, ?, ?, ?)`,
    [
      `t-rlp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@hltrn.cc`,
      'hash',
      'Test',
      'k'
    ]
  );
  return r.lastInsertRowid;
}

async function createSpace(ownerId, slug) {
  const r = await dbRun(
    `INSERT INTO spaces (owner_id, name, type, visibility, public_slug)
     VALUES (?, ?, ?, ?, ?)`,
    [ownerId, 'RLP Space', 'business', 'external', slug]
  );
  return r.lastInsertRowid;
}

async function createProject(ownerId, spaceId, {
  name = 'Proj',
  type = 'business',
  isPublic = true,
  orderIndex = 0
} = {}) {
  const r = await dbRun(
    `INSERT INTO projects (owner_id, space_id, name, type, is_public, order_index)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [ownerId, spaceId, name, type, isPublic, orderIndex]
  );
  return r.lastInsertRowid;
}

async function createDashboard(projectId, {
  name = 'D',
  isPublic = true,
  orderIndex = 0
} = {}) {
  const r = await dbRun(
    `INSERT INTO dashboards (project_id, name, is_public, order_index)
     VALUES (?, ?, ?, ?)`,
    [projectId, name, isPublic, orderIndex]
  );
  return r.lastInsertRowid;
}

describe('resolveLandingProject (ADR-0060-A P7/A2)', () => {
  let userId;
  let slug;

  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    process.env.SKIP_DEV_USER = 'true';
    await resetAdapter();

    // Schema-evolution shims (mirror public.test.js pattern).
    for (const col of [
      'visibility TEXT',
      'public_slug TEXT',
      'public_password_hash TEXT',
      'main_project_id INTEGER'
    ]) {
      try { await dbRun(`ALTER TABLE spaces ADD COLUMN ${col}`); } catch { /* exists */ }
    }
    for (const col of [
      'is_public BOOLEAN NOT NULL DEFAULT TRUE',
      'order_index INTEGER DEFAULT 0',
      'type TEXT'
    ]) {
      try { await dbRun(`ALTER TABLE projects ADD COLUMN ${col}`); } catch { /* exists */ }
    }
    for (const col of [
      'is_public BOOLEAN NOT NULL DEFAULT TRUE',
      'order_index INTEGER DEFAULT 0'
    ]) {
      try { await dbRun(`ALTER TABLE dashboards ADD COLUMN ${col}`); } catch { /* exists */ }
    }

    userId = await createUser();
    slug = `rlp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  });

  afterEach(async () => {
    await destroyAdapter();
  });

  test('Tier 3: empty space → nulls', async () => {
    const spaceId = await createSpace(userId, slug);
    const result = await resolveLandingProject(spaceId);
    expect(result).toEqual({
      main_project_id: null,
      main_dashboard_id: null
    });
  });

  test('Tier 3: space with only private projects → nulls', async () => {
    const spaceId = await createSpace(userId, slug);
    await createProject(userId, spaceId, { isPublic: false });
    const result = await resolveLandingProject(spaceId);
    expect(result.main_project_id).toBeNull();
    expect(result.main_dashboard_id).toBeNull();
  });

  test('Tier 2: first public project picked when main_project_id is NULL', async () => {
    const spaceId = await createSpace(userId, slug);
    const projectId = await createProject(userId, spaceId, { isPublic: true });
    const dashboardId = await createDashboard(projectId);

    const result = await resolveLandingProject(spaceId);
    expect(result.main_project_id).toBe(projectId);
    expect(result.main_dashboard_id).toBe(dashboardId);
  });

  test('Tier 2: deterministic order by order_index then id', async () => {
    const spaceId = await createSpace(userId, slug);
    const pLater = await createProject(userId, spaceId, { name: 'Z', orderIndex: 10 });
    const pFirst = await createProject(userId, spaceId, { name: 'A', orderIndex: 1 });
    await createDashboard(pLater);
    await createDashboard(pFirst);

    const result = await resolveLandingProject(spaceId);
    expect(result.main_project_id).toBe(pFirst);
  });

  test('Tier 2: System Data project skipped at fallback level', async () => {
    const spaceId = await createSpace(userId, slug);
    // System Data sits at order_index 0 — without the filter it would be picked.
    await createProject(userId, spaceId, {
      name: 'System Data',
      type: 'system_data',
      orderIndex: 0
    });
    const eligibleId = await createProject(userId, spaceId, {
      name: 'Real',
      orderIndex: 5
    });
    const dashId = await createDashboard(eligibleId);

    const result = await resolveLandingProject(spaceId);
    expect(result.main_project_id).toBe(eligibleId);
    expect(result.main_dashboard_id).toBe(dashId);
  });

  test('Tier 1: main_project_id honoured when eligible', async () => {
    const spaceId = await createSpace(userId, slug);
    const pFirst = await createProject(userId, spaceId, { name: 'A', orderIndex: 1 });
    const pHome  = await createProject(userId, spaceId, { name: 'Home', orderIndex: 5 });
    await createDashboard(pFirst);
    const homeDashId = await createDashboard(pHome);

    await dbRun(`UPDATE spaces SET main_project_id = ? WHERE id = ?`, [pHome, spaceId]);

    const result = await resolveLandingProject(spaceId);
    // Tier-1 wins even though pFirst comes earlier by order_index.
    expect(result.main_project_id).toBe(pHome);
    expect(result.main_dashboard_id).toBe(homeDashId);
  });

  test('Tier 1 → Tier 2 fallback when main_project_id points at non-public project', async () => {
    const spaceId = await createSpace(userId, slug);
    const pPriv = await createProject(userId, spaceId, { name: 'Priv', isPublic: false });
    const pPub  = await createProject(userId, spaceId, { name: 'Pub', orderIndex: 1 });
    const dashPub = await createDashboard(pPub);

    await dbRun(`UPDATE spaces SET main_project_id = ? WHERE id = ?`, [pPriv, spaceId]);

    const result = await resolveLandingProject(spaceId);
    expect(result.main_project_id).toBe(pPub);
    expect(result.main_dashboard_id).toBe(dashPub);
  });

  test('Tier 1 → Tier 2 fallback when main_project_id points at System Data (type=system_data)', async () => {
    const spaceId = await createSpace(userId, slug);
    const sysData = await createProject(userId, spaceId, {
      name: 'System Data',
      type: 'system_data'
    });
    const eligible = await createProject(userId, spaceId, {
      name: 'Eligible',
      orderIndex: 5
    });
    const eligDash = await createDashboard(eligible);

    await dbRun(`UPDATE spaces SET main_project_id = ? WHERE id = ?`, [sysData, spaceId]);

    const result = await resolveLandingProject(spaceId);
    expect(result.main_project_id).toBe(eligible);
    expect(result.main_dashboard_id).toBe(eligDash);
  });

  test('Tier 1 → Tier 2 fallback when main_project_id points at legacy System Data (type=system)', async () => {
    const spaceId = await createSpace(userId, slug);
    const legacySys = await createProject(userId, spaceId, {
      name: 'whatever',
      type: 'system'
    });
    const eligible = await createProject(userId, spaceId, {
      name: 'Eligible',
      orderIndex: 5
    });
    await createDashboard(eligible);

    await dbRun(`UPDATE spaces SET main_project_id = ? WHERE id = ?`, [legacySys, spaceId]);

    const result = await resolveLandingProject(spaceId);
    expect(result.main_project_id).toBe(eligible);
  });

  test('Tier 1 → Tier 2 fallback when main_project_id points at name=System Data (name-only matcher)', async () => {
    const spaceId = await createSpace(userId, slug);
    // Name-only match: type is a non-system value, name carries the signal.
    const namedSys = await createProject(userId, spaceId, {
      name: 'System Data',
      type: 'business'
    });
    const eligible = await createProject(userId, spaceId, {
      name: 'Eligible',
      orderIndex: 5
    });
    await createDashboard(eligible);

    await dbRun(`UPDATE spaces SET main_project_id = ? WHERE id = ?`, [namedSys, spaceId]);

    const result = await resolveLandingProject(spaceId);
    expect(result.main_project_id).toBe(eligible);
  });

  test('Tier 1 → Tier 2 fallback when main_project_id points at a project in a DIFFERENT space', async () => {
    const spaceA = await createSpace(userId, `${slug}-a`);
    const spaceB = await createSpace(userId, `${slug}-b`);
    const projInB = await createProject(userId, spaceB, { name: 'Foreign' });
    const projInA = await createProject(userId, spaceA, { name: 'Local', orderIndex: 5 });
    const dashA = await createDashboard(projInA);

    // Cross-space pointer — must NOT be honoured.
    await dbRun(`UPDATE spaces SET main_project_id = ? WHERE id = ?`, [projInB, spaceA]);

    const result = await resolveLandingProject(spaceA);
    expect(result.main_project_id).toBe(projInA);
    expect(result.main_dashboard_id).toBe(dashA);
  });

  test('main_dashboard_id is null when the resolved project has no public dashboards', async () => {
    const spaceId = await createSpace(userId, slug);
    const projectId = await createProject(userId, spaceId);
    // Only a private dashboard.
    await createDashboard(projectId, { isPublic: false });

    const result = await resolveLandingProject(spaceId);
    expect(result.main_project_id).toBe(projectId);
    expect(result.main_dashboard_id).toBeNull();
  });

  test('main_dashboard_id picks the first by (order_index, id) when multiple are public', async () => {
    const spaceId = await createSpace(userId, slug);
    const projectId = await createProject(userId, spaceId);
    const dLater = await createDashboard(projectId, { name: 'Z', orderIndex: 10 });
    const dFirst = await createDashboard(projectId, { name: 'A', orderIndex: 1 });

    const result = await resolveLandingProject(spaceId);
    expect(result.main_dashboard_id).toBe(dFirst);
    expect(result.main_dashboard_id).not.toBe(dLater);
  });

  test('non-existent spaceId → nulls (no throw)', async () => {
    const result = await resolveLandingProject(999999999);
    expect(result).toEqual({
      main_project_id: null,
      main_dashboard_id: null
    });
  });

  test('null spaceId → nulls (defensive)', async () => {
    const result = await resolveLandingProject(null);
    expect(result).toEqual({
      main_project_id: null,
      main_dashboard_id: null
    });
  });
});
