/**
 * Agent-table resolver — ADR-164 Phase 3a (companion to the handle-first identity work).
 *
 * Single, telemetry-instrumented choke point answering ONE question:
 *   "which universal_tables rows are agent-config tables?"
 *
 * It replaces 11 scattered `ut.name = 'AI Agents'` SQL predicates (class A — the sites
 * OUTSIDE the identity resolve path; the class-B resolver predicates in agent-users.js /
 * chatAgentHelpers.js stay put, gated on the deprecated_slug_resolve telemetry, Phase 4).
 *
 * WHY: matching agent tables by display name is a convention, not a contract. A renamed,
 * copy_space-cloned, or passport-less sub-agent table is a real agent table the name match
 * misses. The stable marker is `universal_tables.table_type = 'ai_agents'` (backfilled by
 * migration 077, stamped on every creation / copy path).
 *
 * Three modes via env AGENT_TABLE_RESOLVE_MODE (default 'dual'):
 *   - 'name'   : legacy — match by display name only. Instant kill-switch / rollback,
 *                no redeploy: an out-of-band flip returns behaviour to the pre-Phase-3a state.
 *   - 'marker' : match by table_type only. Phase 4 target, flipped once the safety gate below
 *                is provably empty in production telemetry.
 *   - 'dual'   : DEFAULT. Compute BOTH sets, RETURN the name-set (so live behaviour on every
 *                hot path is byte-identical to the old literal — a regression is structurally
 *                impossible), and log divergence, separately:
 *                  name \ marker  -> WARN  event=agent_table_resolve_divergence kind=name_minus_marker
 *                                    SAFETY GATE: MUST be empty. A non-empty set means a table we
 *                                    actively serve has no marker (a backfill/stamp gap) — Phase 4
 *                                    must NOT flip to 'marker' until this is zero, exactly as
 *                                    Phase 1 gated retiring the slug fallback on deprecated_slug_resolve.
 *                  marker \ name  -> INFO  event=agent_table_resolve_divergence kind=marker_minus_name
 *                                    FEATURE SIGNAL: renamed / copy_space / passport-less sub-agent
 *                                    tables the name convention never saw. Expected to be > 0.
 *
 * Returns: number[] of universal_tables.id (deduped integers). Empty array => the caller yields
 * no agent tables, identical to the old `WHERE ut.name='AI Agents'` matching nothing.
 *
 * The returned ids are internal integer primary keys from our own DB — callers inline them into an
 * IN(...) list (see coercion below); there is no user-controlled value in the list.
 */
import { dbAll, isPostgres } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';

const AGENT_TABLE_NAME = 'AI Agents';
const AGENT_TABLE_TYPE = 'ai_agents';
const VALID_MODES = new Set(['name', 'marker', 'dual']);

function resolveMode() {
  const raw = (process.env.AGENT_TABLE_RESOLVE_MODE || 'dual').trim().toLowerCase();
  return VALID_MODES.has(raw) ? raw : 'dual';
}

function toIntIds(rows) {
  // Positive integer PKs only — drops null/0/negatives (Number(null) === 0 would otherwise slip through).
  return [...new Set(rows.map(r => Number(r.id)).filter(n => Number.isInteger(n) && n > 0))];
}

async function selectByName(spaceId) {
  const pg = isPostgres();
  if (spaceId != null) {
    return toIntIds(await dbAll(
      pg
        ? `SELECT ut.id FROM universal_tables ut
             JOIN projects p ON ut.project_id = p.id
            WHERE ut.name = $1 AND p.space_id = $2`
        : `SELECT ut.id FROM universal_tables ut
             JOIN projects p ON ut.project_id = p.id
            WHERE ut.name = ? AND p.space_id = ?`,
      [AGENT_TABLE_NAME, spaceId],
    ));
  }
  return toIntIds(await dbAll(
    pg
      ? `SELECT ut.id FROM universal_tables ut WHERE ut.name = $1`
      : `SELECT ut.id FROM universal_tables ut WHERE ut.name = ?`,
    [AGENT_TABLE_NAME],
  ));
}

async function selectByMarker(spaceId) {
  const pg = isPostgres();
  if (spaceId != null) {
    return toIntIds(await dbAll(
      pg
        ? `SELECT ut.id FROM universal_tables ut
             JOIN projects p ON ut.project_id = p.id
            WHERE ut.table_type = $1 AND p.space_id = $2`
        : `SELECT ut.id FROM universal_tables ut
             JOIN projects p ON ut.project_id = p.id
            WHERE ut.table_type = ? AND p.space_id = ?`,
      [AGENT_TABLE_TYPE, spaceId],
    ));
  }
  return toIntIds(await dbAll(
    pg
      ? `SELECT ut.id FROM universal_tables ut WHERE ut.table_type = $1`
      : `SELECT ut.id FROM universal_tables ut WHERE ut.table_type = ?`,
    [AGENT_TABLE_TYPE],
  ));
}

/**
 * Resolve the set of agent-config table ids.
 *
 * @param {object}  [opts]
 * @param {number}  [opts.spaceId]  Restrict to tables whose project lives in this space.
 *                                  Omit for a global (all-spaces) resolve.
 * @returns {Promise<number[]>} universal_tables.id list (may be empty).
 */
export async function getAgentTableIds({ spaceId = null } = {}) {
  const mode = resolveMode();

  if (mode === 'name') return selectByName(spaceId);
  if (mode === 'marker') return selectByMarker(spaceId);

  // dual (default): shadow-read. Live answer = name-set; marker-set only feeds telemetry.
  const [nameIds, markerIds] = await Promise.all([selectByName(spaceId), selectByMarker(spaceId)]);
  const nameSet = new Set(nameIds);
  const markerSet = new Set(markerIds);

  const nameMinusMarker = nameIds.filter(id => !markerSet.has(id));
  if (nameMinusMarker.length > 0) {
    apiLogger.warn(
      { event: 'agent_table_resolve_divergence', kind: 'name_minus_marker', spaceId, tableIds: nameMinusMarker },
      'ADR-164 Phase 3a: agent table(s) matched by name but MISSING the ai_agents marker — backfill/stamp gap; safety gate must be empty before flipping to marker mode',
    );
  }

  const markerMinusName = markerIds.filter(id => !nameSet.has(id));
  if (markerMinusName.length > 0) {
    apiLogger.info(
      { event: 'agent_table_resolve_divergence', kind: 'marker_minus_name', spaceId, tableIds: markerMinusName },
      'ADR-164 Phase 3a: agent table(s) matched by marker but not by name (renamed / copy_space / passport-less sub-agent) — expected feature signal',
    );
  }

  return nameIds;
}

/** Exposed for characterization tests — the constants the resolver keys on. */
export const AGENT_TABLE_MARKERS = Object.freeze({ NAME: AGENT_TABLE_NAME, TYPE: AGENT_TABLE_TYPE });
