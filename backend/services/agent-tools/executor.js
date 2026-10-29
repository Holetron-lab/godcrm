/**
 * Tool Executor — executeTool() main function
 *
 * Routes tool calls to the correct handler module.
 */

import { aiLogger } from '../../utils/logger.js';
import { handleManagePlan, handleMcpPlan } from '../chat/agent-execution-shared/processing-state.js';
import { fileToolHandlers } from './file-tools.js';
import { csvToolHandlers } from './csv-tools.js';
import { uiToolHandlers } from './ui-tools.js';
import { dataToolHandlers } from './data-tools.js';
import { dashboardToolHandlers } from './dashboard-tools.js';
import { webToolHandlers } from './web-tools.js';
import { blueskyToolHandlers } from './bluesky-tools.js';
import { redditToolHandlers } from './reddit-tools.js';
import { ticketToolHandlers } from './ticket-tools.js';
import { miscToolHandlers } from './misc-tools.js';
import { imageToolHandlers } from './image-tools.js';
import { memoryToolHandlers } from './memory-tools.js';
import { columnToolHandlers } from './column-tools.js';
import { chatToolHandlers } from './chat-tools.js';
import { guardHistoricalTool, canAccessHistoricalChat } from '../chat/historical-access.js';
import { documentToolHandlers } from './document-tools.js';
import { projectToolHandlers } from './project-tools.js';
import { copyToolHandlers } from './copy-tools.js';
import { calendarToolHandlers } from './calendar-tools.js';
import { telegramToolHandlers } from './telegram-tools.js';
import { printerToolHandlers } from './printer-tools.js';
import { bddToolHandlers } from './bdd-tools.js';
import { connectorToolHandlers, connectorRequirements } from './connector-tools.js';
import { passportToolHandlers } from './passport-tools.js';
import { opsToolHandlers } from './ops-tools.js';
import { getSpaceConnector } from '../connectors/CredentialVault.js';
import { evaluateToolGate } from './capability-gate.js';
import { auditToolCall } from '../audit/toolAudit.js';
import { isOwnerPrincipal, resolvePrincipal } from './principal.js';

// ADR-165 WP-4: naturalization is an owner act. Frozen in code, not in a DB
// row or an agent allowlist — the tools that mint and revoke agent identity
// must not be grantable by the same mechanism they authorize.
const OWNER_ONLY_TOOLS = new Set(['issue_passport', 'revoke_passport']);

// ADR-165 WP-1: the capability gate ships warn-only first (log violations,
// don't block) for one soak cycle to size false-positives on under-specified
// agent allowlists, then flips to hard enforce. Mirrors ADR-164's
// `deprecated_slug_resolve` WARN-then-retire pattern. Flip via env, no redeploy
// of logic: AGENT_TOOL_ALLOWLIST_ENFORCE=true.
const ALLOWLIST_ENFORCE = process.env.AGENT_TOOL_ALLOWLIST_ENFORCE === 'true';

/**
 * Unified toolHandlers map — merges all handler modules.
 * Used by executeTool() and exported for backward compatibility.
 */
export const toolHandlers = {
  ...dataToolHandlers,
  ...dashboardToolHandlers,
  ...webToolHandlers,
  ...blueskyToolHandlers,
  ...redditToolHandlers,
  ...fileToolHandlers,
  ...csvToolHandlers,
  ...uiToolHandlers,
  ...ticketToolHandlers,
  ...miscToolHandlers,
  ...imageToolHandlers,
  ...memoryToolHandlers,
  ...columnToolHandlers,
  ...chatToolHandlers,
  ...documentToolHandlers,
  ...projectToolHandlers,
  ...copyToolHandlers,
  ...calendarToolHandlers,
  ...telegramToolHandlers,
  ...printerToolHandlers,
  ...bddToolHandlers,
  ...connectorToolHandlers,
  ...passportToolHandlers,
  ...opsToolHandlers,
};

/**
 * Execute a tool by name.
 *
 * ADR-0066-B: this is the single choke point where the agent's identity is
 * known — callers already thread `context.agentId` / `agentName` for the
 * ADR-165 capability gate — so it is the only place agent action provenance
 * can be recorded without pushing a new parameter through 25 handler modules.
 *
 * Error semantics are preserved exactly: `dispatchTool` keeps its own
 * try/catch around the handler (structured `{ error }` return), and anything
 * propagating out of the gate/connector pre-flight still propagates. The
 * wrapper records the outcome and re-throws — it never swallows.
 */
export async function executeTool(toolName, args, userId, context) {
  const startedAt = Date.now();
  try {
    if (!await guardHistoricalTool(toolName,args,userId,context)) return {error:'Conversation not found'};
    const result = await dispatchTool(toolName, args, userId, context);
    if (toolName === 'list_conversations' && Array.isArray(result?.conversations)) {
      const visible = [];
      for (const c of result.conversations) if (await canAccessHistoricalChat(c.id,userId,context)) visible.push(c);
      result.conversations = visible;
      result.total = visible.length;
    }
    // Fire-and-forget: auditToolCall → writeAudit never throws or rejects, so
    // a broken audit pipeline cannot fail a tool call (ADR-0066 posture).
    void auditToolCall({
      toolName, args, userId, context, result,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    void auditToolCall({
      toolName, args, userId, context, thrown: error,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

/**
 * Route a tool call to its handler. Internal — callers use executeTool().
 */
async function dispatchTool(toolName, args, userId, context) {
  // ADR-113: manage_plan delegates to shared handleManagePlan()
  if (toolName === 'manage_plan') {
    const { conversationId, agentName, agentId, senderId, runId } = context || {};
    try {
      if (context?.source === 'mcp') return await handleMcpPlan(args, context);
      return await handleManagePlan(args, conversationId || null, agentName || 'unknown', { agentId, senderId, runId });
    } catch (error) {
      aiLogger.error({ err: error, toolName }, 'manage_plan execution error');
      return { error: error.message };
    }
  }

  const handler = toolHandlers[toolName];
  if (!handler) {
    return { error: `Unknown tool: ${toolName}` };
  }

  // ADR-165 WP-4: owner-only gate, checked BEFORE the capability gate and with
  // no env flag — a warn-only owner gate is a gate that does nothing, and
  // legitimate traffic on this path is countably zero. The MCP transport, an
  // agent scope, and an undeclared principal are all refused: privilege comes
  // from the subject, never from the channel.
  if (OWNER_ONLY_TOOLS.has(toolName) && !isOwnerPrincipal(context)) {
    const principal = resolvePrincipal(context);
    aiLogger.warn({
      event: 'owner_only_tool_denied',
      toolName,
      principalKind: principal.kind,
      principalLabel: principal.label,
      source: context?.source ?? null,
      agentId: context?.agentId ?? null,
    }, 'ADR-165 WP-4: non-owner principal attempted an owner-only tool');
    return {
      error: 'owner_only_tool',
      tool: toolName,
      message: `Tool ${toolName} is owner-only (ADR-165 WP-4). Use POST/DELETE /api/v3/users/:id/passport from an owner session.`,
    };
  }

  // ADR-165 WP-1: unified capability gate. When the caller threads an agent
  // scope (its resolved `allowedTools`), the invoked tool MUST be within it.
  // System callers (MCP userId=1, human owner) pass no scope → unrestricted,
  // preserving the intentional userId=1 trust. Warn-only first cycle: log the
  // violation for soak telemetry; block only once ALLOWLIST_ENFORCE flips on.
  const gate = evaluateToolGate(toolName, context, ALLOWLIST_ENFORCE);
  if (gate.violation) {
    aiLogger.warn({
      event: 'tool_allowlist_violation',
      toolName,
      agentId: context?.agentId ?? null,
      agentName: context?.agentName ?? null,
      enforced: ALLOWLIST_ENFORCE,
    }, 'ADR-165 WP-1: tool call outside agent allowlist');
    if (!gate.permitted) {
      return {
        error: 'tool_not_permitted',
        tool: toolName,
        message: `Tool ${toolName} is not in this agent's allowlist.`,
      };
    }
  }

  // ADR-0028 Phase 4 (a): pre-flight connector resolution.
  // Tools registered with `requires_connector` get an `injected_connector`
  // attached to context before the handler runs. Missing/expired connector
  // → return structured error with a connect_url so agent prompts (and the
  // MCP client) can surface a clickable hint.
  const requiredConnector = connectorRequirements[toolName];
  if (requiredConnector) {
    const spaceId = context?.spaceId ?? context?.space_id ?? null;
    if (!spaceId) {
      return {
        error: 'connector_missing',
        message: `Tool ${toolName} requires connector ${requiredConnector} but no spaceId was provided in execution context`,
        required_connector: requiredConnector,
      };
    }
    let connector = null;
    try {
      connector = await getSpaceConnector(spaceId, requiredConnector);
    } catch (err) {
      aiLogger.error({ err, toolName, requiredConnector, spaceId }, 'getSpaceConnector failed');
      return {
        error: 'connector_resolve_failed',
        message: err?.message || 'connector lookup failed',
        required_connector: requiredConnector,
      };
    }
    if (!connector || !connector.access_token || connector.status !== 'active') {
      return {
        error: 'connector_missing',
        required_connector: requiredConnector,
        connect_url: `/spaces/${spaceId}/settings/connectors?add=${requiredConnector}`,
        message: `No active ${requiredConnector} connector in space ${spaceId}. Connect at the URL above and retry.`,
      };
    }
    // Attach a sanitized connector view to context. NEVER log access_token.
    context = {
      ...(context || {}),
      injected_connector: {
        type_slug: connector.type_slug,
        access_token: connector.access_token,
        account_label: connector.account_label,
        scopes_granted: connector.scopes_granted,
        custom_fields: connector.custom_fields,
      },
    };
  }

  try {
    return await handler(args, userId, context);
  } catch (error) {
    aiLogger.error({ err: error, toolName }, 'Tool execution error');
    return { error: error.message };
  }
}
