/**
 * ADR-0042 — FSM unit tests (Task 1).
 *
 * Pure-module tests: no DB, no /proc, no spawn. Boot guard via
 * backend/test/setup.js still runs because `import` triggers the chain.
 */

import { describe, it, expect } from 'vitest';

import {
  STATES,
  SIDE_EFFECTS,
  INITIAL,
  DEFAULT_COMPLETION_TOOLS,
  DEFAULT_TERMINAL_STATES,
  transition,
} from '../state-machine.js';

const tu = (name, id = `toolu_${name}`, input = null) => ({
  type: 'content_block_start',
  index: 0,
  content_block: { type: 'tool_use', id, name, input },
});

const trAlias = (id) => ({ type: 'tool_result', tool_use_id: id });

const trUserMsg = (id) => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
});

const txtBlock = () => ({
  type: 'content_block_start',
  index: 0,
  content_block: { type: 'text', text: '' },
});

const has = (arr, x) => arr.includes(x);

describe('ADR-0042 FSM — basics', () => {
  it('exports the 5 documented states + SIDE_EFFECTS', () => {
    expect(STATES).toEqual({
      IDLE: 'idle',
      THINKING: 'thinking',
      TOOL_ACTIVE: 'tool_active',
      CLOSING: 'closing',
      STUCK_CHECK: 'stuck_check',
    });
    expect(SIDE_EFFECTS.BUMP_EVENT).toBe('bump_event');
    expect(SIDE_EFFECTS.TOOL_STARTED).toBe('tool_started');
    expect(SIDE_EFFECTS.TOOL_FINISHED).toBe('tool_finished');
    expect(SIDE_EFFECTS.BUMP_COMPLETION_INTENT).toBe('bump_completion_intent');
    expect(SIDE_EFFECTS.BUMP_MEANINGFUL_COUNT).toBe('bump_meaningful_count');
    expect(INITIAL).toEqual({ state: STATES.IDLE, currentTool: null });
  });

  it('default completion tools include canonical ADR-0042 §config list', () => {
    expect(DEFAULT_COMPLETION_TOOLS).toEqual(
      expect.arrayContaining(['send_chat_message', 'send_widget_message', 'send_ticket_message']),
    );
  });

  it('default terminal states match §config (Done/Closed/Resolved)', () => {
    expect(DEFAULT_TERMINAL_STATES).toEqual(
      expect.arrayContaining(['Done', 'Closed', 'Resolved']),
    );
  });
});

describe('ADR-0042 FSM — table-driven (5 source states × event types)', () => {
  // Case ledger (table-driven): each row is { name, prev, evt, expectedState, expectedToolName?, expectedSideEffects[]? }.
  const stateActiveBash = { state: STATES.TOOL_ACTIVE, currentTool: { name: 'Bash', tool_use_id: 'toolu_Bash', attempt_idx: 0 } };
  const stateClosingChat = { state: STATES.CLOSING, currentTool: { name: 'send_chat_message', tool_use_id: 'toolu_send_chat_message', attempt_idx: 0 } };

  const cases = [
    // ── idle source ─────────────────────────────────────────────────────
    {
      name: 'idle + message_start → thinking',
      prev: { state: STATES.IDLE, currentTool: null },
      evt: { type: 'message_start', message: {} },
      expectedState: STATES.THINKING,
      expectedSideEffects: [SIDE_EFFECTS.BUMP_EVENT, SIDE_EFFECTS.BUMP_MEANINGFUL_COUNT],
    },
    {
      name: 'idle + content_block_start.text → thinking',
      prev: { state: STATES.IDLE, currentTool: null },
      evt: txtBlock(),
      expectedState: STATES.THINKING,
      expectedSideEffects: [SIDE_EFFECTS.BUMP_EVENT],
    },
    {
      name: 'idle + tool_use Bash → tool_active (currentTool captured)',
      prev: { state: STATES.IDLE, currentTool: null },
      evt: tu('Bash'),
      expectedState: STATES.TOOL_ACTIVE,
      expectedToolName: 'Bash',
      expectedSideEffects: [
        SIDE_EFFECTS.BUMP_EVENT,
        SIDE_EFFECTS.BUMP_MEANINGFUL_COUNT,
        SIDE_EFFECTS.TOOL_STARTED,
      ],
    },
    {
      name: 'idle + tool_use send_chat_message → closing (completion intent)',
      prev: { state: STATES.IDLE, currentTool: null },
      evt: tu('send_chat_message'),
      expectedState: STATES.CLOSING,
      expectedToolName: 'send_chat_message',
      expectedSideEffects: [
        SIDE_EFFECTS.BUMP_EVENT,
        SIDE_EFFECTS.BUMP_MEANINGFUL_COUNT,
        SIDE_EFFECTS.TOOL_STARTED,
        SIDE_EFFECTS.BUMP_COMPLETION_INTENT,
      ],
    },
    {
      name: 'idle + message_stop → idle (no-op state)',
      prev: { state: STATES.IDLE, currentTool: null },
      evt: { type: 'message_stop' },
      expectedState: STATES.IDLE,
    },
    {
      name: 'idle + orphan tool_result → idle (state unchanged, no tool to clear)',
      prev: { state: STATES.IDLE, currentTool: null },
      evt: trAlias('toolu_xyz'),
      expectedState: STATES.IDLE,
    },

    // ── thinking source ─────────────────────────────────────────────────
    {
      name: 'thinking + tool_use Bash → tool_active',
      prev: { state: STATES.THINKING, currentTool: null },
      evt: tu('Bash'),
      expectedState: STATES.TOOL_ACTIVE,
      expectedToolName: 'Bash',
    },
    {
      name: 'thinking + tool_use send_chat_message → closing',
      prev: { state: STATES.THINKING, currentTool: null },
      evt: tu('send_chat_message'),
      expectedState: STATES.CLOSING,
    },
    {
      name: 'thinking + message_stop → idle',
      prev: { state: STATES.THINKING, currentTool: null },
      evt: { type: 'message_stop' },
      expectedState: STATES.IDLE,
    },
    {
      name: 'thinking + message_start → thinking (no double-enter)',
      prev: { state: STATES.THINKING, currentTool: null },
      evt: { type: 'message_start' },
      expectedState: STATES.THINKING,
    },
    {
      name: 'thinking + content_block_delta → thinking (just bump_event)',
      prev: { state: STATES.THINKING, currentTool: null },
      evt: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } },
      expectedState: STATES.THINKING,
      expectedSideEffects: [SIDE_EFFECTS.BUMP_EVENT],
    },

    // ── tool_active source ──────────────────────────────────────────────
    {
      name: 'tool_active + matching tool_result → idle (tool cleared)',
      prev: stateActiveBash,
      evt: trAlias('toolu_Bash'),
      expectedState: STATES.IDLE,
      expectedToolName: null,
      expectedSideEffects: [
        SIDE_EFFECTS.BUMP_EVENT,
        SIDE_EFFECTS.BUMP_MEANINGFUL_COUNT,
        SIDE_EFFECTS.TOOL_FINISHED,
      ],
    },
    {
      name: 'tool_active + non-matching tool_result → tool_active unchanged',
      prev: stateActiveBash,
      evt: trAlias('toolu_other'),
      expectedState: STATES.TOOL_ACTIVE,
      expectedToolName: 'Bash',
    },
    {
      name: 'tool_active + tool_use send_chat_message → closing (completion intent overrides)',
      prev: stateActiveBash,
      evt: tu('send_chat_message'),
      expectedState: STATES.CLOSING,
      expectedToolName: 'send_chat_message',
    },
    {
      name: 'tool_active + new non-completion tool_use → tool_active replaced (nested call)',
      prev: stateActiveBash,
      evt: tu('Read', 'toolu_Read'),
      expectedState: STATES.TOOL_ACTIVE,
      expectedToolName: 'Read',
    },
    {
      name: 'tool_active + message_stop → tool_active (waiting for tool_result)',
      prev: stateActiveBash,
      evt: { type: 'message_stop' },
      expectedState: STATES.TOOL_ACTIVE,
      expectedToolName: 'Bash',
    },

    // ── closing source ──────────────────────────────────────────────────
    {
      name: 'closing + matching tool_result → idle',
      prev: stateClosingChat,
      evt: trAlias('toolu_send_chat_message'),
      expectedState: STATES.IDLE,
      expectedToolName: null,
    },
    {
      name: 'closing + tool_use Read (non-completion) → closing (sticky, currentTool preserved)',
      prev: stateClosingChat,
      evt: tu('Read', 'toolu_Read'),
      expectedState: STATES.CLOSING,
      expectedToolName: 'send_chat_message',
    },
    {
      name: 'closing + message_stop → idle',
      prev: stateClosingChat,
      evt: { type: 'message_stop' },
      expectedState: STATES.IDLE,
    },

    // ── stuck_check source (hold) ───────────────────────────────────────
    {
      name: 'stuck_check + any event → stuck_check (frozen)',
      prev: { state: STATES.STUCK_CHECK, currentTool: stateActiveBash.currentTool },
      evt: tu('Bash'),
      expectedState: STATES.STUCK_CHECK,
      expectedToolName: 'Bash',
      expectedSideEffects: [SIDE_EFFECTS.BUMP_EVENT],
    },
    {
      name: 'stuck_check + message_stop → stuck_check (still frozen)',
      prev: { state: STATES.STUCK_CHECK, currentTool: null },
      evt: { type: 'message_stop' },
      expectedState: STATES.STUCK_CHECK,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const out = transition(c.prev, c.evt, {});
      expect(out.state, `state for: ${c.name}`).toBe(c.expectedState);
      if (Object.prototype.hasOwnProperty.call(c, 'expectedToolName')) {
        if (c.expectedToolName === null) {
          expect(out.currentTool).toBeNull();
        } else {
          expect(out.currentTool, `tool for: ${c.name}`).toMatchObject({ name: c.expectedToolName });
        }
      }
      if (c.expectedSideEffects) {
        for (const sfx of c.expectedSideEffects) {
          expect(has(out.sideEffects, sfx), `side effect ${sfx} for: ${c.name}`).toBe(true);
        }
      }
    });
  }
});

describe('ADR-0042 FSM — completion-intent variants', () => {
  it('idle + tool_use update_ticket_status (status=Done) → closing (terminal-state path)', () => {
    const evt = tu('update_ticket_status', 'toolu_uts', { status: 'Done' });
    const out = transition({ state: STATES.IDLE, currentTool: null }, evt, {});
    expect(out.state).toBe(STATES.CLOSING);
    expect(has(out.sideEffects, SIDE_EFFECTS.BUMP_COMPLETION_INTENT)).toBe(true);
  });

  it('idle + tool_use update_ticket_status (status=Working) → tool_active (non-terminal)', () => {
    const evt = tu('update_ticket_status', 'toolu_uts', { status: 'Working' });
    const out = transition({ state: STATES.IDLE, currentTool: null }, evt, {});
    expect(out.state).toBe(STATES.TOOL_ACTIVE);
    expect(has(out.sideEffects, SIDE_EFFECTS.BUMP_COMPLETION_INTENT)).toBe(false);
  });

  it('opts.completionTools override is honored (custom set instead of defaults)', () => {
    const evt = tu('send_chat_message');
    // Override removes send_chat_message from completion list.
    const out = transition({ state: STATES.IDLE, currentTool: null }, evt, {
      completionTools: new Set(['custom_close']),
    });
    expect(out.state).toBe(STATES.TOOL_ACTIVE);
  });

  it('opts.terminalStates override is honored', () => {
    const evt = tu('update_ticket_status', 'toolu_uts', { status: 'Shipped' });
    const out = transition({ state: STATES.IDLE, currentTool: null }, evt, {
      terminalStates: new Set(['Shipped']),
    });
    expect(out.state).toBe(STATES.CLOSING);
  });

  it('completion-intent side effect fires only on the entry edge into closing', () => {
    // First transition: idle → closing (entry)
    const t1 = transition({ state: STATES.IDLE, currentTool: null }, tu('send_chat_message'), {});
    expect(has(t1.sideEffects, SIDE_EFFECTS.BUMP_COMPLETION_INTENT)).toBe(true);
    // Second transition: closing → closing (already inside)
    const t2 = transition(t1, tu('send_chat_message', 'toolu_2'), {});
    expect(has(t2.sideEffects, SIDE_EFFECTS.BUMP_COMPLETION_INTENT)).toBe(false);
  });
});

describe('ADR-0042 FSM — tool_result variants', () => {
  it('Anthropic-style user-message-wrapped tool_result is accepted', () => {
    const prev = { state: STATES.TOOL_ACTIVE, currentTool: { name: 'Bash', tool_use_id: 'toolu_Bash', attempt_idx: 0 } };
    const out = transition(prev, trUserMsg('toolu_Bash'), {});
    expect(out.state).toBe(STATES.IDLE);
    expect(out.currentTool).toBeNull();
    expect(has(out.sideEffects, SIDE_EFFECTS.TOOL_FINISHED)).toBe(true);
  });

  it('tool_result without tool_use_id matches the active tool (lenient)', () => {
    const prev = { state: STATES.TOOL_ACTIVE, currentTool: { name: 'Bash', tool_use_id: 'toolu_Bash', attempt_idx: 0 } };
    const out = transition(prev, { type: 'tool_result' }, {});
    expect(out.state).toBe(STATES.IDLE);
  });
});

describe('ADR-0042 FSM — attempt_idx tracking', () => {
  it('repeat tool_use of same name increments attempt_idx', () => {
    const prev = { state: STATES.TOOL_ACTIVE, currentTool: { name: 'Bash', tool_use_id: 'toolu_1', attempt_idx: 0 } };
    const out = transition(prev, tu('Bash', 'toolu_2'), {});
    expect(out.currentTool.attempt_idx).toBe(1);
  });

  it('different tool_use name resets attempt_idx to 0', () => {
    const prev = { state: STATES.TOOL_ACTIVE, currentTool: { name: 'Bash', tool_use_id: 'toolu_1', attempt_idx: 3 } };
    const out = transition(prev, tu('Read', 'toolu_2'), {});
    expect(out.currentTool.attempt_idx).toBe(0);
  });
});

describe('ADR-0042 FSM — malformed events do not throw', () => {
  const prev = { state: STATES.THINKING, currentTool: null };

  it.each([
    ['null evt', null],
    ['undefined evt', undefined],
    ['number evt', 42],
    ['string evt', 'message_start'],
    ['empty object', {}],
    ['object missing type', { foo: 'bar' }],
    ['type non-string', { type: 99 }],
    ['content_block_start with garbage block', { type: 'content_block_start', content_block: 'oops' }],
    ['tool_use without name', { type: 'tool_use', id: 'x' }],
    ['user message with non-array content', { type: 'user', message: { content: 'not an array' } }],
  ])('%s → state unchanged, no throw', (_label, evt) => {
    let out;
    expect(() => { out = transition(prev, evt, {}); }).not.toThrow();
    expect(out.state).toBe(STATES.THINKING);
    expect(out.currentTool).toBeNull();
  });

  it('null prev → treated as idle, no throw', () => {
    const out = transition(null, { type: 'message_start' }, {});
    expect(out.state).toBe(STATES.THINKING);
  });

  it('prev with non-object currentTool → treated as null', () => {
    const out = transition({ state: STATES.TOOL_ACTIVE, currentTool: 'oops' }, trAlias('x'), {});
    // No tool to match → orphan, state unchanged.
    expect(out.state).toBe(STATES.TOOL_ACTIVE);
  });
});

describe('ADR-0042 FSM — end-to-end sequence', () => {
  it('idle → message_start → tool_use Bash → tool_result → message_stop → idle', () => {
    let s = INITIAL;

    s = transition(s, { type: 'message_start' }, {});
    expect(s.state).toBe(STATES.THINKING);

    s = transition(s, txtBlock(), {});
    expect(s.state).toBe(STATES.THINKING);

    s = transition(s, tu('Bash'), {});
    expect(s.state).toBe(STATES.TOOL_ACTIVE);
    expect(s.currentTool.name).toBe('Bash');

    s = transition(s, trAlias('toolu_Bash'), {});
    expect(s.state).toBe(STATES.IDLE);
    expect(s.currentTool).toBeNull();

    s = transition(s, { type: 'message_stop' }, {});
    expect(s.state).toBe(STATES.IDLE);
  });

  it('full closing handoff: tool work → send_chat_message → tool_result → idle', () => {
    let s = INITIAL;

    s = transition(s, { type: 'message_start' }, {});
    s = transition(s, tu('Read', 'toolu_Read'), {});
    s = transition(s, trAlias('toolu_Read'), {});
    expect(s.state).toBe(STATES.IDLE);

    s = transition(s, tu('send_chat_message', 'toolu_close'), {});
    expect(s.state).toBe(STATES.CLOSING);

    s = transition(s, trAlias('toolu_close'), {});
    expect(s.state).toBe(STATES.IDLE);
  });
});

describe('ADR-0042 FSM — stuck_check semantics', () => {
  it('stuck_check holds across structural events (only dispatcher exits it)', () => {
    let s = { state: STATES.STUCK_CHECK, currentTool: { name: 'WebFetch', tool_use_id: 'toolu_w', attempt_idx: 0 } };

    s = transition(s, tu('Bash'), {});
    expect(s.state).toBe(STATES.STUCK_CHECK);

    s = transition(s, trAlias('toolu_w'), {});
    expect(s.state).toBe(STATES.STUCK_CHECK);

    s = transition(s, { type: 'message_stop' }, {});
    expect(s.state).toBe(STATES.STUCK_CHECK);
  });
});
