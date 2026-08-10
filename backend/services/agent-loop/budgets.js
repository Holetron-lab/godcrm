/**
 * agent-loop/budgets.js — ADR-0061 P0 runtime budgets + termination_reason.
 *
 * Surfaces:
 *  - HARNESS_BUDGET_DEFAULTS (frozen): {step_limit, time_limit_ms, tool_call_limit}.
 *  - mergeBudget(...sources): later non-null sources override earlier ones.
 *    Merge order at call site: harnessDefaults → agent.default_budget_json → dispatch override.
 *  - budgetTripped(counters, budget, startedAtMs): returns `out_of_budget:<field>` or null.
 *  - TERMINATION_REASONS: enum strings used in chip emoji map.
 *  - emojiFor(reason): chip emoji per ADR-0061 §1.
 *  - startRunRow, finalizeRunRow: persist a row in `_agent_runs` (table_id=100001).
 *  - postTerminationChip: post a row_reference chip into the originating conversation.
 *
 * Storage model: virtual table — INSERT/UPDATE table_rows with table_id=100001.
 */

import { dbRun, dbGet, isPostgres, sqlNow } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';

export const AGENT_RUNS_TABLE_ID = 100001;

export const HARNESS_BUDGET_DEFAULTS = Object.freeze({
  step_limit: 40,
  time_limit_ms: 15 * 60_000,
  tool_call_limit: 120,
});

export const TERMINATION_REASONS = Object.freeze({
  GOAL_REACHED: 'goal_reached',
  HUMAN_STOP: 'human_stop',
  OUT_OF_BUDGET: 'out_of_budget',
  TOOL_DENIED: 'tool_denied',
  ERROR_UNRECOVERABLE: 'error_unrecoverable',
});

const _EMOJI = {
  goal_reached: '✅',
  human_stop: '⏸',
  out_of_budget: '⏱',
  tool_denied: '🚫',
  error_unrecoverable: '💥',
};

export function emojiFor(reason) {
  if (typeof reason !== 'string') return '❔';
  const base = reason.split(':')[0];
  return _EMOJI[base] || '❔';
}

/**
 * Merge budget sources left→right. Later non-null fields override earlier ones.
 * Source can be plain object or JSON string. Returns a new object — never the
 * frozen defaults — so callers can mutate freely.
 */
export function mergeBudget(...sources) {
  const out = { ...HARNESS_BUDGET_DEFAULTS };
  for (const raw of sources) {
    let s = raw;
    if (typeof s === 'string') {
      try { s = JSON.parse(s); } catch { s = null; }
    }
    if (!s || typeof s !== 'object') continue;
    for (const k of ['step_limit', 'time_limit_ms', 'tool_call_limit', 'token_limit', 'cost_limit_usd']) {
      const v = s[k];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        out[k] = v;
      }
    }
  }
  return out;
}

/**
 * Check counters vs budget. Returns the FIRST field tripped (in order: step,
 * time, tool_call, token, cost) as `out_of_budget:<field>`, or null.
 *
 * ADR-165 WP-2b: `cost_limit_usd` (USD) is derived from token usage × per-model
 * price (see agent-loop/pricing.js). An unpriced model keeps `counters.cost_usd`
 * at 0, so this check never trips for it — NO cap, per the hard invariant.
 */
export function budgetTripped(counters, budget, startedAtMs) {
  if (!counters || !budget) return null;
  if (counters.steps >= budget.step_limit) return 'out_of_budget:step_limit';
  if ((Date.now() - startedAtMs) >= budget.time_limit_ms) return 'out_of_budget:time_limit_ms';
  if (counters.tool_calls >= budget.tool_call_limit) return 'out_of_budget:tool_call_limit';
  if (budget.token_limit && counters.tokens >= budget.token_limit) return 'out_of_budget:token_limit';
  if (budget.cost_limit_usd && counters.cost_usd >= budget.cost_limit_usd) return 'out_of_budget:cost_limit_usd';
  return null;
}

/** Build the row data payload — keeps INSERT/UPDATE consistent. */
function _buildRunData({ conversationId, agentId, ticketId, budget, provider, startedAtIso }) {
  return {
    conversation_id: conversationId ?? null,
    agent_id: agentId ?? null,
    ticket_id: ticketId ?? null,
    started_at: startedAtIso,
    ended_at: null,
    termination_reason: null,
    budget_json: budget,
    budget_consumed_json: null,
    provider: provider || null,
    created_at: startedAtIso,
    updated_at: startedAtIso,
  };
}

/**
 * INSERT a fresh `_agent_runs` row with the merged budget snapshot.
 * Returns the new row id, or null on failure (logged, not thrown — never block
 * the loop on persistence errors).
 */
export async function startRunRow({ conversationId, agentId, ticketId, budget, provider }) {
  try {
    const startedAtIso = new Date().toISOString();
    const data = _buildRunData({ conversationId, agentId, ticketId, budget, provider, startedAtIso });
    const baseId = `RUN${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const result = await dbRun(
      isPostgres()
        ? `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
           VALUES ($1, $2, $3::jsonb, ${sqlNow()}, ${sqlNow()}) RETURNING id`
        : `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
           VALUES (?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
      [AGENT_RUNS_TABLE_ID, baseId, JSON.stringify(data)]
    );
    return result?.lastInsertRowid || result?.rows?.[0]?.id || null;
  } catch (err) {
    apiLogger.error({ err: err.message, conversationId, agentId }, 'ADR-0061 startRunRow failed');
    return null;
  }
}

/**
 * Patch the run row with ended_at + termination_reason + counters snapshot.
 * Uses JSONB merge so we don't clobber the budget_json snapshot written at start.
 */
export async function finalizeRunRow(runRowId, { terminationReason, counters }) {
  if (!runRowId) return;
  try {
    const endedAtIso = new Date().toISOString();
    const patch = {
      ended_at: endedAtIso,
      termination_reason: terminationReason || null,
      budget_consumed_json: counters || null,
      updated_at: endedAtIso,
    };
    if (isPostgres()) {
      await dbRun(
        `UPDATE table_rows SET data = data || $1::jsonb, updated_at = ${sqlNow()} WHERE id = $2`,
        [JSON.stringify(patch), runRowId]
      );
    } else {
      // SQLite path — read/modify/write since no JSON merge operator.
      const row = await dbGet(`SELECT data FROM table_rows WHERE id = ?`, [runRowId]);
      if (!row) return;
      let cur = {};
      try { cur = JSON.parse(row.data) || {}; } catch { cur = {}; }
      const merged = { ...cur, ...patch };
      await dbRun(
        `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ?`,
        [JSON.stringify(merged), runRowId]
      );
    }
  } catch (err) {
    apiLogger.error({ err: err.message, runRowId, terminationReason }, 'ADR-0061 finalizeRunRow failed');
  }
}

/**
 * Post a termination chip into the originating conversation. Uses the same
 * `row_reference` attachment shape as send_widget_message, so the chat
 * renderer picks the correct preset.
 */
export async function postTerminationChip({ conversationId, runRowId, terminationReason, senderId, agentRowId, agentMetadata }) {
  if (!conversationId || !runRowId || !terminationReason) return;
  try {
    const emoji = emojiFor(terminationReason);
    const note = `${emoji} ${terminationReason}`;
    const attachment = {
      type: 'row_reference',
      rowReference: {
        table_id: AGENT_RUNS_TABLE_ID,
        row_id: runRowId,
        table_name: 'Agent Runs',
        table_icon: '🛡️',
        row_title: note,
        style: 'chip',
      },
    };
    await dbRun(
      `INSERT INTO messages (conversation_id, role, content, content_type, sender_id, agent_id, attachments, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ${sqlNow()})`,
      [
        conversationId,
        'system',
        note,
        'text',
        senderId || null,
        agentRowId || null,
        JSON.stringify([attachment]),
      ]
    );
    await dbRun(`UPDATE conversations SET updated_at = ${sqlNow()} WHERE id = ?`, [conversationId]);
  } catch (err) {
    apiLogger.error({ err: err.message, conversationId, runRowId, terminationReason }, 'ADR-0061 postTerminationChip failed');
  }
}
