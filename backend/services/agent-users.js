/**
 * Agent User Resolution Service
 * ADR-091 Phase 1, Task 3 — Ticket #41156, AC10
 *
 * Provides a unified resolveAgentUser(identifier) function that consolidates
 * all the scattered agent-resolution logic into a single, reusable service.
 *
 * Resolution strategies (tried in order):
 *   1. Direct row_id  — numeric ID referencing a row in the AI Agents table
 *   2. Slug match     — @mention or /command text normalised to a slug
 *      2a. Passport handle (ADR-164 D3, pointer-first): handle -> users ->
 *          (managed_by_agent_table_id, managed_by_agent_row_id) -> config.
 *          Never scans by name, never mints a passport.
 *      2b. Deprecated slug-by-name fallback — EXACT match only, emits a WARN
 *          (event 'deprecated_slug_resolve'); removed in Phase 4. The fuzzy
 *          (contains/prefix) pass was deleted (ADR-164): it let a same-named
 *          agent from another space hijack an invocation.
 *
 * Once the agent row is located the function either returns the existing
 * user account (user_type='agent', managed_by_agent_row_id) or creates
 * one on the fly, reusing the same email-derivation pattern as
 * backend/routes/v3/agent-users.js::createAgentUser().
 *
 * Return shape on success:
 *   { userId, agentRowId, agentConfig, user }
 *   where `user` is the full users-row object augmented with _agentConfig.
 *
 * Return: null when the identifier cannot be resolved.
 *
 * Consumers:
 *   - backend/routes/v3/chat.js  (send-message agent dispatch)
 *   - backend/services/ChainHandoffService.js (future)
 *   - backend/services/AgentToolsService.js   (future)
 */

import { dbGet, dbAll, dbRun, safeJsonParse } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise any identifier string into a lowercase slug.
 * Strips leading @ or / prefixes, collapses non-alphanumeric runs to "-".
 *
 * @param {string} raw - Raw identifier text
 * @returns {string} Normalised slug, or empty string
 */
function normaliseSlug(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .trim()
    .replace(/^[@/]+/, '')          // strip @ or / prefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')   // collapse non-alphanum to dash
    .replace(/^-+|-+$/g, '');       // trim leading/trailing dashes
}

/**
 * Derive a deterministic agent email from an agent name and row_id.
 * Uses the row_id encoded in base-36 instead of a random hash so that
 * repeated calls for the same agent produce the same email (idempotent).
 *
 * @param {string} agentName - Human-readable agent name
 * @param {number} rowId     - Agent row id in the AI Agents table
 * @returns {string} Email in format: slug-base36id@agents.godcrm.local
 */
function deriveAgentEmail(agentName, rowId) {
  const slug = normaliseSlug(agentName) || 'agent';
  const hash = rowId.toString(36);
  return `${slug}-${hash}@agents.godcrm.local`;
}

// ---------------------------------------------------------------------------
// Core: fetch all active agent rows (cached per-request is caller's concern)
// ---------------------------------------------------------------------------

/**
 * Fetch every active row from the AI Agents table.
 * Each returned object contains { row_id, table_id, agentData, nameSlug }.
 *
 * @returns {Promise<Array<{row_id: number, table_id: number, agentData: Object, nameSlug: string}>>}
 */
async function fetchActiveAgentRows() {
  const rows = await dbAll(
    `SELECT tr.id AS row_id, tr.data, ut.id AS table_id
     FROM table_rows tr
     JOIN universal_tables ut ON tr.table_id = ut.id
     WHERE ut.name = 'AI Agents'`
  );

  const result = [];
  for (const row of rows) {
    const agentData = safeJsonParse(row.data, {});
    if (!agentData.name || agentData.status === 'inactive') continue;
    const nameSlug = normaliseSlug(agentData.name);
    result.push({
      row_id: row.row_id,
      table_id: row.table_id,
      agentData,
      nameSlug,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Core: find-or-create the user account for an agent row
// ---------------------------------------------------------------------------

/**
 * Given a matched agent row, return the existing user account or create one.
 *
 * @param {{row_id: number, table_id: number, agentData: Object}} matchedRow
 * @returns {Promise<Object|null>} Augmented user object or null
 */
async function findOrCreateAgentUserForRow(matchedRow) {
  const { row_id, table_id, agentData } = matchedRow;

  // --- Try to find existing user ---
  const existingUser = await dbGet(
    `SELECT * FROM users WHERE managed_by_agent_row_id = $1 AND user_type = 'agent'`,
    [row_id]
  );

  if (existingUser) {
    apiLogger.debug(
      { userId: existingUser.id, agentRowId: row_id },
      'ADR-091 resolveAgentUser: found existing agent user'
    );
    return buildResult(existingUser, matchedRow);
  }

  // --- Create new agent user ---
  apiLogger.info(
    { agentRowId: row_id, agentName: agentData.name },
    'ADR-091 resolveAgentUser: creating new agent user'
  );

  const agentEmail = deriveAgentEmail(agentData.name, row_id);
  const defaultConfig = JSON.stringify({
    auto_respond: true,
    respond_only_when_mentioned: false,
    context_settings: { max_history: 50, include_summaries: true },
  });

  // password_hash and encryption_key_encrypted are NOT NULL in users table.
  // Agent users don't need real passwords or encryption keys, but the
  // columns must be populated.  Use a placeholder bcrypt hash (cost=4,
  // nobody can log in with it) and a deterministic placeholder key.
  const placeholderPasswordHash = '$2b$04$agent.nologin.placeholder.hash.000000000000000000000';
  const placeholderEncryptionKey = `agent-no-encryption-${row_id}`;

  await dbRun(
    `INSERT INTO users (email, name, password_hash, encryption_key_encrypted,
         user_type, managed_by_agent_table_id,
         managed_by_agent_row_id, agent_config, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'agent', $5, $6, $7, NOW(), NOW())
     ON CONFLICT (email) DO UPDATE SET name = $2, updated_at = NOW()
     RETURNING *`,
    [agentEmail, agentData.name, placeholderPasswordHash, placeholderEncryptionKey, table_id, row_id, defaultConfig]
  );

  // Re-fetch to get the canonical row
  const newUser = await dbGet(
    `SELECT * FROM users WHERE managed_by_agent_row_id = $1 AND user_type = 'agent'`,
    [row_id]
  );

  if (newUser) {
    apiLogger.info(
      { userId: newUser.id, agentRowId: row_id },
      'ADR-091 resolveAgentUser: agent user created'
    );
    return buildResult(newUser, matchedRow);
  }

  return null;
}

/**
 * Build the standardised return object for resolveAgentUser().
 *
 * @param {Object} userRow     - Raw row from the users table
 * @param {Object} matchedRow  - Matched agent-row metadata
 * @returns {Object} { userId, agentRowId, agentConfig, user }
 */
function buildResult(userRow, matchedRow) {
  const { row_id, agentData } = matchedRow;
  const agentConfig = { ...agentData, row_id };

  // Augmented user object (backward-compatible with chat.js expectations)
  const user = {
    ...userRow,
    managed_by_agent_row_id: row_id,
    _isAiAgentRow: true,
    _agentConfig: agentConfig,
  };

  return {
    userId: userRow.id,
    agentRowId: row_id,
    agentConfig,
    user,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Unified agent user resolution.
 *
 * Accepts any of the following identifier formats:
 *   - `@agent-name`          — @mention text (prefix stripped automatically)
 *   - `/agent-name`          — /command text  (prefix stripped automatically)
 *   - `"agent-name"`         — bare slug / name string
 *   - `123` or `"123"`       — direct row_id (numeric or numeric string)
 *   - `{ row_id: 123 }`     — object with row_id (from sub_agents JSONB)
 *
 * Resolution strategy:
 *   1. If the identifier is numeric (or an object with row_id), look up the
 *      AI Agents table row directly by id.
 *   2. Otherwise normalise to a slug and resolve pointer-first (ADR-164 D3):
 *      a. Passport handle — handle -> users -> residence pointer -> config.
 *      b. Deprecated exact slug-by-name fallback (WARN 'deprecated_slug_resolve';
 *         removed in Phase 4). The fuzzy contains/prefix pass was deleted.
 *   3. On the handle path the passport already exists; on the deprecated
 *      fallback the corresponding user account is found or created.
 *
 * @param {string|number|{row_id: number}} identifier
 *   Agent identifier — slug, name, @mention, /command, row_id, or object.
 * @returns {Promise<{userId: number, agentRowId: number, agentConfig: Object, user: Object}|null>}
 *   Resolved agent info, or null if the agent could not be found.
 *
 * @example
 * // @mention  (prefix stripped automatically)
 * const a1 = await resolveAgentUser('@workspace-manager');
 * // => { userId: 5, agentRowId: 12, agentConfig: {...}, user: {...} }
 *
 * @example
 * // /command  (prefix stripped automatically)
 * const a2 = await resolveAgentUser('/claude-assistant');
 *
 * @example
 * // Direct row_id
 * const a3 = await resolveAgentUser(42);
 *
 * @example
 * // Object from sub_agents JSONB
 * const a4 = await resolveAgentUser({ row_id: 42 });
 *
 * @example
 * // Unknown identifier
 * const a5 = await resolveAgentUser('nonexistent');
 * // => null
 */
export async function resolveAgentUser(identifier) {
  if (identifier == null) return null;

  try {
    // --- Strategy 1: Direct row_id ---
    const rowId = extractRowId(identifier);
    if (rowId !== null) {
      return await resolveByRowId(rowId);
    }

    // --- Strategy 2: Slug-based resolution ---
    if (typeof identifier !== 'string') return null;
    const slug = normaliseSlug(identifier);
    if (!slug) return null;

    // ADR-164 D3: global <<@slug>> is pointer-first —
    //   handle -> users -> (managed_by_agent_table_id, managed_by_agent_row_id) -> config.
    const byHandle = await resolveByHandle(slug);
    if (byHandle) return byHandle;

    // Deprecated fallback: slug-by-name (exact match only). Kept behind a WARN
    // metric (`deprecated_slug_resolve`) for the transition; removed in Phase 4.
    return await resolveBySlug(slug);
  } catch (err) {
    apiLogger.error({ err, identifier }, 'ADR-091 resolveAgentUser: unexpected error');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Strategy 1 — resolve by direct row_id
// ---------------------------------------------------------------------------

/**
 * Extract a numeric row_id from the identifier, or return null.
 *
 * @param {*} identifier
 * @returns {number|null}
 */
function extractRowId(identifier) {
  // Plain number
  if (typeof identifier === 'number' && Number.isFinite(identifier) && identifier > 0) {
    return identifier;
  }
  // Object with row_id (from sub_agents JSONB)
  if (typeof identifier === 'object' && identifier !== null && typeof identifier.row_id === 'number') {
    return identifier.row_id;
  }
  // Numeric string
  if (typeof identifier === 'string') {
    const stripped = identifier.replace(/^[@/]+/, '').trim();
    const num = Number(stripped);
    if (Number.isFinite(num) && num > 0 && String(Math.floor(num)) === stripped) {
      return num;
    }
  }
  return null;
}

/**
 * Resolve an agent directly by its row_id in the AI Agents table.
 *
 * @param {number} rowId
 * @returns {Promise<Object|null>}
 */
async function resolveByRowId(rowId) {
  const row = await dbGet(
    `SELECT tr.id AS row_id, tr.data, ut.id AS table_id
     FROM table_rows tr
     JOIN universal_tables ut ON tr.table_id = ut.id
     WHERE ut.name = 'AI Agents' AND tr.id = $1`,
    [rowId]
  );

  if (!row) {
    apiLogger.debug({ rowId }, 'ADR-091 resolveAgentUser: no agent row for row_id');
    return null;
  }

  const agentData = safeJsonParse(row.data, {});
  if (agentData.status === 'inactive') {
    apiLogger.debug({ rowId, agentName: agentData.name }, 'ADR-091 resolveAgentUser: agent is inactive');
    return null;
  }

  return findOrCreateAgentUserForRow({
    row_id: row.row_id,
    table_id: row.table_id,
    agentData,
  });
}

// ---------------------------------------------------------------------------
// Strategy 2a — resolve by passport handle (ADR-164 D3, pointer-first)
// ---------------------------------------------------------------------------

/**
 * Resolve a global agent invocation by its passport handle.
 *
 *   handle -> users(user_type='agent') -> managed_by_agent_row_id -> config row
 *
 * Strictly pointer-first: never scans agent rows by name and never mints a
 * passport (the passport already exists — that is the whole point of a handle).
 * Returns null (so the caller falls through to the deprecated slug fallback)
 * when there is no matching handle, when the passport has no residence pointer,
 * or when the pointer dangles (orphan passport — flagged for the watchdog).
 *
 * @param {string} slug - Normalised slug (matched case-insensitively against handle)
 * @returns {Promise<Object|null>}
 */
async function resolveByHandle(slug) {
  const passport = await dbGet(
    `SELECT * FROM users WHERE lower(handle) = $1 AND user_type = 'agent'`,
    [slug]
  );
  if (!passport) return null;

  if (!passport.managed_by_agent_row_id) {
    apiLogger.warn(
      { handle: slug, userId: passport.id },
      'ADR-164 resolveAgentUser: passport has handle but no residence pointer'
    );
    return null;
  }

  const row = await dbGet(
    `SELECT tr.id AS row_id, tr.data, tr.table_id
     FROM table_rows tr
     WHERE tr.id = $1`,
    [passport.managed_by_agent_row_id]
  );
  if (!row) {
    apiLogger.warn(
      { handle: slug, userId: passport.id, agentRowId: passport.managed_by_agent_row_id },
      'ADR-164 resolveAgentUser: dangling residence pointer (orphan passport)'
    );
    return null;
  }

  const agentData = safeJsonParse(row.data, {});
  apiLogger.debug(
    { handle: slug, userId: passport.id, agentRowId: row.row_id },
    'ADR-164 resolveAgentUser: resolved passport-first by handle'
  );
  return buildResult(passport, { row_id: row.row_id, table_id: row.table_id, agentData });
}

// ---------------------------------------------------------------------------
// Strategy 2b — resolve by slug (@mention / /command / bare name) — DEPRECATED
// ---------------------------------------------------------------------------

/**
 * Resolve an agent by exact normalised-slug match against the agent name.
 *
 * ADR-164 D3: this is the deprecated slug-by-name fallback, reached only when
 * no passport handle matched. Exact match only — the fuzzy (contains/prefix)
 * pass was removed because it let a same-named agent from another space hijack
 * an invocation. Every hit emits a WARN carrying event:'deprecated_slug_resolve'
 * so the fallback can be removed by metrics in Phase 4.
 *
 * @param {string} slug - Normalised slug
 * @returns {Promise<Object|null>}
 */
async function resolveBySlug(slug) {
  const activeRows = await fetchActiveAgentRows();

  let matchedRow = null;
  for (const row of activeRows) {
    if (row.nameSlug === slug) {
      matchedRow = row;
      break;
    }
  }

  if (!matchedRow) {
    apiLogger.debug({ slug }, 'ADR-091 resolveAgentUser: no agent found for slug');
    return null;
  }

  apiLogger.warn(
    { slug, agentRowId: matchedRow.row_id, agentName: matchedRow.agentData?.name, event: 'deprecated_slug_resolve' },
    'ADR-164 resolveAgentUser: slug-by-name fallback used (no passport handle matched) — deprecated, removed in Phase 4'
  );
  return findOrCreateAgentUserForRow(matchedRow);
}

// ---------------------------------------------------------------------------
// ADR-164 Phase 2 — Passport lifecycle (naturalization)
// ---------------------------------------------------------------------------

/**
 * Merge a `passport` audit block into a users.agent_config JSONB value.
 * Read-modify-write on a single row (no jsonb_set gymnastics) so unrelated
 * agent_config keys are preserved.
 *
 * @param {Object|string|null} existingConfig - Current users.agent_config
 * @param {Object} passportPatch - Fields to merge into agent_config.passport
 * @returns {Object} New agent_config object
 */
function mergePassportAudit(existingConfig, passportPatch) {
  const cfg =
    existingConfig && typeof existingConfig === 'object'
      ? existingConfig
      : safeJsonParse(existingConfig, {}) || {};
  return { ...cfg, passport: { ...(cfg.passport || {}), ...passportPatch } };
}

/**
 * issuePassport — ADR-164 Phase 2 naturalization (explicit act).
 *
 * Grants an agent residence a global `<<@handle>>` passport. Idempotent: an
 * existing passport for the same residence is reused, never duplicated — the
 * D6 residence unique index guarantees one passport per residence. The handle
 * is (re)set and any prior revocation marker is cleared.
 *
 * Residence is located, in precedence order, from: explicit `row_id`, `user_id`
 * (→ its managed_by_agent_row_id), or `handle` (→ existing passport). The
 * handle to assign is `handle` if given, else the passport's current handle,
 * else the agent row's slug/name. Find-or-create reuses the canonical
 * resolveAgentUser() — no second resolve path is introduced.
 *
 * @param {Object} input
 * @param {string} [input.handle]  - Global handle to assign (case-insensitive)
 * @param {number} [input.user_id] - Existing passport id (alt. residence locator)
 * @param {number} [input.table_id]- Residence table id (informational)
 * @param {number} [input.row_id]  - Residence AI Agents row id
 * @param {number|string} [input.actor] - Id of the user performing the act
 * @returns {Promise<Object>} { ok, ... }
 */
export async function issuePassport({ handle, user_id, table_id, row_id, actor } = {}) {
  // 1. Locate the residence agent row id.
  let residenceRowId =
    Number.isFinite(Number(row_id)) && Number(row_id) > 0 ? Number(row_id) : null;
  if (!residenceRowId && user_id) {
    const u = await dbGet(
      `SELECT managed_by_agent_row_id FROM users WHERE id = $1 AND user_type = 'agent'`,
      [user_id]
    );
    residenceRowId = u?.managed_by_agent_row_id ?? null;
  }
  if (!residenceRowId && handle) {
    const p = await dbGet(
      `SELECT managed_by_agent_row_id FROM users WHERE lower(handle) = lower($1) AND user_type = 'agent'`,
      [handle]
    );
    residenceRowId = p?.managed_by_agent_row_id ?? null;
  }
  if (!residenceRowId) {
    return {
      ok: false,
      error: 'residence_not_found',
      message:
        'issue_passport needs one of: row_id, user_id, or an existing handle to locate the agent residence.',
    };
  }

  // 2. Canonical find-or-create passport (idempotent via residence unique index).
  const resolved = await resolveAgentUser(residenceRowId);
  if (!resolved) {
    return {
      ok: false,
      error: 'agent_unresolvable',
      message: `No active AI Agents row for row_id ${residenceRowId}.`,
    };
  }

  // 3. Decide the handle to assign.
  const desired = normaliseSlug(
    handle || resolved.user?.handle || resolved.agentConfig?.slug || resolved.agentConfig?.name || ''
  );
  if (!desired) {
    return {
      ok: false,
      error: 'handle_required',
      message: 'Could not determine a handle — pass `handle` explicitly.',
    };
  }

  // 4. Guard the global-unique handle index with a clean error (not a raw PG throw).
  const clash = await dbGet(
    `SELECT id, email FROM users WHERE lower(handle) = lower($1) AND id <> $2`,
    [desired, resolved.userId]
  );
  if (clash) {
    return {
      ok: false,
      error: 'handle_taken',
      message: `Handle '${desired}' is already held by user ${clash.id} (${clash.email}).`,
    };
  }

  // 5. Idempotency short-circuit: same handle already active → no write.
  const current = await dbGet(`SELECT handle, agent_config FROM users WHERE id = $1`, [
    resolved.userId,
  ]);
  const currentCfg = current?.agent_config;
  const alreadyActive =
    current?.handle &&
    normaliseSlug(current.handle) === desired &&
    safeJsonParse(currentCfg, {})?.passport?.status !== 'revoked';
  if (alreadyActive) {
    return {
      ok: true,
      changed: false,
      idempotent: true,
      user_id: resolved.userId,
      agent_row_id: resolved.agentRowId,
      handle: current.handle,
    };
  }

  // 6. Write handle + audit stamp (clears any prior revoked marker).
  const audit = mergePassportAudit(currentCfg, {
    status: 'active',
    handle: desired,
    issued_by: actor ?? null,
    issued_at: new Date().toISOString(),
    revoked_by: null,
    revoked_at: null,
  });
  await dbRun(`UPDATE users SET handle = $1, agent_config = $2, updated_at = NOW() WHERE id = $3`, [
    desired,
    JSON.stringify(audit),
    resolved.userId,
  ]);

  return {
    ok: true,
    changed: true,
    user_id: resolved.userId,
    agent_row_id: resolved.agentRowId,
    handle: desired,
  };
}

/**
 * revokePassport — ADR-164 Phase 2 soft revocation (downgrade to sub-agent).
 *
 * Soft, not physical: the users row is kept. The global handle is cleared
 * (NULL), so resolveByHandle() no longer matches it — the agent drops out of
 * the pointer-first path and is reachable only locally (as a sub-agent) inside
 * its own space. Reversible via issuePassport(). Records the actor.
 *
 * NB (transition): while the deprecated slug-by-name fallback still exists
 * (removed in Phase 4) a revoked agent can still be reached by exact name via
 * that fallback (which emits `deprecated_slug_resolve`). Full sub-agent-only
 * enforcement lands when Phase 4 removes the fallback. This function
 * deliberately does not touch the resolver.
 *
 * @param {Object} input
 * @param {string} [input.handle]  - Current handle of the agent to revoke
 * @param {number} [input.user_id] - Passport id to revoke (alt. to handle)
 * @param {number|string} [input.actor] - Id of the user performing the act
 * @returns {Promise<Object>} { ok, ... }
 */
export async function revokePassport({ handle, user_id, actor } = {}) {
  let passport = null;
  if (user_id) {
    passport = await dbGet(`SELECT * FROM users WHERE id = $1 AND user_type = 'agent'`, [user_id]);
  } else if (handle) {
    passport = await dbGet(
      `SELECT * FROM users WHERE lower(handle) = lower($1) AND user_type = 'agent'`,
      [handle]
    );
  }
  if (!passport) {
    return {
      ok: false,
      error: 'passport_not_found',
      message:
        'revoke_passport needs a user_id or an active handle that resolves to an agent passport.',
    };
  }

  // Idempotent: already revoked (no handle) → no write.
  if (!passport.handle) {
    return { ok: true, changed: false, idempotent: true, user_id: passport.id, handle: null };
  }

  const priorHandle = passport.handle;
  const audit = mergePassportAudit(passport.agent_config, {
    status: 'revoked',
    prior_handle: priorHandle,
    revoked_by: actor ?? null,
    revoked_at: new Date().toISOString(),
  });
  await dbRun(`UPDATE users SET handle = NULL, agent_config = $1, updated_at = NOW() WHERE id = $2`, [
    JSON.stringify(audit),
    passport.id,
  ]);

  return { ok: true, changed: true, revoked: true, user_id: passport.id, prior_handle: priorHandle };
}

// ---------------------------------------------------------------------------
// Re-exported helpers (useful for callers that parse messages themselves)
// ---------------------------------------------------------------------------

export { normaliseSlug, deriveAgentEmail, fetchActiveAgentRows };
