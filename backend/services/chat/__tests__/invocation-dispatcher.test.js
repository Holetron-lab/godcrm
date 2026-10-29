// @vitest-environment node
/**
 * ADR-117 dispatcher — dedup regression (Bugs 1552/228708, Fleet Audit WP-1).
 *
 * The agent-job path persists one agent text twice: once as the streamed
 * `text` block (saved as a `thinking` step) and once as the CLI's final
 * result (saved as `text`). Both copies carry the same <<@slug>> and both
 * used to reach the dispatcher under different message ids, so a dedup keyed
 * on message id let the same handoff spawn two jobs ~300 ms apart
 * (conversation 3660, jobs 19173/19174). Dedup must key on what was said.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const executeAgentResponse = vi.fn(async () => ({}));
const QA = { id: 33485, name: 'Frontend QA', _agentConfig: {} };

vi.mock('../../../database/connection.js', () => ({
  dbGet: vi.fn(async () => ({ space_id: 11 })),
  isPostgres: () => true,
}));
vi.mock('../../../utils/logger.js', () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../ConversationLockService.js', () => ({
  default: { withLock: (_id, fn) => fn() },
}));
vi.mock('../../../routes/v3/chat/chatAgentExecution.js', () => ({
  executeAgentResponse: (...a) => executeAgentResponse(...a),
}));
vi.mock('../../../routes/v3/chat/chatAgentHelpers.js', () => ({
  resolveMentionedUser: vi.fn(async () => ({ user: QA, isAgent: true })),
  resolveAgentUser: vi.fn(async () => QA),
  findAiAgentByCommand: vi.fn(async () => QA),
  autoJoinAgentToConversation: vi.fn(async () => {}),
}));

const { dispatchInvocationsFromContent, resolveCommandContent } = await import('../invocation-dispatcher.js');

const TEXT = '<<@frontend-qa>> — воспроизведи через `ui_probe` под owner на `app.godcrm.ai/tables/1552`';

// The dedup cache is module-global and time-windowed; each test gets its own
// conversation so cases cannot bleed into each other.
let conv = 3660;
beforeEach(() => { executeAgentResponse.mockClear(); conv += 1; });

function dispatch(content, sourceLabel, sourceMessageId) {
  return dispatchInvocationsFromContent({
    conversationId: conv, content, userId: 1, spaceId: 11,
    sourceAgentId: 900, sourceLabel, sourceMessageId,
  });
}

describe('dispatchInvocationsFromContent — dedup keyed on content, not message id', () => {
  it('fires one job when the same text arrives as stream_text and final_text under two message ids', async () => {
    const first = await dispatch(TEXT, 'stream_text', 865524);
    const second = await dispatch(TEXT, 'final_text', 865526);

    expect(first).toEqual({ triggered: 1, skipped: 0 });
    expect(second).toEqual({ triggered: 0, skipped: 1 });
    expect(executeAgentResponse).toHaveBeenCalledTimes(1);
  });

  it('fires one job for the real 3660 pair: stream copy keeps [[row:…]] chips, final copy has them stripped', async () => {
    // messages 865524 (stream_text, thinking) and 865526 (final_text, text):
    // the chip token sits inside the 200 chars after the invocation, so a
    // raw slice hash diverges (d1c57ad4… vs eb896c2c…) and both copies fired.
    const stream = 'Репро первого бага не зависит от плана и стоит дёшево. <<@frontend-qa>> — воспроизведи [[row:1552/228648]] через `ui_probe` под owner на `app.godcrm.ai/tables/1552`: проверь, пустые ли строки в DOM или контент есть, но скрыт.';
    const final = 'Репро первого бага не зависит от плана и стоит дёшево. <<@frontend-qa>> — воспроизведи  через `ui_probe` под owner на `app.godcrm.ai/tables/1552`: проверь, пустые ли строки в DOM или контент есть, но скрыт.';

    await dispatch(stream, 'stream_text', 865524);
    const second = await dispatch(final, 'final_text', 865526);

    expect(second).toEqual({ triggered: 0, skipped: 1 });
    expect(executeAgentResponse).toHaveBeenCalledTimes(1);
  });

  it('ignores trailing whitespace differences between the two copies', async () => {
    const short = '<<@frontend-qa>> смотри 1552';
    await dispatch(short + '\n', 'stream_text', 20);
    await dispatch(short, 'final_text', 21);

    expect(executeAgentResponse).toHaveBeenCalledTimes(1);
  });

  it('still fires two jobs for two genuinely different handoffs to the same slug', async () => {
    await dispatch('<<@frontend-qa>> reproduce bug 228648', 'final_text', 1);
    await dispatch('<<@frontend-qa>> reproduce bug 228712', 'final_text', 2);

    expect(executeAgentResponse).toHaveBeenCalledTimes(2);
  });

  it('applies the same rule to <</slug>> commands', async () => {
    const cmd = '<</frontend-qa>> check the grid on tables/1552';
    await dispatch(cmd, 'stream_text', 10);
    const second = await dispatch(cmd, 'final_text', 11);

    expect(second.skipped).toBe(1);
    expect(executeAgentResponse).toHaveBeenCalledTimes(1);
  });
});

// Bug 1552/228714 (Fleet Audit WP-6, ADR-203 D4): the /command text is the
// task. main_instruction is a prefix, never a replacement.
describe('resolveCommandContent — main_instruction prefixes the task, never replaces it', () => {
  const TASK = '<</sysadmin>> проверь диск на .72';

  it('returns the message untouched when the agent has no main_instruction', () => {
    expect(resolveCommandContent(TASK, { _agentConfig: {} }, null)).toBe(TASK);
    expect(resolveCommandContent(TASK, {}, null)).toBe(TASK);
  });

  it('<</slug>>: plain main_instructions + task', () => {
    const agent = { _agentConfig: { main_instructions: 'Ты сисадмин флота.' } };
    expect(resolveCommandContent(TASK, agent, null)).toBe(`Ты сисадмин флота.\n\n${TASK}`);
  });

  it('<</slug/N>>: the Nth quick command + task', () => {
    const agent = { _agentConfig: { main_instruction: JSON.stringify(['disk report', { content: 'mail queue' }]) } };
    expect(resolveCommandContent(TASK, agent, 1)).toBe(`mail queue\n\n${TASK}`);
    expect(resolveCommandContent(TASK, agent, 0)).toBe(`disk report\n\n${TASK}`);
  });

  it('<</slug/N>> with a bad index or non-JSON instruction falls back to the whole instruction + task', () => {
    const arr = { _agentConfig: { main_instruction: '["only one"]' } };
    expect(resolveCommandContent(TASK, arr, 5)).toBe(`["only one"]\n\n${TASK}`);
    const plain = { _agentConfig: { main_instructions: 'not json' } };
    expect(resolveCommandContent(TASK, plain, 0)).toBe(`not json\n\n${TASK}`);
  });

  it('dispatches the task text to the agent (regression: message_content used to be main_instruction only)', async () => {
    QA._agentConfig = { main_instructions: 'Ты QA.' };
    try {
      await dispatch('<</frontend-qa>> проверь /login на devcrm', 'http', 77);
      const opts = executeAgentResponse.mock.calls[0][3];
      expect(opts.invocation_type).toBe('command');
      expect(opts.message_content).toBe('Ты QA.\n\n<</frontend-qa>> проверь /login на devcrm');
    } finally {
      QA._agentConfig = {};
    }
  });
});
