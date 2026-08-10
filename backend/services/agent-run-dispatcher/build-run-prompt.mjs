/**
 * ADR-0030 Phase 4 — Run prompt builder.
 *
 * Pure module. Reads the ticket row (table 1708) and the assigned agent row
 * (table 1784, per ADR §11) and assembles a markdown prompt suitable for
 * piping to `claude --print` via stdin. No side effects beyond DB reads.
 *
 * The output is intentionally human-readable: the model + a debugging human
 * both consume it. Keep sections ordered: header → ticket detail → agent
 * role → constraints → optional continuation.
 *
 * @see ADR-0030 §3.6 (prompt assembly), §11 (Agents table = 1784).
 */

import { dbGet } from '../../database/connection.js';

const TICKETS_TABLE_ID = 1708;
const AGENTS_TABLE_ID = 1784;

/**
 * Fetch + parse a JSONB row from table_rows. Returns the parsed `data`
 * object or null if the row is absent. Tolerant of both string and object
 * column shapes (driver-dependent).
 */
async function fetchRowData(tableId, rowId) {
  if (rowId == null) return null;
  const numeric = Number(rowId);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  const row = await dbGet(
    `SELECT data FROM table_rows WHERE table_id = $1 AND id = $2`,
    [tableId, numeric]
  );
  if (!row?.data) return null;
  return typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
}

/**
 * Defensive markdown-escape for inline section bodies. We don't actually
 * need escaping for `claude --print` — it's plain stdin, not markdown
 * rendering — but trimming whitespace + collapsing nullish bodies keeps
 * the prompt tidy.
 */
function cleanBody(s) {
  if (s == null) return '';
  const str = String(s).trim();
  return str;
}

/**
 * Pick the first non-empty value from a list of candidate field names on
 * the row. Used to be tolerant of schema variation across older tickets
 * (e.g. some have `description`, some have `story`, some have `what`).
 */
function pickFirst(obj, fields) {
  if (!obj) return '';
  for (const f of fields) {
    const v = obj[f];
    if (v != null && String(v).trim() !== '') return String(v);
  }
  return '';
}

/**
 * Build the markdown prompt for one ticket × agent pair.
 *
 * @param {{ ticketId: number|string, agentId: number|string|null }} args
 * @returns {Promise<{ prompt: string, agentRow: object|null, ticketRow: object|null, resolvedAt: string }>}
 */
export async function buildRunPrompt({ ticketId, agentId }) {
  const ticketRow = await fetchRowData(TICKETS_TABLE_ID, ticketId);
  const agentRow = agentId != null ? await fetchRowData(AGENTS_TABLE_ID, agentId) : null;

  const title = pickFirst(ticketRow, ['title', 'what', 'name', 'subject']) || `(no title)`;
  const description = pickFirst(ticketRow, ['description', 'desc', 'details']);
  const story = pickFirst(ticketRow, ['story', 'user_story']);
  const criteria = pickFirst(ticketRow, ['criteria', 'acceptance_criteria', 'bdd_criteria']);

  const agentName = pickFirst(agentRow, ['name', 'label', 'title']) || `agent#${agentId ?? '?'}`;
  const agentSystemPrompt = pickFirst(agentRow, ['system_prompt', 'systemPrompt', 'description', 'desc']);
  const agentContinuationPrompt = pickFirst(agentRow, ['continuation_prompt', 'continuationPrompt']);

  const lines = [];
  lines.push(`# Ticket T-${ticketId}: ${title}`);
  lines.push('');

  if (description) {
    lines.push('## Description');
    lines.push('');
    lines.push(cleanBody(description));
    lines.push('');
  }

  if (story) {
    lines.push('## Story');
    lines.push('');
    lines.push(cleanBody(story));
    lines.push('');
  }

  if (criteria) {
    lines.push('## Acceptance criteria');
    lines.push('');
    lines.push(cleanBody(criteria));
    lines.push('');
  }

  lines.push(`## Your role: ${agentName}`);
  lines.push('');
  if (agentSystemPrompt) {
    lines.push(cleanBody(agentSystemPrompt));
  } else {
    lines.push('(No system prompt configured for this agent — proceed using ticket context only.)');
  }
  lines.push('');

  lines.push('## Constraints');
  lines.push('- Working directory is your isolated worktree.');
  lines.push('- Stay within scope of this ticket.');
  lines.push('- When done, exit. Your stdout is captured and posted to the ticket chat.');
  lines.push('');

  // Continuation: only if agent provides a continuation prompt AND ticket
  // was previously associated with a run thread (P7 will set this field).
  if (agentContinuationPrompt && ticketRow?.run_thread_id) {
    lines.push('## Continuation');
    lines.push('');
    lines.push(`(Resuming run thread \`${ticketRow.run_thread_id}\`.)`);
    lines.push('');
    lines.push(cleanBody(agentContinuationPrompt));
    lines.push('');
  }

  return {
    prompt: lines.join('\n'),
    agentRow,
    ticketRow,
    resolvedAt: new Date().toISOString(),
  };
}

export default { buildRunPrompt };
