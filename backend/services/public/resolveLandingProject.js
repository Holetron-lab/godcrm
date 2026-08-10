// ADR-0060-A P7/A2 — Resolve the landing project for a public space.
//
// Public `/s/:slug` mounts a project's dashboard directly (ADR-0060-A
// supersedes the P-track card-grid). To pick which project, we use a
// 3-tier fallback so the page is meaningful even when the owner has
// not configured a main project yet:
//
//   1. `spaces.main_project_id` if it is set, the project is_public, and
//      it is NOT the per-space System Data project (AC15/16 from ADR-0060
//      §6 — hard-banned regardless of is_public).
//   2. else the FIRST public project in the space ordered by
//      (order_index, id), skipping any System Data project.
//   3. else null — the landing page renders a tiny empty state.
//
// For the resolved project we additionally surface its first public
// dashboard (`main_dashboard_id`), so the frontend can mount
// <DashboardGrid> in a single round trip without a second resolve.

import { dbGet, dbAll } from '../../database/connection.js';

// Mirror of `isSystemDataProject` in backend/routes/v3/public.js. Kept in
// sync deliberately — same defensive matcher (type='system_data', legacy
// 'system', or name === 'System Data') so this helper is rename-safe.
function isSystemDataProject(row) {
  if (!row) return false;
  const t = row.type;
  if (t === 'system_data' || t === 'system') return true;
  if (row.name === 'System Data') return true;
  return false;
}

async function pickFirstPublicDashboard(projectId) {
  const row = await dbGet(
    `SELECT id
       FROM dashboards
      WHERE project_id = ?
        AND is_public IS NOT FALSE
      ORDER BY order_index, id
      LIMIT 1`,
    [projectId]
  );
  return row ? row.id : null;
}

async function loadCandidateProject(projectId) {
  if (projectId == null) return null;
  return dbGet(
    `SELECT id, space_id, name, type, is_public
       FROM projects
      WHERE id = ?`,
    [projectId]
  );
}

/**
 * Resolve the landing project + dashboard for a public space.
 *
 * @param {number|string} spaceId - the public space's id
 * @returns {Promise<{ main_project_id: number|null, main_dashboard_id: number|null }>}
 */
export async function resolveLandingProject(spaceId) {
  if (spaceId == null) {
    return { main_project_id: null, main_dashboard_id: null };
  }

  const space = await dbGet(
    `SELECT id, main_project_id FROM spaces WHERE id = ?`,
    [spaceId]
  );
  if (!space) {
    return { main_project_id: null, main_dashboard_id: null };
  }

  // Tier 1 — explicit main_project_id, gated by is_public + System Data ban.
  if (space.main_project_id != null) {
    const candidate = await loadCandidateProject(space.main_project_id);
    if (
      candidate &&
      String(candidate.space_id) === String(spaceId) &&
      candidate.is_public !== false &&
      !isSystemDataProject(candidate)
    ) {
      const dashboardId = await pickFirstPublicDashboard(candidate.id);
      return {
        main_project_id: candidate.id,
        main_dashboard_id: dashboardId
      };
    }
    // fallthrough — the configured main project is no longer eligible.
  }

  // Tier 2 — first public project in the space (deterministic).
  const projects = await dbAll(
    `SELECT id, name, type, is_public
       FROM projects
      WHERE space_id = ?
        AND is_public IS NOT FALSE
      ORDER BY order_index, id`,
    [spaceId]
  );
  const firstEligible = projects.find(p => !isSystemDataProject(p));
  if (!firstEligible) {
    return { main_project_id: null, main_dashboard_id: null };
  }

  const dashboardId = await pickFirstPublicDashboard(firstEligible.id);
  return {
    main_project_id: firstEligible.id,
    main_dashboard_id: dashboardId
  };
}

// Internal helper exposed for tests only.
export const __test__ = { isSystemDataProject };
