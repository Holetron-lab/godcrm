/**
 * ADR-0042 — Agent liveness FSM (pure module, no I/O).
 *
 * Drives the per-run liveness state from NDJSON stream events. The dispatcher
 * (`index.js`, Task 4) owns persistence + secondary-signal sampling; this
 * module just maps `(prev, event) → (next, sideEffects)` deterministically.
 *
 * States (5): idle, thinking, tool_active, closing, stuck_check.
 * `terminal` from §5 is NOT exposed here — it's a post-FSM kill outcome
 * decided by the dispatcher tick once secondary signals confirm death.
 *
 * `stuck_check` is a *hold* from the FSM's perspective: only the dispatcher's
 * secondary-signal verdict can release it (alive → restore prior, dead →
 * terminal). Events arriving during stuck_check therefore keep state pinned
 * but still emit `bump_event` so heartbeat freshness updates.
 *
 * Event shapes accepted (forward-compat with `--output-format=stream-json`,
 * Phase 10 of ADR-0030):
 *   - `{type:'message_start', ...}`
 *   - `{type:'content_block_start', content_block:{type:'tool_use'|'text', ...}}`
 *   - `{type:'content_block_delta'|'content_block_stop'|'message_delta'|'ping', ...}`
 *   - `{type:'message_stop'}`
 *   - `{type:'tool_use', name, id, input}`               (top-level alias)
 *   - `{type:'tool_result', tool_use_id, ...}`           (top-level alias)
 *   - `{type:'user', message:{content:[{type:'tool_result', tool_use_id}]}}`
 *   - `{type:'error', ...}`
 *
 * Today's runner emits `info|output|result|error` (see scripts/run-claude-on-ticket.sh).
 * Those fall through to `BUMP_EVENT`-only — no state churn — until Phase 10.
 *
 * @see ADR-0042 §5 (states), §6 (transitions), §7 (persisted shape), §8 (signature).
 */

export const STATES = Object.freeze({
  IDLE: 'idle',
  THINKING: 'thinking',
  TOOL_ACTIVE: 'tool_active',
  CLOSING: 'closing',
  STUCK_CHECK: 'stuck_check',
});

export const SIDE_EFFECTS = Object.freeze({
  BUMP_EVENT: 'bump_event',
  BUMP_COMPLETION_INTENT: 'bump_completion_intent',
  BUMP_MEANINGFUL_COUNT: 'bump_meaningful_count',
  TOOL_STARTED: 'tool_started',
  TOOL_FINISHED: 'tool_finished',
});

// Defaults match `_workflow_config` schema (ADR-0042 §Config).
export const DEFAULT_COMPLETION_TOOLS = Object.freeze([
  'send_chat_message',
  'send_widget_message',
  'send_ticket_message',
]);

export const DEFAULT_TERMINAL_STATES = Object.freeze([
  'Done',
  'Closed',
  'Resolved',
]);

// Tools whose `input.status` can flip the run to `closing` when the value
// is in `terminalStates`. Status-set is a separate completion-intent path
// from name-based detection.
const STATUS_SETTER_TOOLS = new Set([
  'update_ticket_status',
  'update_table_row',
  'mcp__godcrm__update_table_row',
]);

export const INITIAL = Object.freeze({ state: STATES.IDLE, currentTool: null });

function asSet(maybeSet, fallback) {
  if (maybeSet instanceof Set) return maybeSet;
  if (Array.isArray(maybeSet)) return new Set(maybeSet);
  return new Set(fallback);
}

function extractToolUse(evt) {
  if (!evt || typeof evt !== 'object') return null;
  // Top-level alias: `{type:'tool_use', name, id, input}`
  if (evt.type === 'tool_use' && typeof evt.name === 'string') {
    return {
      tool_use_id: evt.id ?? evt.tool_use_id ?? null,
      name: evt.name,
      input: evt.input ?? null,
    };
  }
  // Anthropic SDK shape: content_block_start with tool_use block.
  if (
    evt.type === 'content_block_start' &&
    evt.content_block &&
    typeof evt.content_block === 'object' &&
    evt.content_block.type === 'tool_use' &&
    typeof evt.content_block.name === 'string'
  ) {
    const cb = evt.content_block;
    return {
      tool_use_id: cb.id ?? null,
      name: cb.name,
      input: cb.input ?? null,
    };
  }
  return null;
}

function extractToolResult(evt) {
  if (!evt || typeof evt !== 'object') return null;
  // Top-level alias.
  if (evt.type === 'tool_result') {
    return { tool_use_id: evt.tool_use_id ?? null };
  }
  // Anthropic stream-json: tool_result lives inside a synthetic user message.
  if (evt.type === 'user' && evt.message && Array.isArray(evt.message.content)) {
    const tr = evt.message.content.find(
      (c) => c && typeof c === 'object' && c.type === 'tool_result'
    );
    if (tr) return { tool_use_id: tr.tool_use_id ?? null };
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

function isCompletionIntent(toolUse, completionTools, terminalStates) {
  if (!toolUse || typeof toolUse.name !== 'string') return false;
  if (completionTools.has(toolUse.name)) return true;
  if (STATUS_SETTER_TOOLS.has(toolUse.name)) {
    const status = pickStatusValue(toolUse.input);
    if (status && terminalStates.has(status)) return true;
  }
  return false;
}

function nextAttemptIdx(prevTool, toolUse) {
  if (prevTool && prevTool.name === toolUse.name) {
    const prior = Number.isInteger(prevTool.attempt_idx) ? prevTool.attempt_idx : 0;
    return prior + 1;
  }
  return 0;
}

function makeNext(state, currentTool, sideEffects) {
  return { state, currentTool, sideEffects };
}

/**
 * Apply one stream event to the FSM.
 *
 * @param {{state: string, currentTool: object|null}} prev
 * @param {object} evt — parsed NDJSON line
 * @param {{terminalStates?: Set<string>|string[], completionTools?: Set<string>|string[]}} [opts]
 * @returns {{state: string, currentTool: object|null, sideEffects: string[]}}
 *   `currentTool` shape: `{name, tool_use_id, attempt_idx}` when state=tool_active|closing.
 *   `sideEffects` ⊂ Object.values(SIDE_EFFECTS).
 */
export function transition(prev, evt, opts = {}) {
  const prevState = (prev && typeof prev.state === 'string') ? prev.state : STATES.IDLE;
  const prevTool = (prev && prev.currentTool && typeof prev.currentTool === 'object')
    ? prev.currentTool
    : null;

  // Malformed / non-object event → unchanged, no throw.
  if (!evt || typeof evt !== 'object' || typeof evt.type !== 'string') {
    return makeNext(prevState, prevTool, []);
  }

  const completionTools = asSet(opts.completionTools, DEFAULT_COMPLETION_TOOLS);
  const terminalStates = asSet(opts.terminalStates, DEFAULT_TERMINAL_STATES);

  // stuck_check is a hold — only the dispatcher's secondary-signal verdict
  // can transition out. Events still bump the heartbeat counter.
  if (prevState === STATES.STUCK_CHECK) {
    return makeNext(STATES.STUCK_CHECK, prevTool, [SIDE_EFFECTS.BUMP_EVENT]);
  }

  // tool_result — closes a tool_active or closing leg.
  const toolResult = extractToolResult(evt);
  if (toolResult) {
    const sideEffects = [SIDE_EFFECTS.BUMP_EVENT, SIDE_EFFECTS.BUMP_MEANINGFUL_COUNT];
    if (
      prevTool &&
      (toolResult.tool_use_id == null || toolResult.tool_use_id === prevTool.tool_use_id)
    ) {
      sideEffects.push(SIDE_EFFECTS.TOOL_FINISHED);
      return makeNext(STATES.IDLE, null, sideEffects);
    }
    // Non-matching id (or no current tool) → state unchanged. The orphan
    // result is logged for observability but doesn't unblock the run.
    return makeNext(prevState, prevTool, sideEffects);
  }

  // tool_use — starts a tool, or transitions to closing on completion intent.
  const toolUse = extractToolUse(evt);
  if (toolUse) {
    const sideEffects = [SIDE_EFFECTS.BUMP_EVENT, SIDE_EFFECTS.BUMP_MEANINGFUL_COUNT];
    const closing = isCompletionIntent(toolUse, completionTools, terminalStates);

    // closing-state stickiness: once we're in closing, a subsequent NON-
    // completion tool_use is part of the handoff — keep state, don't reset
    // `currentTool` (otherwise the closing tool's tool_result wouldn't match).
    if (prevState === STATES.CLOSING && !closing) {
      return makeNext(STATES.CLOSING, prevTool, sideEffects);
    }

    const newTool = {
      name: toolUse.name,
      tool_use_id: toolUse.tool_use_id,
      attempt_idx: nextAttemptIdx(prevTool, toolUse),
    };
    sideEffects.push(SIDE_EFFECTS.TOOL_STARTED);
    if (closing) {
      // `bump_completion_intent` fires only on the entry edge into closing.
      if (prevState !== STATES.CLOSING) {
        sideEffects.push(SIDE_EFFECTS.BUMP_COMPLETION_INTENT);
      }
      return makeNext(STATES.CLOSING, newTool, sideEffects);
    }
    return makeNext(STATES.TOOL_ACTIVE, newTool, sideEffects);
  }

  // content_block_start with text → thinking (only when arriving from idle).
  if (
    evt.type === 'content_block_start' &&
    evt.content_block &&
    typeof evt.content_block === 'object' &&
    evt.content_block.type === 'text'
  ) {
    const sideEffects = [SIDE_EFFECTS.BUMP_EVENT];
    if (prevState === STATES.IDLE) {
      return makeNext(STATES.THINKING, prevTool, sideEffects);
    }
    return makeNext(prevState, prevTool, sideEffects);
  }

  // message_start → thinking (only from idle).
  if (evt.type === 'message_start') {
    const sideEffects = [SIDE_EFFECTS.BUMP_EVENT, SIDE_EFFECTS.BUMP_MEANINGFUL_COUNT];
    if (prevState === STATES.IDLE) {
      return makeNext(STATES.THINKING, prevTool, sideEffects);
    }
    return makeNext(prevState, prevTool, sideEffects);
  }

  // message_stop → idle (unless a tool is still in flight: tool_active
  // without tool_result yet, stay in tool_active waiting).
  if (evt.type === 'message_stop') {
    const sideEffects = [SIDE_EFFECTS.BUMP_EVENT, SIDE_EFFECTS.BUMP_MEANINGFUL_COUNT];
    if (prevState === STATES.TOOL_ACTIVE && prevTool) {
      return makeNext(STATES.TOOL_ACTIVE, prevTool, sideEffects);
    }
    return makeNext(STATES.IDLE, null, sideEffects);
  }

  // Any other recognized stream event (message_delta, content_block_delta,
  // content_block_stop, ping, error, info, output, result, ...) — non-
  // structural, just bump_event so heartbeat stays fresh.
  return makeNext(prevState, prevTool, [SIDE_EFFECTS.BUMP_EVENT]);
}

export default {
  STATES,
  SIDE_EFFECTS,
  DEFAULT_COMPLETION_TOOLS,
  DEFAULT_TERMINAL_STATES,
  INITIAL,
  transition,
};
