/**
 * ADR-077/113/116: Context building helpers for system prompt injection.
 *
 * Includes:
 * - Ticket context building (ADR-077 Task 5)
 * - Handoff protocol instructions (ADR-077 Task 5)
 * - Delegation invocation syntax (ADR-116)
 * - Plan context fetching and formatting (ADR-113)
 *
 * Extracted from agent-execution-shared.js
 */

import { dbGet, dbAll, isPostgres } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { getPipelineConfig, getRegisteredSpaceIds } from '../../pipeline-config.js';
import { safeParse, formatPlanAsContext } from './helpers.js';

// ─── Ticket Context & Handoff Protocol (ADR-077 Task 5) ──────

/**
 * Check if a table_id corresponds to a Tickets table in any registered space.
 * @param {number} tableId
 * @returns {{ isTicket: boolean, spaceId: number|null, config: Object|null }}
 */
export function isTicketsTable(tableId) {
  if (!tableId) return { isTicket: false, spaceId: null, config: null };
  for (const sid of getRegisteredSpaceIds()) {
    try {
      const cfg = getPipelineConfig(sid);
      if (cfg.TICKETS_TABLE_ID === Number(tableId)) {
        return { isTicket: true, spaceId: sid, config: cfg };
      }
    } catch { /* skip unregistered */ }
  }
  return { isTicket: false, spaceId: null, config: null };
}

/**
 * ADR-077 Task 5: Build rich ticket context for system prompt injection.
 *
 * @param {Object} boundRow - { table_id, row_id, table_name, data }
 * @param {Object} pipelineConfig - Pipeline config for the space
 * @returns {string} Formatted ticket context block
 */
export function buildTicketContext(boundRow, pipelineConfig) {
  if (!boundRow?.data) return '';

  const d = boundRow.data;
  const lines = [];

  lines.push(`## Linked Ticket (table_id: ${boundRow.table_id}, row_id: ${boundRow.row_id})`);
  lines.push('');

  // Core ticket fields
  if (d.what) lines.push(`**Title**: ${d.what}`);
  if (d.why) lines.push(`**Why**: ${d.why}`);
  if (d.type) lines.push(`**Type**: ${d.type}`);
  if (d.priority) lines.push(`**Priority**: ${d.priority}`);
  if (d.state) lines.push(`**State**: ${d.state}`);
  if (d.assigned_to) lines.push(`**Assigned to**: ${d.assigned_to}`);
  if (d.adr_ref) lines.push(`**ADR Reference**: ${d.adr_ref}`);

  // Chain metadata
  if (d.chain_id) lines.push(`**Chain ID**: ${d.chain_id}`);
  if (d.cycle) lines.push(`**Cycle**: ${d.cycle}`);
  if (d.depends_on) lines.push(`**Depends on**: ${d.depends_on}`);
  if (d.phase) lines.push(`**Phase**: ${d.phase}`);

  // Dates
  if (d.due_date) lines.push(`**Due date**: ${d.due_date}`);
  if (d.scheduled_date) lines.push(`**Scheduled date**: ${d.scheduled_date}`);

  // Acceptance criteria (multi-line, preserve markdown)
  if (d.acceptance_criteria) {
    lines.push('');
    lines.push('**Acceptance Criteria**:');
    lines.push(d.acceptance_criteria);
  }

  // Test steps
  if (d.test_steps) {
    lines.push('');
    lines.push('**Test Steps**:');
    lines.push(d.test_steps);
  }

  return lines.join('\n');
}

/**
 * ADR-116: Build delegation/invocation syntax instructions for system prompt injection.
 *
 * @returns {string} Formatted delegation instruction block
 */
export function buildDelegationInstructions() {
  return `## Agent Invocation & Reference Syntax

Use the correct token syntax when working with agents and slash commands:

**To INVOKE / DELEGATE (triggers the agent):**
- \`<<@slug>>\` — invoke an agent by mention (e.g. \`<<@developer-ralph>>\`, \`<<@architect>>\`)
- \`<</slug>>\` — invoke an agent via slash command (e.g. \`<</orchestrator>>\`)

**To REFERENCE (display only — does NOT trigger the agent):**
- \`@slug\` — plain @mention for referencing in text (e.g. \`@developer-ralph\`, \`@architect\`)
- \`/slug\` — plain slash for referencing in text (e.g. \`/orchestrator\`)

**Rule**: Only use \`<<@slug>>\` or \`<</slug>>\` when you actually want to hand off control to another agent. Use plain \`@slug\` / \`/slug\` when merely mentioning an agent in your response.

**IMPORTANT — Invocation in Reasoning/Thinking:**
You can invoke agents from your reasoning (thinking) blocks too! If you write \`<<@slug>>\` inside your reasoning/thinking, the system will detect it and trigger delegation automatically. This is the preferred way to delegate mid-task — just write \`<<@developer-ralph>>\` or \`<<@frontend>>\` in your thinking when you realize another agent should handle part of the work. The current bubble will split at that point: your work continues in a new bubble after the invoked agent's bubble.

Why \`<<@slug>>\` and not just \`@slug\`? Plain \`@slug\` is a **reference** (mention only, no action). The double angle brackets \`<< >>\` are the **invocation trigger** — they tell the system to actually start the agent. Without them, nothing happens.

## Multi-Agent Coordination

When the user's message contains invocations for MULTIPLE agents (e.g. \`<<@orchestrator>>\` and \`<<@frontend-qa>>\` in the same message), you MUST:

1. **Identify your zone.** Only work on tasks clearly within YOUR role. Do not touch files that belong to the other agent's domain.
2. **Do NOT duplicate work.** If the other agent is better suited for a subtask, leave it to them — do not attempt it yourself.
3. **Coordinate via messages.** If you need to hand off context or results to the other agent, write a clear intermediate message describing what you did and what remains.
4. **Avoid file conflicts.** Never edit the same file another concurrent agent is likely editing. If overlap is unavoidable, finish your part first, commit, then let the other agent proceed.
5. **Domain boundaries:**
   - @orchestrator / @architect — coordination, planning, architecture, prompts, backend config
   - @developer / @developer-ralph — backend code, API routes, DB queries
   - @frontend / @frontend-qa — React components, CSS, frontend tests
   - @sysadmin — infrastructure, deploy scripts, server config
6. **When in doubt, skip.** It's better to leave a task for the other agent than to create a merge conflict.`;
}

/**
 * ADR-077 Task 5: Build handoff protocol instructions for system prompt injection.
 *
 * @param {Object} pipelineConfig - Pipeline config for the space
 * @returns {string} Formatted handoff protocol instructions
 */
export function buildHandoffProtocol(pipelineConfig) {
  const states = pipelineConfig.STATE || {};

  // Build state transition reference from actual config
  const stateNames = Object.entries(states)
    .map(([name, id]) => `${name.toLowerCase()}(${id})`)
    .join(' | ');

  return `## Handoff Protocol

When working on a ticket, follow this lifecycle:

**State Transitions**: ${stateNames}

**Your responsibilities:**
1. **Pick up**: When you start working, update the ticket state to in_progress
2. **Work**: Implement the acceptance criteria. Use \`update_row\` to track progress
3. **Submit**: When done, set state to review and summarize what you accomplished
4. **Delegate**: If you need another agent, use \`<<@slug>>\` invocation (e.g. \`<<@architect>>\`, \`<<@developer-ralph>>\`, \`<<@frontend>>\`) in your response. The invoked agent will be auto-triggered with full conversation context
5. **Fail gracefully**: If stuck, keep state as in_progress and document the blocker in the ticket

**Updating ticket state:**
\`\`\`
Use the update_row tool with table_id and row_id from the linked ticket.
Set the "state" field to the appropriate state value.
\`\`\`

**Agent delegation via <<@slug>> invocations:**
- \`<<@orchestrator>>\` — task breakdown, coordination
- \`<<@architect>>\` — system design, ADR creation
- \`<<@developer-ralph>>\` — backend TDD implementation
- \`<<@developer>>\` — general backend development
- \`<<@frontend>>\` — frontend React/TypeScript development
- \`<<@frontend-qa>>\` — frontend testing, Playwright E2E
- \`<<@test-runner>>\` — test execution and reporting
- \`<<@document-agent>>\` — documentation management

Note: Use plain \`@slug\` (without angle brackets) only when referencing an agent in text — it will NOT trigger delegation.

**Chain context**: When delegating, include relevant context (what you did, what remains, artifacts produced) so the next agent can continue without re-reading everything.`;
}

// ─── Group Chat Awareness (T-147809) ─────────────────────────

/**
 * Fetch participants of a conversation and render a "Group Chat Awareness" block
 * for system-prompt injection.
 *
 * Resolves each conversation_participant to:
 *  - human: { user_type:'human', name, role }
 *  - agent: { user_type:'agent', slug, name } via users.managed_by_agent_row_id → table_rows.data
 *
 * Returns an empty string when the conversation has no participants or on DB error
 * (silent fallback — never block prompt assembly).
 *
 * @param {number|string|null|undefined} conversationId
 * @param {{rowId?: number|null, name?: string|null, slug?: string|null}|null} [agentSelf]
 *        Optional identity of the executing agent. When provided, a `**You are:**`
 *        line is injected and the matching participant is filtered out of the
 *        `**Other participants:**` list so the agent can distinguish its own
 *        slug from siblings. Legacy callers may omit this parameter — old
 *        behaviour (no You-are line, self listed among others) is preserved.
 * @returns {Promise<string>} Markdown block or '' if not applicable.
 */
export async function buildGroupChatAwareness(conversationId, agentSelf = null) {
  if (!conversationId) return '';

  let participants;
  try {
    participants = await dbAll(
      isPostgres()
        ? `SELECT cp.user_id, cp.role, u.user_type, u.name,
                  u.managed_by_agent_row_id, tr.data AS agent_row_data
           FROM conversation_participants cp
           JOIN users u ON u.id = cp.user_id
           LEFT JOIN table_rows tr ON tr.id = u.managed_by_agent_row_id
           WHERE cp.conversation_id = $1
           ORDER BY cp.joined_at ASC`
        : `SELECT cp.user_id, cp.role, u.user_type, u.name,
                  u.managed_by_agent_row_id, tr.data AS agent_row_data
           FROM conversation_participants cp
           JOIN users u ON u.id = cp.user_id
           LEFT JOIN table_rows tr ON tr.id = u.managed_by_agent_row_id
           WHERE cp.conversation_id = ?
           ORDER BY cp.joined_at ASC`,
      [conversationId]
    );
  } catch (err) {
    apiLogger.warn({ err: err.message, conversationId }, 'T-147809: buildGroupChatAwareness DB query failed');
    return '';
  }

  if (!Array.isArray(participants) || participants.length === 0) return '';

  const owner =
    participants.find(p => p.role === 'owner' && p.user_type === 'human') ||
    participants.find(p => p.user_type === 'human');

  const ownerLine = owner
    ? `**Human owner:** ${owner.name || 'Unknown'} (user_id: ${owner.user_id})`
    : '**Human owner:** _none recorded_';

  const selfParticipant = (agentSelf && agentSelf.rowId)
    ? participants.find(p => p.managed_by_agent_row_id === agentSelf.rowId) || null
    : null;

  const others = participants.filter(p =>
    (!owner || p.user_id !== owner.user_id) &&
    (!selfParticipant || p.user_id !== selfParticipant.user_id)
  );

  const renderAgentSlugName = (p) => {
    const agentData = p.agent_row_data ? safeParse(p.agent_row_data, {}) : {};
    const slug = agentData.slug || agentData.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || `user-${p.user_id}`;
    const name = agentData.name || p.name || 'Unknown Agent';
    return { slug, name };
  };

  const otherLines = others.map(p => {
    if (p.user_type === 'agent') {
      const { slug, name } = renderAgentSlugName(p);
      return `- @${slug} (${name}) — agent`;
    }
    return `- ${p.name || `user-${p.user_id}`} — human`;
  });

  const othersBlock = otherLines.length > 0
    ? `\n\n**Other participants:**\n${otherLines.join('\n')}`
    : '\n\n**Other participants:** _none — only the owner is in this conversation_';

  let selfBlock = '';
  if (selfParticipant) {
    const { slug, name } = renderAgentSlugName(selfParticipant);
    selfBlock = `\n\n**You are:** @${slug} (${name}) — respond ONLY when this slug is addressed.`;
  }

  return `## Group Chat Awareness

You are a participant in **conversation_id: ${conversationId}**. Multiple agents may also be participants — the conversation history can contain turns produced by *other* agents, not by you.

${ownerLine}${selfBlock}${othersBlock}

**Rules — read carefully, this is the most common source of misbehaviour:**
- The history may contain assistant turns from OTHER agents. Each message is prefixed with the speaker (e.g. \`[architect]:\`, \`[frontend]:\`, \`[GERATRON]:\`). Identify yourself by your own slug — do **not** claim another agent's prior turn as your own work.
- A message addressed to a specific agent (via \`<<@slug>>\` invocation or a plain \`@slug\` mention at the head of the message) is intended for **that agent only**. If the slug is not yours, do **not** respond — stay silent.
- Only respond when (a) you are explicitly addressed by your slug or display name, (b) the message is a direct reply to your own previous turn, or (c) you are the agent assigned to the linked ticket and the message is unaddressed feedback on it.
- If the message is generic and could plausibly be answered by several agents, defer to the agent whose role most closely matches. When in doubt, **stay silent rather than duplicate work** — another participant is likely already handling it.`;
}

// ─── Plan Context Helpers (ADR-113) ──────────────────────────

/**
 * ADR-113: Fetch the latest plan message from a conversation.
 * Plans are stored as messages with content_type='plan'.
 *
 * @param {number} conversationId
 * @returns {Promise<object|null>} Parsed plan data or null
 */
export async function fetchLatestPlan(conversationId) {
  try {
    const planMessage = await dbGet(
      isPostgres()
        ? `SELECT content, updated_at FROM messages
           WHERE conversation_id = $1 AND content_type = 'plan'
           ORDER BY updated_at DESC LIMIT 1`
        : `SELECT content, updated_at FROM messages
           WHERE conversation_id = ? AND content_type = 'plan'
           ORDER BY updated_at DESC LIMIT 1`,
      [conversationId]
    );

    if (!planMessage) return null;

    return safeParse(planMessage.content, null);
  } catch (err) {
    apiLogger.warn({ err: err.message, conversationId }, 'ADR-113: fetchLatestPlan failed gracefully');
    return null;
  }
}

export { formatPlanAsContext };
