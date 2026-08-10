// ADR-0057-A WP-B — Per-conversation "who's working right now?" query.
//
// Source of truth for the chat presence array (`active_agents[]`). Returns
// one row per agent currently bound to a conversation, drawn from BOTH:
//
//   1. `_inflight_runs` (ADR-0063-A universal pause registry)
//        - rows with status IN ('running','paused')
//        - carries the pause taxonomy: `reason`, `resume_at`, `paused_at`
//        - after ADR-0042 (FSM) lands this becomes the only source
//   2. `agent_jobs` (legacy execution record)
//        - rows with status IN ('pending','processing')
//        - ONLY included when the agent is not already present in (1)
//
// Dedup is keyed by `agent_row_id` (universal_rows.id in table 1784). The
// inflight row carries `agent_slug`; we resolve that to a row id via a
// LEFT JOIN against the agents table. Unresolved slugs still surface
// (agent_row_id = NULL) so a misconfigured/legacy run does not disappear.
//
// The contract for callers (frontend WP-A consumer) is ADDITIVE over the
// pre-existing `active_agents[]` shape from messageController.js:
//   * preserves: job_db_id, job_id, agent_row_id, agent_user_id, agent_name,
//                status, started_at, invocation_type, last_status_message_id
//   * adds (inflight-only, NULL for agent_jobs rows):
//        reason       — pause taxonomy code (see markPaused.js)
//        resume_at    — ISO when the watchdog should retry, NULL = no schedule
//        paused_at    — `updated_at` when status='paused' (when the pause flipped)
//        source       — 'inflight' | 'jobs' — debugging breadcrumb
//
// AGENTS_TABLE_ID is the row holding agent definitions (table_id=1784,
// space 11). Slug column in `data` is `agent_slug`. Display column is
// `name`. The agents table does NOT carry `user_id` directly — the
// chat-user mapping is owned by agent_jobs, so inflight-sourced rows
// surface agent_user_id=NULL here; the frontend already keys placeholders
// off `agent_slug` (WP-A) and resolves avatars via the agents row.

import { dbAll, isPostgres } from '../../database/connection.js';

const AGENTS_TABLE_ID = 1784;

/**
 * Active agents for a conversation, with pause state.
 *
 * @param {number|string} conversationId
 * @returns {Promise<Array<{
 *   job_db_id: number|null,
 *   job_id: string|null,
 *   agent_row_id: number|null,
 *   agent_user_id: number|null,
 *   agent_name: string|null,
 *   agent_slug: string|null,
 *   status: string,
 *   started_at: string,
 *   invocation_type: string|null,
 *   last_status_message_id: number|null,
 *   reason: string|null,
 *   resume_at: string|null,
 *   paused_at: string|null,
 *   source: 'inflight'|'jobs',
 * }>>}
 */
export async function queryActiveInflight(conversationId) {
  if (conversationId == null) return [];
  if (!isPostgres()) {
    // PG-only feature; non-PG environments fall back to empty (caller has
    // legacy agent_jobs path for that case).
    return [];
  }

  const id = conversationId;

  // One round-trip via UNION ALL — Postgres handles the anti-join inside.
  const rows = await dbAll(
    `
    WITH inflight_raw AS (
      SELECT ifr.id            AS inflight_id,
             ifr.agent_slug    AS agent_slug,
             ifr.status        AS status,
             ifr.reason        AS reason,
             ifr.resume_at     AS resume_at,
             ifr.started_at    AS started_at,
             ifr.updated_at    AS updated_at,
             ifr.metadata      AS metadata,
             tr.id             AS agent_row_id,
             NULL::int         AS agent_user_id,
             COALESCE(tr.data->>'name', ifr.agent_slug) AS agent_name
        FROM _inflight_runs ifr
        LEFT JOIN table_rows tr
          ON tr.table_id = ?
         AND tr.data->>'agent_slug' = ifr.agent_slug
       WHERE ifr.conversation_id = ?
         AND ifr.status IN ('running','paused')
    ),
    inflight_slugs AS (
      SELECT DISTINCT agent_row_id
        FROM inflight_raw
       WHERE agent_row_id IS NOT NULL
    ),
    jobs_filtered AS (
      SELECT aj.id              AS db_id,
             aj.job_id           AS job_id,
             aj.agent_row_id     AS agent_row_id,
             aj.agent_user_id    AS agent_user_id,
             aj.agent_name       AS agent_name,
             aj.status           AS status,
             aj.started_at       AS started_at,
             aj.created_at       AS created_at,
             (aj.context::jsonb ->> 'invocation_type') AS invocation_type,
             (SELECT MAX(m.id)
                FROM messages m
               WHERE m.conversation_id = aj.conversation_id
                 AND m.content_type    = 'agent_status'
                 AND m.metadata->>'job_db_id' = aj.id::text) AS last_status_message_id
        FROM agent_jobs aj
       WHERE aj.conversation_id = ?
         AND aj.status IN ('pending','processing')
         AND (aj.agent_row_id IS NULL
              OR aj.agent_row_id NOT IN (SELECT agent_row_id FROM inflight_slugs))
    )
    SELECT 'inflight'::text  AS source,
           NULL::int          AS job_db_id,
           NULL::uuid         AS job_id,
           agent_row_id,
           agent_user_id,
           agent_name,
           agent_slug,
           status,
           started_at,
           (metadata ->> 'invocation_type') AS invocation_type,
           NULL::bigint       AS last_status_message_id,
           reason,
           resume_at,
           CASE WHEN status = 'paused' THEN updated_at ELSE NULL END AS paused_at
      FROM inflight_raw
    UNION ALL
    SELECT 'jobs'::text       AS source,
           db_id              AS job_db_id,
           job_id,
           agent_row_id,
           agent_user_id,
           agent_name,
           NULL::text         AS agent_slug,
           status,
           started_at,
           invocation_type,
           last_status_message_id,
           NULL::text         AS reason,
           NULL::timestamptz  AS resume_at,
           NULL::timestamptz  AS paused_at
      FROM jobs_filtered
     ORDER BY started_at ASC NULLS LAST
    `,
    [AGENTS_TABLE_ID, id, id]
  );

  return (rows || []).map((r) => ({
    source: r.source,
    job_db_id: r.job_db_id ?? null,
    job_id: r.job_id ?? null,
    agent_row_id: r.agent_row_id ?? null,
    agent_user_id: r.agent_user_id ?? null,
    agent_name: r.agent_name ?? null,
    agent_slug: r.agent_slug ?? null,
    status: r.status,
    started_at: r.started_at,
    invocation_type: r.invocation_type || null,
    last_status_message_id: r.last_status_message_id ?? null,
    reason: r.reason ?? null,
    resume_at: r.resume_at ?? null,
    paused_at: r.paused_at ?? null,
  }));
}
