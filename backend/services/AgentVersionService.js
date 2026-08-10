// AgentVersionService — ADR-0007-S G1-data write path.
//
// CRUD + promote/retire handlers for the `agent_versions` registry (migration
// 073). This is the substrate Smith rev-3 (G2) writes to when it mints /
// promotes / retires `@smith-*` agent revisions.
//
// The single-active invariant ("at most one 'active' revision per agent") is
// enforced TWICE on purpose:
//   1. DB level — partial unique index uq_agent_versions_one_active (the backstop).
//   2. Service level — promoteAgentVersion() retires the prior active row and
//      activates the new one inside ONE transaction, retire-before-activate, so
//      the index is never transiently violated and the flip is all-or-nothing.
//
// Agents are rows in the universal-tables store (table_rows, table_id = 1784),
// so `agent_row_id` is an FK into table_rows. The FK rejects a non-existent row
// id; assertAgentRow() additionally rejects a row that exists but is not an
// agent (wrong table_id).

import { dbGet, dbAll, dbRun, withTransactionAsync } from '../database/connection.js';

export const AGENTS_TABLE_ID = 1784;
export const VERSION_STATUSES = ['draft', 'active', 'retired'];

/**
 * Verify `agentRowId` points at a real AI-Agents row (table_id = 1784).
 * Throws a tagged Error (`code: 'AGENT_NOT_FOUND'`) otherwise. The DB FK also
 * guards non-existent ids, but this gives a clean, typed error and catches the
 * "exists but is not an agent" case the FK cannot distinguish.
 * @param {{get: Function}} [exec] - optional trx executor; defaults to dbGet
 */
export async function assertAgentRow(agentRowId, exec) {
  const getOne = exec ? exec.get.bind(exec) : dbGet;
  const row = await getOne(
    'SELECT id, table_id FROM table_rows WHERE id = ?',
    [agentRowId]
  );
  if (!row) {
    const err = new Error(`No agent row with id=${agentRowId}`);
    err.code = 'AGENT_NOT_FOUND';
    throw err;
  }
  if (Number(row.table_id) !== AGENTS_TABLE_ID) {
    const err = new Error(
      `Row ${agentRowId} is not an agent (table_id=${row.table_id}, expected ${AGENTS_TABLE_ID})`
    );
    err.code = 'NOT_AN_AGENT';
    throw err;
  }
  return row;
}

/**
 * Mint a new agent revision.
 *
 * Inserts one `agent_versions` row with the next monotonic version_int for the
 * agent. The genesis revision (first row for the agent) is activated by default
 * — an agent with only draft revisions is not dispatchable — so a single mint
 * call yields exactly one active row (ADR-0007-S acceptance #1). Pass
 * `activate: false` to mint a draft, or `activate: true` to atomically promote
 * a non-genesis revision on mint.
 *
 * @param {Object} input
 * @param {number}  input.agentRowId      - AI-Agents row id (table 1784). Required.
 * @param {string} [input.agentSlug]      - human-readable lineage key.
 * @param {string} [input.prompt]         - system prompt for this revision.
 * @param {Object} [input.config]         - model/tool/skill config (JSONB).
 * @param {number} [input.rubricScore]    - Examine-phase score.
 * @param {number} [input.trafficPct]     - A/B traffic share 0..100.
 * @param {number} [input.parentVersion]  - lineage; defaults to current max version.
 * @param {number} [input.createdBy]      - minter user id.
 * @param {boolean}[input.activate]       - force activate (default: genesis-only).
 * @returns {Promise<Object>} the inserted version row
 */
export async function mintAgentVersion(input = {}) {
  const {
    agentRowId,
    agentSlug = null,
    prompt = null,
    config = {},
    rubricScore = null,
    trafficPct = 0,
    parentVersion,
    createdBy = null,
    activate,
  } = input;

  if (agentRowId == null) {
    const err = new Error('mintAgentVersion: agentRowId is required');
    err.code = 'VALIDATION';
    throw err;
  }

  return withTransactionAsync(async (trx) => {
    await assertAgentRow(agentRowId, trx);

    const agg = await trx.get(
      `SELECT COUNT(*)::int AS cnt, COALESCE(MAX(version_int), 0)::int AS maxv
         FROM agent_versions WHERE agent_row_id = ?`,
      [agentRowId]
    );
    const isGenesis = agg.cnt === 0;
    const nextVersion = agg.maxv + 1;
    const effectiveParent = parentVersion !== undefined ? parentVersion : (isGenesis ? null : agg.maxv);

    // Genesis is live by default; otherwise draft unless caller forces activate.
    const shouldActivate = activate === undefined ? isGenesis : !!activate;
    const status = shouldActivate ? 'active' : 'draft';

    // Retire any current active row first so the partial unique index never
    // sees two 'active' rows (matters only when activating a non-genesis mint).
    if (shouldActivate) {
      await trx.run(
        `UPDATE agent_versions SET status = 'retired', updated_at = NOW()
           WHERE agent_row_id = ? AND status = 'active'`,
        [agentRowId]
      );
    }

    const inserted = await trx.get(
      `INSERT INTO agent_versions
         (agent_row_id, agent_slug, version_int, parent_version, status,
          prompt_blob, config_json, rubric_score, traffic_pct, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?)
       RETURNING *`,
      [
        agentRowId,
        agentSlug,
        nextVersion,
        effectiveParent,
        status,
        prompt,
        JSON.stringify(config || {}),
        rubricScore,
        trafficPct,
        createdBy,
      ]
    );
    return inserted;
  });
}

/**
 * Promote a revision to 'active'. Atomically retires whatever revision was
 * active for the same agent (retire-before-activate, single transaction), so
 * there is never more than one active row (ADR-0007-S acceptance #2).
 * @param {number} versionId
 * @returns {Promise<Object>} the now-active version row
 */
export async function promoteAgentVersion(versionId) {
  return withTransactionAsync(async (trx) => {
    const version = await trx.get('SELECT * FROM agent_versions WHERE id = ?', [versionId]);
    if (!version) {
      const err = new Error(`No agent_version with id=${versionId}`);
      err.code = 'VERSION_NOT_FOUND';
      throw err;
    }
    if (version.status === 'active') return version; // already active — no-op

    // Retire the current active sibling(s) BEFORE activating this one.
    await trx.run(
      `UPDATE agent_versions SET status = 'retired', updated_at = NOW()
         WHERE agent_row_id = ? AND status = 'active' AND id <> ?`,
      [version.agent_row_id, versionId]
    );

    const promoted = await trx.get(
      `UPDATE agent_versions SET status = 'active', updated_at = NOW()
         WHERE id = ? RETURNING *`,
      [versionId]
    );
    return promoted;
  });
}

/**
 * Retire a revision (idempotent). A retired active revision leaves the agent
 * with no active version until another is promoted.
 * @param {number} versionId
 * @returns {Promise<Object|null>} the retired row, or null if not found
 */
export async function retireAgentVersion(versionId) {
  const row = await dbGet(
    `UPDATE agent_versions SET status = 'retired', updated_at = NOW()
       WHERE id = ? RETURNING *`,
    [versionId]
  );
  return row || null;
}

/** Fetch a single revision by id. */
export async function getAgentVersion(versionId) {
  return (await dbGet('SELECT * FROM agent_versions WHERE id = ?', [versionId])) || null;
}

/** List all revisions for an agent, newest version first. */
export async function listAgentVersions(agentRowId) {
  return dbAll(
    'SELECT * FROM agent_versions WHERE agent_row_id = ? ORDER BY version_int DESC',
    [agentRowId]
  );
}

/** The current active revision for an agent, or null. */
export async function getActiveVersion(agentRowId) {
  return (
    (await dbGet(
      `SELECT * FROM agent_versions WHERE agent_row_id = ? AND status = 'active'`,
      [agentRowId]
    )) || null
  );
}

export default {
  AGENTS_TABLE_ID,
  VERSION_STATUSES,
  assertAgentRow,
  mintAgentVersion,
  promoteAgentVersion,
  retireAgentVersion,
  getAgentVersion,
  listAgentVersions,
  getActiveVersion,
};
