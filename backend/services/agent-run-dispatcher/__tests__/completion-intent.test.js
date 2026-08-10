/**
 * ADR-150 P0 — completion-intent predicate.
 *
 * Pure module: no DB, no spawn. Boot guard from backend/test/setup.js still
 * runs (vitest setupFiles).
 *
 * ≥8 cases per the brief; we cover 14:
 *   1. send_chat_message → true
 *   2. send_widget_message → true
 *   3. send_ticket_message → true
 *   4. update_ticket_status with terminal status → true
 *   5. update_ticket_status with non-terminal status → false
 *   6. manage_plan with action='complete' → true
 *   7. manage_plan with action='update' → false
 *   8. query_table_data → false
 *   9. content_block_delta → false
 *  10. malformed null → false (no throw)
 *  11. malformed missing fields → false (no throw)
 *  12. content_block_start with tool_use shape (Anthropic stream-json) → true
 *  13. update_ticket_status with no opts.terminalStates → false (degrade safely)
 *  14. caller-supplied custom closingTools whitelist overrides defaults
 */

import { describe, expect, it } from 'vitest';

import { isCompletionIntent } from '../completion-intent.js';

const TERMINAL = new Set(['Done', 'Closed', 'Resolved']);

describe('isCompletionIntent — closing-tool whitelist', () => {
  it('send_chat_message → true', () => {
    expect(isCompletionIntent({ type: 'tool_use', name: 'send_chat_message', input: { content: 'hi' } }))
      .toBe(true);
  });

  it('send_widget_message → true', () => {
    expect(isCompletionIntent({ type: 'tool_use', name: 'send_widget_message', input: {} }))
      .toBe(true);
  });

  it('send_ticket_message → true', () => {
    expect(isCompletionIntent({ type: 'tool_use', name: 'send_ticket_message', input: {} }))
      .toBe(true);
  });

  it('content_block_start with tool_use=send_chat_message → true (Anthropic stream-json shape)', () => {
    const evt = {
      type: 'content_block_start',
      content_block: { type: 'tool_use', name: 'send_chat_message', id: 'tu_1', input: {} },
    };
    expect(isCompletionIntent(evt)).toBe(true);
  });

  it('caller can supply a custom closingTools list', () => {
    const evt = { type: 'tool_use', name: 'my_custom_finalize', input: {} };
    expect(isCompletionIntent(evt)).toBe(false);
    expect(isCompletionIntent(evt, { closingTools: ['my_custom_finalize'] })).toBe(true);
  });
});

describe('isCompletionIntent — update_ticket_status terminal-state gate', () => {
  it('terminal status → true', () => {
    const evt = { type: 'tool_use', name: 'update_ticket_status', input: { status: 'Done' } };
    expect(isCompletionIntent(evt, { terminalStates: TERMINAL })).toBe(true);
  });

  it('non-terminal status → false', () => {
    const evt = { type: 'tool_use', name: 'update_ticket_status', input: { status: 'In Progress' } };
    expect(isCompletionIntent(evt, { terminalStates: TERMINAL })).toBe(false);
  });

  it('terminal status but no terminalStates passed → false (degrade safely, no throw)', () => {
    const evt = { type: 'tool_use', name: 'update_ticket_status', input: { status: 'Done' } };
    expect(isCompletionIntent(evt)).toBe(false);
  });

  it('terminalStates as array (not Set) is accepted', () => {
    const evt = { type: 'tool_use', name: 'update_ticket_status', input: { status: 'Closed' } };
    expect(isCompletionIntent(evt, { terminalStates: ['Closed'] })).toBe(true);
  });
});

describe('isCompletionIntent — manage_plan complete action', () => {
  it('action=complete → true', () => {
    const evt = { type: 'tool_use', name: 'manage_plan', input: { action: 'complete' } };
    expect(isCompletionIntent(evt)).toBe(true);
  });

  it('action=update → false', () => {
    const evt = { type: 'tool_use', name: 'manage_plan', input: { action: 'update' } };
    expect(isCompletionIntent(evt)).toBe(false);
  });

  it('manage_plan with no input.action → false', () => {
    const evt = { type: 'tool_use', name: 'manage_plan', input: {} };
    expect(isCompletionIntent(evt)).toBe(false);
  });
});

describe('isCompletionIntent — non-completion tools', () => {
  it('query_table_data → false', () => {
    expect(isCompletionIntent({ type: 'tool_use', name: 'query_table_data', input: {} })).toBe(false);
  });

  it('content_block_delta (text streaming) → false (not a tool_use shape at all)', () => {
    const evt = { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } };
    expect(isCompletionIntent(evt, { terminalStates: TERMINAL })).toBe(false);
  });

  it('Bash tool_use → false', () => {
    expect(isCompletionIntent({ type: 'tool_use', name: 'Bash', input: { cmd: 'ls' } })).toBe(false);
  });
});

describe('isCompletionIntent — defensive (malformed input never throws)', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty object', {}],
    ['number', 42],
    ['string', 'tool_use'],
    ['array', []],
    ['evt with no type', { name: 'send_chat_message' }],
    ['tool_use with no name', { type: 'tool_use', input: {} }],
    ['tool_use with non-string name', { type: 'tool_use', name: 12, input: {} }],
    ['content_block_start with no content_block', { type: 'content_block_start' }],
    ['content_block_start with non-tool_use block', {
      type: 'content_block_start',
      content_block: { type: 'text', text: 'hi' },
    }],
  ])('returns false for %s without throwing', (_label, evt) => {
    expect(() => isCompletionIntent(evt)).not.toThrow();
    expect(isCompletionIntent(evt)).toBe(false);
  });
});
