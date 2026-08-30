/**
 * Tool Executor — executeTool() main function
 *
 * Routes tool calls to the correct handler module.
 */

import { aiLogger } from '../../utils/logger.js';
import { handleManagePlan } from '../chat/agent-execution-shared.js';
import { fileToolHandlers } from './file-tools.js';
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
import { documentToolHandlers } from './document-tools.js';
import { projectToolHandlers } from './project-tools.js';
import { copyToolHandlers } from './copy-tools.js';
import { calendarToolHandlers } from './calendar-tools.js';
import { telegramToolHandlers } from './telegram-tools.js';
import { printerToolHandlers } from './printer-tools.js';
import { bddToolHandlers } from './bdd-tools.js';
import { connectorToolHandlers, connectorRequirements } from './connector-tools.js';
import { passportToolHandlers } from './passport-tools.js';
import { getSpaceConnector } from '../connectors/CredentialVault.js';
import { evaluateToolGate } from './capability-gate.js';

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
};

/**
 * Execute a tool by name
 */
export async function executeTool(toolName, args, userId, context) {
  // ADR-113: manage_plan delegates to shared handleManagePlan()
  if (toolName === 'manage_plan') {
    const { conversationId, agentName, agentId } = context || {};
    try {
      return await handleManagePlan(args, conversationId || null, agentName || 'unknown', { agentId: agentId || null });
    } catch (error) {
      aiLogger.error({ err: error, toolName }, 'manage_plan execution error');
      return { error: error.message };
    }
  }

  const handler = toolHandlers[toolName];
  if (!handler) {
    return { error: `Unknown tool: ${toolName}` };
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
