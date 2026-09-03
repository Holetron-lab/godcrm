// backend/services/audit/toolAudit.js
//
// ADR-0066-B — audit coverage for the agent tool path.
//
// THE GAP THIS CLOSES: `audit_log` was fed only by `/api/v3` HTTP controllers.
// Agent tool calls do not go through those controllers — they enter at
// `executeTool()` with no Express `req` — so every action an agent took was
// absent from the audit trail entirely. Not "attributed to the wrong actor":
// absent. Provenance cannot be reconstructed after the fact, so it has to be
// recorded at the choke point, which is what this module does.
//
// Two policy decisions live here, deliberately, rather than in the executor:
//
//  1. FAIL CLOSED. `AUDIT_EXEMPT_TOOLS` is an explicit READ-ONLY set, never a
//     mutation allow-set. A tool added later is audited by default; forgetting
//     to classify it produces noise, not a silent hole. Same posture as the
//     PUBLIC_ALLOWLIST in services/mcp/publicMcp.js, inverted because here the
//     safe default is "record it".
//
//  2. ARGS ONLY, NEVER CONTEXT. `context` carries `injected_connector`
//     (ADR-0028), which holds a live `access_token`. It must never reach the
//     audit row. Argument keys that look like credentials are redacted on top
//     of that, because a caller can always pass a secret as a plain argument.
//
// Size is handled upstream: writeAudit()'s capDetails() enforces 2 KiB/field
// and 8 KiB/payload, so a `write_file` content argument cannot bloat the row.

import { writeAudit } from './writeAudit.js';

/**
 * Tools that only READ. Everything not listed here is treated as an
 * operational action and audited.
 *
 * Membership test is "does this call change state anywhere" — including state
 * outside the CRM (files, printers, external APIs, spend). `deep_scrape`,
 * `web_search` etc. are exempt because they read remote state without
 * changing it; `replicate_image_generate` is NOT exempt because it spends and
 * produces an artifact.
 */
export const AUDIT_EXEMPT_TOOLS = new Set([
  '_resetCascadePreviewsForTests',
  'analyze_table_data',
  'bluesky_search',
  'deep_scrape',
  'figma_get_file',
  'get_api_documentation',
  'get_chain_status',
  'get_conversation_messages',
  'get_dashboard_widgets',
  'get_document_content',
  'get_my_tasks',
  'get_table_row',
  'get_table_schema',
  'get_workspace_info',
  'github_get_user',
  'global_search',
  'list_bdd_specs',
  'list_conversations',
  'list_directory',
  'list_documents',
  'list_events',
  'list_projects',
  'list_spaces',
  'list_tables',
  'memory_recall',
  'memory_rooms',
  'printer_files',
  'printer_status',
  'printer_temperatures',
  'query_inflight_paused',
  'query_table_data',
  'read_file',
  'reddit_search',
  'replicate_check_prediction',
  'search_files',
  'validate_code',
  'view_conversation_steps',
  'view_step_detail',
  'web_search',
]);

/** Argument keys whose VALUE is never recorded, at any depth. */
const SECRET_KEY_RE = /token|secret|password|passwd|api_?key|credential|authorization|cookie/i;

const REDACTED = '[redacted]';

/**
 * Recursively replace values under credential-looking keys. Returns a new
 * structure; the caller's args object is never mutated. Depth-limited so a
 * cyclic or pathologically nested argument cannot hang the audit path.
 */
export function redactSecrets(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY_RE.test(k) ? REDACTED : redactSecrets(v, depth + 1);
  }
  return out;
}

/**
 * True when a tool invocation should produce an audit row.
 * @param {string} toolName
 */
export function shouldAuditTool(toolName) {
  return typeof toolName === 'string' && toolName.length > 0
    && !AUDIT_EXEMPT_TOOLS.has(toolName);
}

/**
 * Record one agent tool invocation.
 *
 * Fire-and-forget: delegates to writeAudit(), which never throws and never
 * rejects, so a broken audit pipeline cannot fail a tool call. Callers use
 * `void auditToolCall(...)` rather than awaiting.
 *
 * The synthetic request object is the whole trick — writeAudit() reads its
 * actor fields off `req`, and duck-typing one here means the agent path and
 * the HTTP path share a single writer instead of forking the audit format.
 *
 * @param {object}  p
 * @param {string}  p.toolName
 * @param {object}  [p.args]        - tool arguments (redacted + capped)
 * @param {number}  [p.userId]      - credential the agent acted under
 * @param {object}  [p.context]     - executeTool context (agentId/agentName/spaceId)
 * @param {object}  [p.result]      - handler return value; `{error}` marks failure
 * @param {Error}   [p.thrown]      - error that propagated out of dispatch
 * @param {number}  [p.durationMs]
 * @returns {Promise<void>}
 */
export async function auditToolCall({
  toolName,
  args,
  userId,
  context,
  result,
  thrown,
  durationMs,
}) {
  if (!shouldAuditTool(toolName)) return;

  const ctx = context || {};
  // A handler that returns `{ error }` failed just as much as one that threw;
  // recording only thrown errors would make the trail claim success for the
  // structured-error path, which is the common one in this codebase.
  const failure = thrown
    ? (thrown.message || String(thrown))
    : (result && typeof result === 'object' && result.error) || null;

  await writeAudit(
    {
      user: userId != null ? { id: userId } : null,
      agentId: ctx.agentId ?? null,
      agentName: ctx.agentName ?? null,
      spaceId: ctx.spaceId ?? ctx.space_id ?? null,
      requestId: ctx.requestId ?? null,
    },
    {
      action: `tool.${toolName}`,
      entity_type: 'agent_tool',
      entity_id: toolName,
      details: {
        ok: !failure,
        args: redactSecrets(args ?? null),
        error: failure ? String(failure) : null,
        duration_ms: Number.isFinite(durationMs) ? durationMs : null,
        conversation_id: ctx.conversationId ?? null,
      },
    }
  );
}

export default auditToolCall;
