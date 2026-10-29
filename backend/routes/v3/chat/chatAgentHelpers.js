/**
 * Chat agent resolution and helper functions.
 * Handles resolving @mentions, /commands, and agent user accounts.
 * Sub-agent functions are in chatAgentSubAgents.js and re-exported here
 * for backward compatibility.
 */

import {
  dbRun, dbGet, dbAll, isPostgres, safeJsonParse, apiLogger,
  _resolveAgentUserService,
} from './chatShared.js';
// Re-export sub-agent functions for backward compatibility
export {
  validateSubAgentRowIds,
  enrichSubAgents,
  autoJoinAgentToConversation,
  resolveAgentInfoForMessages,
} from './chatAgentSubAgents.js';

/**
 * Ticket #41834: Resolve @mention slug to ANY user (human OR agent).
 */
async function resolveMentionedUser(slug) {
  if (!slug || typeof slug !== 'string') return null;
  const normalizedSlug = slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (!normalizedSlug) return null;

  try {
    // ADR-164 D3: agents resolve through the single canonical pointer-first
    // service (handle -> passport -> residence config, then a deprecated
    // exact slug-by-name fallback — no fuzzy). This is the only agent path.
    const agentResolved = await _resolveAgentUserService(normalizedSlug);
    if (agentResolved && agentResolved.user) {
      return { user: agentResolved.user, isAgent: true };
    }

    // Non-agent (human) users: exact match on handle or name-slug only.
    // The substring fuzzy fallback (cross-identity collisions) and the
    // by-name AI-Agents backfill (the auto-write anti-pattern) are removed.
    const allUsers = await dbAll(
      `SELECT * FROM users WHERE user_type IN ('human', 'agent', 'bot', 'service') ORDER BY id`
    );
    let matchedUser = null;
    for (const user of allUsers) {
      const handleSlug = user.handle ? String(user.handle).toLowerCase() : null;
      const nameSlug = user.name ? user.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') : null;
      if (handleSlug === normalizedSlug || nameSlug === normalizedSlug) {
        matchedUser = user;
        break;
      }
    }

    if (!matchedUser) {
      apiLogger.debug({ slug, normalizedSlug }, 'ADR-164 resolveMentionedUser: no user found for @mention slug');
      return null;
    }

    const isAgent = matchedUser.user_type === 'agent' || matchedUser.user_type === 'bot';
    return { user: matchedUser, isAgent };
  } catch (err) {
    apiLogger.error({ err, slug }, 'ADR-164 resolveMentionedUser: error resolving mentioned user');
    return null;
  }
}

/**
 * ADR-091 Phase 2 / Ticket #41158 AC11: Resolve real sender_id for agent messages.
 */
async function resolveAgentSenderId(agent) {
  if (agent.id) {
    apiLogger.debug({ senderId: agent.id, agentName: agent.name }, 'Ticket #41158: sender_id resolved from agent.id (fast path)');
    return agent.id;
  }

  const agentRowId = agent.managed_by_agent_row_id || agent._agentConfig?.row_id || null;
  if (!agentRowId) {
    apiLogger.warn({ agentName: agent.name }, 'Ticket #41158: No agent.id and no agentRowId — sender_id will be null (fallback)');
    return null;
  }

  try {
    const existingUser = await dbGet(
      isPostgres()
        ? `SELECT id FROM users WHERE managed_by_agent_row_id = $1 AND user_type = 'agent'`
        : `SELECT id FROM users WHERE managed_by_agent_row_id = ? AND user_type = 'agent'`,
      [agentRowId]
    );

    if (existingUser) {
      apiLogger.info({ senderId: existingUser.id, agentRowId, agentName: agent.name }, 'Ticket #41158: sender_id resolved from existing agent user');
      return existingUser.id;
    }

    const agentName = agent.name || agent._agentConfig?.name || 'AI Agent';
    const nameSlug = agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const hash = agentRowId.toString(36);
    const agentEmail = `${nameSlug}-${hash}@agents.godcrm.local`;

    const agentTableRow = await dbGet(
      isPostgres()
        ? `SELECT table_id FROM table_rows WHERE id = $1`
        : `SELECT table_id FROM table_rows WHERE id = ?`,
      [agentRowId]
    );

    const insertSql = isPostgres()
      ? `INSERT INTO users (email, name, password_hash, encryption_key_encrypted, user_type, managed_by_agent_table_id, managed_by_agent_row_id, agent_config, created_at, updated_at)
         VALUES ($1, $2, '$2b$10$placeholder_hash_for_agent_user_no_login', 'agent-no-encryption-key', 'agent', $3, $4, $5::jsonb, NOW(), NOW())
         ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
         RETURNING id`
      : `INSERT OR IGNORE INTO users (email, name, user_type, managed_by_agent_table_id, managed_by_agent_row_id, agent_config, created_at, updated_at)
         VALUES (?, ?, 'agent', ?, ?, ?, datetime('now'), datetime('now'))`;

    await dbRun(insertSql, [
      agentEmail,
      agentName,
      agentTableRow?.table_id || null,
      agentRowId,
      JSON.stringify({ auto_respond: true, context_settings: { max_history: 50 } })
    ]);

    const newUser = await dbGet(
      isPostgres()
        ? `SELECT id FROM users WHERE managed_by_agent_row_id = $1 AND user_type = 'agent'`
        : `SELECT id FROM users WHERE managed_by_agent_row_id = ? AND user_type = 'agent'`,
      [agentRowId]
    );

    if (newUser) {
      apiLogger.info({ senderId: newUser.id, agentRowId, agentName }, 'Ticket #41158: sender_id resolved by creating new agent user');
      return newUser.id;
    }

    apiLogger.warn({ agentRowId, agentName }, 'Ticket #41158: Agent user creation succeeded but SELECT returned null — sender_id fallback to null');
    return null;
  } catch (err) {
    apiLogger.warn({ err, agentRowId, agentName: agent.name }, 'Ticket #41158: Could not resolve sender_id, falling back to null');
    return null;
  }
}

/**
 * ADR-069: Find AI Agent by /command name
 */
async function findAiAgentByCommand(command, spaceId = null) {
  const aiAgentRows = spaceId
    ? await dbAll(
        isPostgres()
          ? `SELECT tr.id as row_id, tr.data FROM table_rows tr
             JOIN universal_tables ut ON tr.table_id = ut.id
             JOIN projects p ON ut.project_id = p.id
             WHERE ut.name = 'AI Agents' AND p.space_id = $1`
          : `SELECT tr.id as row_id, tr.data FROM table_rows tr
             JOIN universal_tables ut ON tr.table_id = ut.id
             JOIN projects p ON ut.project_id = p.id
             WHERE ut.name = 'AI Agents' AND p.space_id = ?`,
        [spaceId]
      )
    : await dbAll(
        isPostgres()
          ? `SELECT tr.id as row_id, tr.data FROM table_rows tr
             JOIN universal_tables ut ON tr.table_id = ut.id
             WHERE ut.name = 'AI Agents'`
          : `SELECT tr.id as row_id, tr.data FROM table_rows tr
             JOIN universal_tables ut ON tr.table_id = ut.id
             WHERE ut.name = 'AI Agents'`
      );

  for (const row of aiAgentRows) {
    const agentData = safeJsonParse(row.data, {});
    if (!agentData.name || agentData.status === 'inactive') continue;
    const nameSlug = agentData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    // Bug 1552/228714: the row's own `slug` (e.g. developer-ralph, marketer)
    // is what people type after `/`; the name-derived slug stays as fallback.
    const explicitSlug = typeof agentData.slug === 'string' ? agentData.slug.trim().toLowerCase() : null;
    if (nameSlug === command || explicitSlug === command) {
      apiLogger.info({ command, foundAgent: agentData.name, rowId: row.row_id }, 'Found AI Agent (exact match)');
      return {
        id: null,
        name: agentData.name,
        email: null,
        managed_by_agent_row_id: row.row_id,
        _isAiAgentRow: true,
        _agentConfig: { ...agentData, row_id: row.row_id }
      };
    }
  }

  apiLogger.debug({ command }, 'ADR-083: No exact match for agent command');
  return null;
}

/**
 * ADR-091 / Ticket #41156 → ADR-164: Resolve agent user by slug.
 *
 * Thin wrapper over the canonical pointer-first service. `spaceId` is retained
 * in the signature for call-site compatibility but is no longer used for
 * scoping: global <<@slug>> resolves by passport handle, and the deprecated
 * slug-by-name fallback is exact-match only (no fuzzy, no space filter).
 *
 * Returns the augmented agent user object (with `_isAiAgentRow` / `_agentConfig`)
 * or null — the same shape callers already expect.
 */
async function resolveAgentUser(agentSlug, spaceId = null) { // eslint-disable-line no-unused-vars
  if (!agentSlug || typeof agentSlug !== 'string') return null;
  const resolved = await _resolveAgentUserService(agentSlug);
  return resolved ? resolved.user : null;
}

export {
  resolveMentionedUser,
  resolveAgentSenderId,
  findAiAgentByCommand,
  resolveAgentUser,
};
