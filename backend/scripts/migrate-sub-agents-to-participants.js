/**
 * Data Migration: sub_agents JSONB → conversation_participants
 * ADR-091 Phase 2 / Ticket #41163
 *
 * Context:
 *   Existing conversations store agent references in the sub_agents JSONB column.
 *   New code (ADR-091 dual-write) writes agents to BOTH sub_agents AND
 *   conversation_participants.  This one-time script back-fills conversation_participant
 *   records for all historical conversations that only have sub_agents entries.
 *
 * Strategy:
 *   1. Find every conversation where sub_agents is non-empty.
 *   2. For each element in the sub_agents array (plain row_id or { row_id, response_mode }),
 *      call resolveAgentUser() to find-or-create the agent user account.
 *   3. Insert a conversation_participant row (user_type = 'agent', role = 'member')
 *      preserving the response_mode as agent_response_mode.
 *   4. Use ON CONFLICT DO NOTHING so the script is safe to re-run (idempotent).
 *   5. sub_agents JSONB is NOT modified (backward-compat preserved).
 *
 * Usage:
 *   node backend/scripts/migrate-sub-agents-to-participants.js
 *   # or with dotenv
 *   DATABASE_TYPE=postgres PGPASSWORD=... node backend/scripts/migrate-sub-agents-to-participants.js
 */

import { dbAll, dbRun, isPostgres, safeJsonParse } from '../database/connection.js';
import { resolveAgentUser } from '../services/agent-users.js';
import { apiLogger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a sub_agents value from a conversations row.
 * Handles:
 *   - Already a JS array  (when PG returns parsed JSONB)
 *   - A JSON string       (SQLite TEXT column)
 *   - null / empty        → returns []
 *
 * Normalised entries always have shape: { row_id: number, response_mode?: string }
 *
 * @param {*} raw
 * @returns {{ row_id: number, response_mode?: string }[]}
 */
function parseSubAgents(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : safeJsonParse(raw, []);
  if (!Array.isArray(arr) || arr.length === 0) return [];

  return arr
    .map((entry) => {
      if (typeof entry === 'number' && Number.isFinite(entry) && entry > 0) {
        return { row_id: entry };
      }
      if (typeof entry === 'object' && entry !== null && typeof entry.row_id === 'number') {
        return { row_id: entry.row_id, response_mode: entry.response_mode ?? null };
      }
      return null;
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Main migration
// ---------------------------------------------------------------------------

async function migrate() {
  const log = apiLogger.child({ script: 'migrate-sub-agents-to-participants' });
  log.info('Starting migration: sub_agents → conversation_participants');

  // ------------------------------------------------------------------
  // 1. Fetch all conversations that have non-empty sub_agents
  // ------------------------------------------------------------------
  const pg = isPostgres();

  const conversations = await dbAll(
    pg
      ? `SELECT id, sub_agents
           FROM conversations
          WHERE sub_agents IS NOT NULL
            AND sub_agents != '[]'::jsonb
            AND jsonb_array_length(sub_agents) > 0`
      : `SELECT id, sub_agents
           FROM conversations
          WHERE sub_agents IS NOT NULL
            AND sub_agents != '[]'
            AND sub_agents != ''`
  );

  log.info({ count: conversations.length }, 'Conversations with non-empty sub_agents found');

  if (conversations.length === 0) {
    log.info('Nothing to migrate — exiting');
    return { migrated: 0, skipped: 0, errors: 0 };
  }

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  // ------------------------------------------------------------------
  // 2. For each conversation × sub_agent, find/create user + insert participant
  // ------------------------------------------------------------------
  for (const conv of conversations) {
    const entries = parseSubAgents(conv.sub_agents);

    if (entries.length === 0) {
      log.debug({ conversationId: conv.id }, 'sub_agents array is empty after parsing — skipping');
      skipped++;
      continue;
    }

    for (const entry of entries) {
      try {
        // 2a. Find or create agent user via the unified resolver
        const resolved = await resolveAgentUser(entry.row_id);

        if (!resolved) {
          log.warn(
            { conversationId: conv.id, agentRowId: entry.row_id },
            'resolveAgentUser returned null — agent row may be deleted or inactive, skipping'
          );
          skipped++;
          continue;
        }

        const { userId } = resolved;
        const responseMode = entry.response_mode ?? null;

        // 2b. Upsert conversation_participant (ON CONFLICT DO NOTHING = idempotent)
        if (pg) {
          await dbRun(
            `INSERT INTO conversation_participants
               (conversation_id, user_id, role, user_type, agent_response_mode, joined_at)
             VALUES ($1, $2, 'member', 'agent', $3, NOW())
             ON CONFLICT (conversation_id, user_id) DO NOTHING`,
            [conv.id, userId, responseMode]
          );
        } else {
          // SQLite: INSERT OR IGNORE is the idempotent equivalent
          await dbRun(
            `INSERT OR IGNORE INTO conversation_participants
               (conversation_id, user_id, role, user_type, agent_response_mode, joined_at)
             VALUES (?, ?, 'member', 'agent', ?, datetime('now'))`,
            [conv.id, userId, responseMode]
          );
        }

        log.info(
          {
            conversationId: conv.id,
            agentRowId: entry.row_id,
            userId,
            responseMode,
          },
          'Inserted/confirmed conversation_participant for agent'
        );
        migrated++;
      } catch (err) {
        log.error(
          { conversationId: conv.id, agentRowId: entry.row_id, err },
          'Error processing sub_agent entry'
        );
        errors++;
      }
    }
  }

  const summary = { migrated, skipped, errors };
  log.info(summary, 'Migration complete');
  return summary;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
migrate()
  .then(({ migrated, skipped, errors }) => {
    console.log(`\n✅ Migration complete — processed: ${migrated}, skipped: ${skipped}, errors: ${errors}`);
    if (errors > 0) {
      console.error(`⚠️  ${errors} error(s) occurred — check logs above`);
      process.exit(1);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Migration failed with unexpected error:', err);
    process.exit(1);
  });
