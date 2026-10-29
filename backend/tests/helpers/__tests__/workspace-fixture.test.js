// Covers the fixture that every other DB-backed suite is meant to lean on:
// if it leaks rows, the shared godcrm_test drifts and the drift shows up as
// unrelated suites flapping by a test or two between runs.

import { describe, test, expect, afterAll } from 'vitest';
import { createEphemeralWorkspace } from '../workspace-fixture.js';
import { dbGet, dbRun, destroyAdapter, resetAdapter, toBool } from '../../../database/connection.js';

afterAll(async () => {
  await destroyAdapter();
});

describe('createEphemeralWorkspace', () => {
  test('creates the full chain and satisfies every NOT NULL column', async () => {
    await resetAdapter();
    const ws = await createEphemeralWorkspace({ label: 'selftest' });

    try {
      expect(ws.userId).toBeTruthy();
      expect(ws.spaceId).toBeTruthy();
      expect(ws.projectId).toBeTruthy();
      expect(ws.dashboardId).toBeTruthy();
      expect(ws.tableId).toBeTruthy();

      const space = await dbGet('SELECT owner_id, type FROM spaces WHERE id = ?', [ws.spaceId]);
      expect(Number(space.owner_id)).toBe(Number(ws.userId));
      expect(space.type).toBe('business');

      const project = await dbGet('SELECT owner_id, space_id, type FROM projects WHERE id = ?', [
        ws.projectId
      ]);
      expect(Number(project.owner_id)).toBe(Number(ws.userId));
      expect(Number(project.space_id)).toBe(Number(ws.spaceId));
    } finally {
      await ws.cleanup();
    }
  });

  test('cleanup removes everything it created', async () => {
    const ws = await createEphemeralWorkspace({ label: 'selftest-cleanup' });
    await ws.cleanup();

    expect(await dbGet('SELECT id FROM users WHERE id = ?', [ws.userId])).toBeFalsy();
    expect(await dbGet('SELECT id FROM spaces WHERE id = ?', [ws.spaceId])).toBeFalsy();
    expect(await dbGet('SELECT id FROM projects WHERE id = ?', [ws.projectId])).toBeFalsy();
    expect(await dbGet('SELECT id FROM dashboards WHERE id = ?', [ws.dashboardId])).toBeFalsy();
    expect(await dbGet('SELECT id FROM universal_tables WHERE id = ?', [ws.tableId])).toBeFalsy();
  });

  // Ticket 240245: a starter-pack welcome widget minted for the fixture user
  // outlived its teardown (dashboard gone, widget left with dashboard_id NULL),
  // took id 99999 and turned five "non-existent widget" tests red.
  test('cleanup also removes widgets the fixture user left behind', async () => {
    const ws = await createEphemeralWorkspace({ label: 'selftest-orphans' });

    // A second dashboard under the same project — cleanup only knew ws.dashboardId.
    const extraDash = await dbRun(
      'INSERT INTO dashboards (project_id, name, is_default) VALUES (?, ?, ?)',
      [ws.projectId, `Extra ${ws.token}`, toBool(false)]
    );
    const onExtra = await dbRun(
      `INSERT INTO widgets (dashboard_id, widget_type, preset_name, title, owner_kind, owner_id, created_by)
       VALUES (?, 'preset', 'welcome_dashboard', '🏠 Welcome', 'dashboard', ?, ?)`,
      [extraDash.lastInsertRowid, extraDash.lastInsertRowid, ws.userId]
    );
    // The orphan shape from the incident: no dashboard at all, created by the fixture user.
    const orphan = await dbRun(
      `INSERT INTO widgets (dashboard_id, widget_type, preset_name, title, owner_kind, owner_id, created_by)
       VALUES (NULL, 'preset', 'welcome_dashboard', 'New', 'dashboard', ?, ?)`,
      [ws.dashboardId, ws.userId]
    );
    const mod = await dbRun(
      'INSERT INTO modules (widget_id, space_id) VALUES (?, ?)',
      [orphan.lastInsertRowid, ws.spaceId]
    );

    await ws.cleanup();

    expect(await dbGet('SELECT id FROM widgets WHERE id = ?', [onExtra.lastInsertRowid])).toBeFalsy();
    expect(await dbGet('SELECT id FROM widgets WHERE id = ?', [orphan.lastInsertRowid])).toBeFalsy();
    expect(await dbGet('SELECT id FROM modules WHERE id = ?', [mod.lastInsertRowid])).toBeFalsy();
    expect(await dbGet('SELECT id FROM users WHERE id = ?', [ws.userId])).toBeFalsy();
  });

  test('two workspaces never collide on the unique email index', async () => {
    const a = await createEphemeralWorkspace({ label: 'selftest-a' });
    const b = await createEphemeralWorkspace({ label: 'selftest-b' });

    try {
      expect(a.email).not.toBe(b.email);
      expect(a.token).not.toBe(b.token);
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  });
});
