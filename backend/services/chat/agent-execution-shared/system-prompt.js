/**
 * ADR-093 Task 2: Unified system prompt construction with access mode.
 *
 * Extracted from agent-execution-shared.js
 */

import { safeParse } from './helpers.js';
import {
  isTicketsTable,
  buildTicketContext,
  buildDelegationInstructions,
  buildHandoffProtocol,
  buildGroupChatAwareness,
  fetchLatestPlan,
  formatPlanAsContext,
} from './context-builders.js';

// ─── buildAgentSystemPrompt() ─────────────────────────────────

/**
 * ADR-093 Task 2: Unified system prompt construction with access mode.
 * S05: Runtime skill injection via context.skills.
 * ADR-113: Planning instructions + plan context injection.
 *
 * Both modes include crm_instructions + main_instructions.
 * The difference is the CONTEXT injection level:
 *   - 'api-key' mode: minimal context (conversation_id only, no space_id, no bound row)
 *   - 'account' mode: full context (space_id + conversation_id + bound row + tool introspection)
 *
 * Skills injection (S05):
 *   context.skills — pre-fetched array of { name, display_name, skill_content } objects
 *   Skills are injected between base prompt and context, in both modes.
 *   Skills with empty skill_content are silently skipped.
 *
 * Planning (ADR-113):
 *   When agentConfig.planning.enabled is true, planning instructions are appended.
 *   When agentConfig.planning.inject_in_context is not explicitly false, the latest
 *   plan is fetched from DB and injected as a checklist in the prompt.
 *
 * @param {Object} agentConfig - Agent configuration
 * @param {Object} context - { spaceId, conversationId, boundRow?, skills? }
 * @param {'api-key'|'account'} mode - Access mode
 * @returns {Promise<string>} Complete system prompt with context
 */
export async function buildAgentSystemPrompt(agentConfig, context = {}, mode = 'account') {
  const crmInstructions = agentConfig.crm_instructions || '';
  const mainInstructions = agentConfig.main_instructions || '';

  let basePrompt;
  if (crmInstructions || mainInstructions) {
    basePrompt = [crmInstructions, mainInstructions].filter(Boolean).join('\n\n---\n\n');
  } else {
    // Legacy fallback
    basePrompt = agentConfig.system_prompt
      || agentConfig.instructions
      || 'You are a helpful assistant.';
  }

  // ── Reasoning Preamble (Perplexica pattern) ──
  // When reasoning_visible is enabled in agent config, inject instruction
  // that forces the LLM to call explain_reasoning tool before every action.
  if (agentConfig.reasoning_visible) {
    basePrompt += `\n\n## Visible Reasoning
Before EVERY tool call, you MUST first call the \`explain_reasoning\` tool to explain:
- What you are about to do and why
- What information you expect to get
- How it connects to the user's request
This makes your thinking process transparent to the user. Never skip this step.`;
  }

  // ── ADR-113: Planning instructions ──
  // When planning is enabled for the agent, inject instructions for using the planning tool.
  // auto_plan_threshold controls the minimum number of steps before planning is suggested (default: 3).
  //
  // The planning tool NAME is runtime-dependent (ADR-113 follow-up, ticket #81861):
  //   - native agent-loop (loop.js) registers `manage_plan`;
  //   - claude-code CLI agents (agent-job/create.js → executeClaudeCode) have `TodoWrite`
  //     instead, which create.js bridges back to plan messages.
  // Callers that resolved a claude-code provider pass context.isClaudeCode=true so the
  // injected instruction names the tool that ACTUALLY exists in the host. Absent/false →
  // default `manage_plan` (native loop), preserving prior behavior.
  const planningConfig = safeParse(agentConfig.planning, {});
  if (planningConfig.enabled) {
    const threshold = Number(planningConfig.auto_plan_threshold) > 0
      ? Number(planningConfig.auto_plan_threshold)
      : 3;
    const planTool = context.isClaudeCode ? 'TodoWrite' : 'manage_plan';

    basePrompt += `\n\n## Planning

When you receive a task that requires ${threshold} or more steps, you MUST use the \`${planTool}\` tool to:
1. Create a plan with all steps BEFORE starting work
2. Mark each task as in_progress when you begin it
3. Mark as completed when done, with a brief note
4. Mark as blocked if you hit an issue

Keep exactly ONE task as in_progress at a time.
Update the plan after completing each step.

IMPORTANT: For tasks with fewer than ${threshold} steps, proceed directly without creating a plan.`;
  }

  // ── ADR-116: Delegation invocation syntax instructions ──
  // Always inject the <<@slug>> vs @slug distinction so agents know how to
  // properly invoke other agents vs simply referencing them in text.
  basePrompt += '\n\n' + buildDelegationInstructions();

  // ── ADR-0031 WP-20+21: Row-reference + widget-embed authoring syntax ──
  // Always-on so every agent (regardless of skill set) can drop CRM rows
  // and widgets into chat without learning skill-specific tooling.
  basePrompt += `

## Referencing CRM rows in your reply
To reference a CRM row, write \`[[row:<table_id>/<row_id>]]\` anywhere in your reply — it renders as a clickable chip below your message and the token is stripped from the text. Example: "See [[row:1708/141024]] for details" becomes "See for details" with a chip pointing to ticket 141024 in table 1708. You can drop multiple tokens in one reply; each becomes its own chip. Unresolvable IDs (table or row missing) are silently dropped — but the token is always stripped from text, so don't worry about leaving syntax behind.

## Sending a widget into chat (send_chat_message)
When you call \`send_chat_message\`, you may pass an optional \`content_type\` and \`attachments[]\` to embed a live mini-widget (list/kanban) of CRM rows directly in chat. Allowed \`content_type\` values: \`'text'\` (default) and \`'widget_embed'\`. A widget_embed attachment has shape:

\`\`\`json
{
  "type": "widget_embed",
  "widgetEmbed": {
    "table_id": <number>,
    "view": "list" | "kanban" | "table",
    "filter": { "<column>": <value> },
    "columns": ["title", "status"],
    "limit": 20
  }
}
\`\`\`

Example 1 — list view of tickets currently in state 24276:
\`\`\`json
{
  "tool": "send_chat_message",
  "input": {
    "conversation_id": <conv>,
    "content": "Here are the tickets in this state:",
    "content_type": "widget_embed",
    "attachments": [{
      "type": "widget_embed",
      "widgetEmbed": { "table_id": 1708, "view": "list", "limit": 10, "filter": { "column": "state", "value": 24276 } }
    }]
  }
}
\`\`\`

Example 2 — kanban grouped by phase:
\`\`\`json
{
  "tool": "send_chat_message",
  "input": {
    "conversation_id": <conv>,
    "content": "Phase board for the project:",
    "content_type": "widget_embed",
    "attachments": [{
      "type": "widget_embed",
      "widgetEmbed": { "table_id": 1708, "view": "kanban", "filter": { "column": "phase" } }
    }]
  }
}
\`\`\`

Use \`[[row:T/R]]\` for inline pointers to single rows; use \`widget_embed\` when a list/board of multiple rows belongs in chat.`;

  // ── S05: Runtime skill injection ──
  // Inject pre-fetched skills from context.skills.
  // Skills are placed after the base prompt and before the context block,
  // so the agent receives structured capability knowledge before situational context.
  const skills = Array.isArray(context.skills) ? context.skills : [];
  const validSkills = skills.filter(s => s?.skill_content?.trim());
  if (validSkills.length > 0) {
    const skillsSection = validSkills
      .map(s => `### ${s.display_name || s.name}\n${s.skill_content}`)
      .join('\n\n---\n\n');
    basePrompt += `\n\n## Injected Skills\n\n${skillsSection}`;
  }

  // ── ADR-113: Plan context injection ──
  // When planning config exists and inject_in_context is not explicitly false,
  // fetch the latest plan from the conversation and inject it as context.
  if (agentConfig.planning && planningConfig.inject_in_context !== false && context.conversationId) {
    const planData = await fetchLatestPlan(context.conversationId);
    if (planData) {
      const planContext = formatPlanAsContext(planData);
      if (planContext) {
        basePrompt += '\n\n' + planContext;
      }
    }
  }

  // ── T-147809: Group Chat Awareness ──
  // Inject participants block BEFORE [CONTEXT] so agents know which other agents
  // share this conversation and which messages are NOT addressed to them.
  // Empty string when conversationId missing or participants table empty.
  if (context.conversationId) {
    const awareness = await buildGroupChatAwareness(context.conversationId, {
      rowId: agentConfig.row_id || agentConfig.id || null,
      name: agentConfig.name || null,
      slug: agentConfig.slug || null,
    });
    if (awareness) {
      basePrompt += '\n\n' + awareness;
    }
  }

  // ── Context injection based on access mode ──

  if (mode === 'api-key') {
    // API-key mode: minimal context — conversation_id only
    let contextInfo = '';
    if (context.conversationId) {
      contextInfo = `\n\n[CONTEXT]\nYour current conversation_id is ${context.conversationId}.`;
    }
    return basePrompt + contextInfo;
  }

  // Account mode: full context injection
  let contextInfo = '';
  if (context.spaceId) {
    contextInfo = `\n\n[CONTEXT]\nYou are working in space_id: ${context.spaceId}. When using tools that require space_id, use this value: ${context.spaceId}`;
  }
  if (context.conversationId) {
    contextInfo += contextInfo
      ? `\nYour current conversation_id is ${context.conversationId}. You can use view_conversation_steps and view_step_detail tools to inspect your past work in this conversation.`
      : `\n\n[CONTEXT]\nYour current conversation_id is ${context.conversationId}. You can use view_conversation_steps and view_step_detail tools to inspect your past work in this conversation.`;
  }

  // Bound row context (ADR-072 + ADR-077 Task 5: ticket context extension)
  if (context.boundRow) {
    const br = context.boundRow;
    const ticketCheck = isTicketsTable(br.table_id);

    if (ticketCheck.isTicket) {
      // ADR-077 Task 5: Rich ticket context + handoff protocol
      const ticketCtx = buildTicketContext(br, ticketCheck.config);
      if (ticketCtx) {
        contextInfo += '\n\n' + ticketCtx;
      }
      // Inject handoff protocol for agent mode
      if (context.agentMode === 'agent') {
        contextInfo += '\n\n' + buildHandoffProtocol(ticketCheck.config);
      }
    } else {
      // Linked row — full data in all modes (request 2026-05-04).
      // Why: agent/read mode previously showed only a reference and forced
      // an extra get_table_row call. Full data upfront eliminates the round-trip.
      contextInfo += `\n\n--- Linked Row ---\nTable: "${br.table_name}" (table_id: ${br.table_id}, row_id: ${br.row_id})`;
      contextInfo += `\n\`\`\`json\n${JSON.stringify(br.data, null, 2)}\n\`\`\``;
    }
  }

  // ── Reasoning Preamble (Perplexica-inspired visible thinking) ──
  // When reasoning_visible is enabled in agent config, inject instruction
  // that forces the LLM to explain its reasoning before every tool call
  if (agentConfig.reasoning_visible) {
    basePrompt += `\n\n## Visible Reasoning
Before EVERY tool call, you MUST first call the \`explain_reasoning\` tool to explain:
- What you are about to do and why
- What information you expect to get
- How it connects to the user's request
This makes your thinking process transparent to the user. Always call explain_reasoning BEFORE any other tool.`;
  }

  return basePrompt + contextInfo;
}
