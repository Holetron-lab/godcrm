/**
 * ADR-150 P0 — Completion-intent predicate.
 *
 * Pure module. Given a single NDJSON stream event, decide whether the agent
 * has signaled "I'm wrapping up" — i.e. the next moments of silence should be
 * treated as the natural tail of a turn, not as a stall.
 *
 * Detection covers three explicit signals:
 *   1. tool_use whose `name` is in the closing tool whitelist
 *      (default: send_chat_message, send_widget_message, send_ticket_message).
 *   2. tool_use `update_ticket_status` whose `input.status` is in the
 *      caller-supplied terminal-states set (e.g. "Done", "Closed").
 *   3. tool_use `manage_plan` whose `input.action === 'complete'`.
 *
 * Robust to malformed input — null, missing fields, wrong types all return
 * `false` without throwing. The dispatcher fires this for every NDJSON line;
 * a buggy event MUST NEVER take the runner down.
 *
 * @see ADR-150 §closing-grace, doc 2197/147260.
 */

const DEFAULT_CLOSING_TOOL_NAMES = Object.freeze([
  'send_chat_message',
  'send_widget_message',
  'send_ticket_message',
]);

const STATUS_SETTER_TOOL = 'update_ticket_status';
const PLAN_TOOL = 'manage_plan';
const PLAN_COMPLETE_ACTION = 'complete';

function asSet(maybeSet, fallback) {
  if (maybeSet instanceof Set) return maybeSet;
  if (Array.isArray(maybeSet)) return new Set(maybeSet);
  return new Set(fallback);
}

/**
 * Pull a tool_use descriptor out of an event in any of the supported shapes:
 *   - top-level alias: `{type:'tool_use', name, input}`
 *   - Anthropic stream-json: `{type:'content_block_start', content_block:{type:'tool_use', name, input}}`
 *
 * Returns `{name, input}` or null. Never throws.
 */
function extractToolUse(evt) {
  if (!evt || typeof evt !== 'object') return null;
  if (evt.type === 'tool_use' && typeof evt.name === 'string') {
    return { name: evt.name, input: evt.input ?? null };
  }
  if (
    evt.type === 'content_block_start' &&
    evt.content_block &&
    typeof evt.content_block === 'object' &&
    evt.content_block.type === 'tool_use' &&
    typeof evt.content_block.name === 'string'
  ) {
    const cb = evt.content_block;
    return { name: cb.name, input: cb.input ?? null };
  }
  return null;
}

function pickStatusValue(input) {
  if (!input || typeof input !== 'object') return null;
  if (typeof input.status === 'string') return input.status;
  if (typeof input.new_status === 'string') return input.new_status;
  if (input.data && typeof input.data === 'object' && typeof input.data.status === 'string') {
    return input.data.status;
  }
  return null;
}

/**
 * @param {object|null|undefined} evt
 * @param {{ terminalStates?: Set<string>|string[], closingTools?: Set<string>|string[] }} [opts]
 * @returns {boolean}
 */
export function isCompletionIntent(evt, opts = {}) {
  const tool = extractToolUse(evt);
  if (!tool) return false;

  const closingTools = asSet(opts.closingTools, DEFAULT_CLOSING_TOOL_NAMES);
  if (closingTools.has(tool.name)) return true;

  if (tool.name === STATUS_SETTER_TOOL) {
    const terminalStates = asSet(opts.terminalStates, []);
    if (terminalStates.size === 0) return false;
    const status = pickStatusValue(tool.input);
    if (status && terminalStates.has(status)) return true;
    return false;
  }

  if (tool.name === PLAN_TOOL) {
    const action = tool.input && typeof tool.input === 'object' && typeof tool.input.action === 'string'
      ? tool.input.action
      : null;
    if (action === PLAN_COMPLETE_ACTION) return true;
    return false;
  }

  return false;
}

export const DEFAULT_CLOSING_TOOLS = DEFAULT_CLOSING_TOOL_NAMES;

export default {
  isCompletionIntent,
  DEFAULT_CLOSING_TOOLS,
};
