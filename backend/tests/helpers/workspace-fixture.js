// Ephemeral workspace fixture — ADR-0009 §Phase 7
//
// Why this exists: `godcrm_test` is shared by every suite on the box, and
// until now each DB-backed suite hand-rolled its own INSERTs for the
// user → space → project → dashboard → table chain. Two costs came out of
// that: every new suite rediscovered the NOT NULL columns the hard way
// (`spaces.owner_id`, `spaces.type`, `projects.owner_id`, `projects.type` —
// three failed iterations was the going rate), and nobody cleaned up, so rows
// accumulated across runs and suites that count or list them drifted by a
// couple of tests between runs.
//
// This helper does both jobs: it knows the required columns, and it hands
// back a `cleanup()` that removes exactly what it created, in FK order.
//
// Usage:
//
//   import { createEphemeralWorkspace } from '../../tests/helpers/workspace-fixture.js';
//
//   let ws;
//   beforeEach(async () => { ws = await createEphemeralWorkspace(); });
//   afterEach(async () => { await ws.cleanup(); });
//
//   test('...', async () => {
//     const widget = await createWidget({ dashboard_id: ws.dashboardId, ... });
//   });
//
// Every name carries a per-call token, so two suites running in parallel
// workers never collide on a UNIQUE index.

import { dbRun, dbAll, toBool } from '../../database/connection.js';

let counter = 0;

/** Collision-proof suffix: time + pid + in-process counter. */
export function fixtureToken() {
  counter += 1;
  return `${Date.now().toString(36)}-${process.pid}-${counter}`;
}

/**
 * Create a throwaway user → space → project (+ optional dashboard and table).
 *
 * @param {object} [opts]
 * @param {boolean} [opts.dashboard=true]  also create a default dashboard
 * @param {boolean} [opts.table=true]      also create an empty universal_table
 * @param {string}  [opts.type='business'] `type` for both space and project
 * @param {string}  [opts.label='fixture'] shows up in the generated names
 * @returns {Promise<{token:string, userId:number, email:string, spaceId:number,
 *   projectId:number, dashboardId:number|null, tableId:number|null,
 *   cleanup:() => Promise<void>}>}
 */
export async function createEphemeralWorkspace(opts = {}) {
  const {
    dashboard = true,
    table = true,
    type = 'business',
    label = 'fixture'
  } = opts;

  const token = fixtureToken();
  const email = `test-${label}-${token}@test.godcrm.local`;

  // users: email, password_hash, name, encryption_key_encrypted are NOT NULL
  const user = await dbRun(
    `INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified)
     VALUES (?, ?, ?, ?, ?)`,
    [email, 'test-hash', `Test ${label} ${token}`, 'test-encrypted-key', toBool(true)]
  );
  const userId = user.lastInsertRowid;

  // spaces: owner_id, name, type are NOT NULL — `type` has no default
  const space = await dbRun(
    'INSERT INTO spaces (owner_id, name, type) VALUES (?, ?, ?)',
    [userId, `Test Space ${token}`, type]
  );
  const spaceId = space.lastInsertRowid;

  // projects: owner_id, name, type are NOT NULL — `type` has no default
  const project = await dbRun(
    'INSERT INTO projects (owner_id, space_id, name, type) VALUES (?, ?, ?, ?)',
    [userId, spaceId, `Test Project ${token}`, type]
  );
  const projectId = project.lastInsertRowid;

  let dashboardId = null;
  if (dashboard) {
    const row = await dbRun(
      'INSERT INTO dashboards (project_id, name, is_default) VALUES (?, ?, ?)',
      [projectId, `Test Dashboard ${token}`, toBool(true)]
    );
    dashboardId = row.lastInsertRowid;
  }

  let tableId = null;
  if (table) {
    const row = await dbRun(
      'INSERT INTO universal_tables (project_id, name) VALUES (?, ?)',
      [projectId, `Test Table ${token}`]
    );
    tableId = row.lastInsertRowid;
  }

  return {
    token,
    userId,
    email,
    spaceId,
    projectId,
    dashboardId,
    tableId,
    cleanup: () =>
      cleanupWorkspace({ userId, spaceId, projectId, dashboardId, tableId })
  };
}

/**
 * Remove everything `createEphemeralWorkspace` created, children first.
 *
 * Best effort by design: a suite may legitimately have dropped rows itself, and
 * `godcrm_test` schema drifts (see the mail-migration wipe on every re-copy),
 * so a missing table must not turn teardown into a test failure. Anything that
 * does fail is reported once, not thrown.
 */
export async function cleanupWorkspace(ids) {
  const { userId, spaceId, projectId, dashboardId, tableId } = ids;

  const steps = [
    // widgets/rows first — they hold the dashboard/table ids
    dashboardId && ['DELETE FROM widgets WHERE dashboard_id = ?', [dashboardId]],
    // ... including widgets on any other dashboard of the project (the
    // starter pack pins a welcome widget on the dashboard it creates itself)
    projectId && [
      'DELETE FROM widgets WHERE dashboard_id IN (SELECT id FROM dashboards WHERE project_id = ?)',
      [projectId]
    ],
    tableId && ['DELETE FROM table_rows WHERE table_id = ?', [tableId]],
    // table_columns has no FK to universal_tables: without this step every
    // column a suite created becomes an orphan definition (ADR-204 dry-run
    // found 793 of them on godcrm_test). Rows of tables other than `tableId`
    // (import tests create their own) are swept by the same project scope.
    projectId && ['DELETE FROM table_rows WHERE table_id IN (SELECT id FROM universal_tables WHERE project_id = ?)', [projectId]],
    projectId && ['DELETE FROM table_columns WHERE table_id IN (SELECT id FROM universal_tables WHERE project_id = ?)', [projectId]],
    projectId && ['DELETE FROM universal_tables WHERE project_id = ?', [projectId]],
    projectId && ['DELETE FROM dashboards WHERE project_id = ?', [projectId]],
    projectId && ['DELETE FROM projects WHERE id = ?', [projectId]],
    spaceId && ['DELETE FROM conversations WHERE space_id = ?', [spaceId]],
    spaceId && ['DELETE FROM modules WHERE space_id = ?', [spaceId]],
    spaceId && ['DELETE FROM spaces WHERE id = ?', [spaceId]],
    // Orphans the user minted: dashboard gone or never set (ticket 240245 —
    // one of these took widgets.id 99999). `modules` cascades off widgets.
    userId && [
      `DELETE FROM widgets
        WHERE created_by = ?
          AND (dashboard_id IS NULL
               OR NOT EXISTS (SELECT 1 FROM dashboards d WHERE d.id = widgets.dashboard_id))`,
      [userId]
    ],
    userId && ['DELETE FROM users WHERE id = ?', [userId]]
  ].filter(Boolean);

  const failures = [];
  for (const [sql, params] of steps) {
    try {
      await dbRun(sql, params);
    } catch (err) {
      failures.push(`${sql.split(' FROM ')[1]}: ${err.message}`);
    }
  }

  if (failures.length) {
    // eslint-disable-next-line no-console
    console.warn(`[workspace-fixture] partial cleanup — ${failures.join('; ')}`);
  }
}

/**
 * Sweep fixture rows left behind by crashed or killed runs.
 *
 * Matches only the `@test.godcrm.local` namespace this helper mints, so it can
 * never touch a manual-QA or real row. Called by `npm run test:clean`.
 * Also removes orphan widgets (dashboard gone or NULL) those users created,
 * and through the FK cascade the modules hanging off them (ticket 240245).
 *
 * @returns {Promise<number>} number of stale workspaces removed
 */
export async function sweepStaleFixtures() {
  const users = await dbAll(
    "SELECT id FROM users WHERE email LIKE '%@test.godcrm.local'"
  );

  for (const { id } of users) {
    const spaces = await dbAll('SELECT id FROM spaces WHERE owner_id = ?', [id]);
    const projects = await dbAll('SELECT id FROM projects WHERE owner_id = ?', [id]);
    for (const project of projects) {
      await cleanupWorkspace({ projectId: project.id });
    }
    for (const space of spaces) {
      await cleanupWorkspace({ spaceId: space.id });
    }
    await cleanupWorkspace({ userId: id });
  }

  return users.length;
}

export default createEphemeralWorkspace;
