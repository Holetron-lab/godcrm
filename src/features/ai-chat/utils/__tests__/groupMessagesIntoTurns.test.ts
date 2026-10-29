/**
 * groupMessagesIntoTurns — Unit Tests
 *
 * Tests the message grouping logic that converts flat ChatMessage[]
 * into Turn[] for rendering in the chat UI.
 */

import { describe, it, expect } from 'vitest';
import { groupMessagesIntoTurns, type Turn } from '../groupMessagesIntoTurns';
import type { ChatMessage } from '../../types';

// Helper to create a minimal ChatMessage
function msg(overrides: Partial<ChatMessage> & { id: string; role: ChatMessage['role'] }): ChatMessage {
  return {
    content: '',
    timestamp: new Date(),
    ...overrides,
  };
}

const NO_REACTIONS = {};

describe('groupMessagesIntoTurns', () => {
  it.each([
    ['pending', ''], ['loaded', ''], ['lazy', ''],
    ['pending', 'Processing...'], ['loaded', 'Processing...'], ['lazy', 'Processing...'],
  ])('keeps a pending handoff after its source answer (%s, %s)', (mode, content) => {
    const status = msg({ id: '2', role: 'assistant', contentType: 'agent_status', content,
      agentName: 'SysAdmin', agentId: 43, metadata: { placeholder: true, agent_status: 'running' } });
    const answer = msg({ id: '3', role: 'assistant', contentType: 'text',
      agentName: 'Frontend Developer', agentId: 42, content: 'Ready for integration' });
    if (mode === 'lazy') Object.assign(answer, {
      _step_groups_after: [{ type: 'thinking', count: 1, first_id: 4, last_id: 4,
        agent_id: 43, agent_name: 'SysAdmin', preview: 'Checking staging' }],
      _total_hidden_after: 1,
    });
    const step = msg({ id: '4', role: 'assistant', contentType: 'thinking',
      agentName: 'SysAdmin', agentId: 43, content: 'Checking staging' });
    const messages = [
      msg({ id: '1', role: 'assistant', contentType: 'text', agentName: 'Frontend Developer', agentId: 42, content: 'Previous answer' }),
      status, answer,
      ...(mode === 'loaded' ? [step] : []),
    ];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, true);
    expect(turns.map(turn => turn.senderName)).toEqual(['Frontend Developer', 'Frontend Developer', 'SysAdmin']);
    expect(turns[2].messages.map(message => message.id)).toEqual(
      mode === 'loaded' ? ['2', '4'] : mode === 'lazy' ? ['2', 'synthetic_agent_after_3_0'] : ['2']);
    expect(turns[2].isProcessing).toBe(true);
  });

  it.each([false, true])('keeps post-answer work active from the running job (global=%s)', (processing) => {
    const started = '2026-09-14T09:30:00Z';
    const messages = [
      msg({ id: '1', role: 'assistant', contentType: 'text', content: 'Progress update', agentName: 'Dev', agentId: 42 }),
      msg({ id: '2', role: 'assistant', contentType: 'tool_call', agentName: 'Dev', agentId: 42,
        timestamp: new Date('2026-09-14T09:31:00Z') }),
      msg({ id: '3', role: 'user', content: 'One more detail' }),
    ];
    const active = [{ agent_name: 'Dev', started_at: started }];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, processing, undefined, active);
    expect(turns.map(turn => turn.isProcessing)).toEqual([false, true, false]);
    expect(groupMessagesIntoTurns(messages, NO_REACTIONS, false, undefined, [])
      .map(turn => turn.isProcessing)).toEqual([false, false, false]);
    for (const job of [
      { agent_name: 'Other', started_at: started },
      { agent_name: 'Dev', started_at: '2026-09-14T09:32:00Z' },
      { agent_name: 'Dev', started_at: started, inflight_status: 'paused' },
    ]) {
      expect(groupMessagesIntoTurns(messages, NO_REACTIONS, false, undefined, [job])
        .map(turn => turn.isProcessing)).toEqual([false, false, false]);
    }
    expect(groupMessagesIntoTurns(messages.slice(0, 1), NO_REACTIONS, false, undefined, active)[0].isProcessing).toBe(false);
  });

  // ─── Empty input ─────────────────────────────────────────────
  it('returns empty array for empty messages', () => {
    const turns = groupMessagesIntoTurns([], NO_REACTIONS, false);
    expect(turns).toEqual([]);
  });

  // ─── Single user message ─────────────────────────────────────
  it('creates a human turn for a single user message', () => {
    const messages: ChatMessage[] = [
      msg({ id: '1', role: 'user', content: 'hello', sender_id: 10 }),
    ];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false, 10);
    expect(turns).toHaveLength(1);
    expect(turns[0].turnType).toBe('human');
    expect(turns[0].senderName).toBe('You');
    expect(turns[0].messages).toHaveLength(1);
  });

  // ─── Consecutive user messages from same sender ─────────────
  it('groups consecutive user messages from the same sender', () => {
    const messages: ChatMessage[] = [
      msg({ id: '1', role: 'user', content: 'hello', sender_id: 10 }),
      msg({ id: '2', role: 'user', content: 'world', sender_id: 10 }),
      msg({ id: '3', role: 'user', content: '!', sender_id: 10 }),
    ];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false, 10);
    expect(turns).toHaveLength(1);
    expect(turns[0].messages).toHaveLength(3);
  });

  // ─── Different senders split into separate turns ────────────
  it('splits user messages from different senders into separate turns', () => {
    const messages: ChatMessage[] = [
      msg({ id: '1', role: 'user', content: 'hi', sender_id: 10 }),
      msg({ id: '2', role: 'user', content: 'hey', sender_id: 20, sender_name: 'Alice' }),
    ];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false, 10);
    expect(turns).toHaveLength(2);
    expect(turns[0].senderName).toBe('You');
    expect(turns[1].senderName).toBe('Alice');
  });

  // ─── Standalone assistant text (no tools) ───────────────────
  it('creates agent turn for standalone assistant text', () => {
    const messages: ChatMessage[] = [
      msg({ id: '1', role: 'assistant', content: 'response' }),
    ];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false);
    expect(turns).toHaveLength(1);
    expect(turns[0].turnType).toBe('agent');
    expect(turns[0].senderName).toBe('AI');
  });

  // ─── Agent steps: thinking + tool_call + tool_result + text ──
  it('groups agent steps (thinking, tool_call, tool_result, text) into one turn', () => {
    const messages: ChatMessage[] = [
      msg({ id: '1', role: 'user', content: 'do something' }),
      msg({ id: '2', role: 'assistant', content: 'thinking...', contentType: 'thinking', agentName: 'Agent' }),
      msg({ id: '3', role: 'assistant', content: '{"tool":"search"}', contentType: 'tool_call', agentName: 'Agent' }),
      msg({ id: '4', role: 'tool', content: 'result data', contentType: 'tool_result', agentName: 'Agent' }),
      msg({ id: '5', role: 'assistant', content: 'Here is the answer', contentType: 'text', agentName: 'Agent' }),
    ];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false);
    expect(turns).toHaveLength(2); // 1 human + 1 agent
    expect(turns[0].turnType).toBe('human');
    expect(turns[1].turnType).toBe('agent');
    expect(turns[1].messages).toHaveLength(4); // thinking + tool_call + tool_result + text
    expect(turns[1].senderName).toBe('Agent');
    expect(turns[1].isProcessing).toBe(false);
  });

  // ─── isProcessing flag on last agent turn ───────────────────
  it('marks last agent turn as processing when isAgentProcessing=true and no final text', () => {
    const messages: ChatMessage[] = [
      msg({ id: '1', role: 'user', content: 'do something' }),
      msg({ id: '2', role: 'assistant', content: '{"tool":"search"}', contentType: 'tool_call' }),
      msg({ id: '3', role: 'tool', content: 'result', contentType: 'tool_result' }),
    ];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, true);
    expect(turns).toHaveLength(2);
    expect(turns[1].turnType).toBe('agent');
    expect(turns[1].isProcessing).toBe(true);
  });

  it('does NOT mark agent turn as processing when it has final text', () => {
    const messages: ChatMessage[] = [
      msg({ id: '1', role: 'user', content: 'do something' }),
      msg({ id: '2', role: 'assistant', content: '{"tool":"search"}', contentType: 'tool_call' }),
      msg({ id: '3', role: 'tool', content: 'result', contentType: 'tool_result' }),
      msg({ id: '4', role: 'assistant', content: 'done!', contentType: 'text' }),
    ];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, true);
    expect(turns).toHaveLength(2);
    expect(turns[1].isProcessing).toBe(false);
  });

  // ─── Race condition fix: processing with only tool steps ────
  it('marks last agent turn as processing via post-process when only tool steps exist', () => {
    const messages: ChatMessage[] = [
      msg({ id: '1', role: 'user', content: 'query' }),
      msg({ id: '2', role: 'assistant', content: 'thinking', contentType: 'thinking' }),
      msg({ id: '3', role: 'assistant', content: '{"tool":"db_query"}', contentType: 'tool_call' }),
    ];
    // Agent is still processing (tool results not arrived yet)
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, true);
    const agentTurn = turns.find(t => t.turnType === 'agent');
    expect(agentTurn).toBeDefined();
    expect(agentTurn!.isProcessing).toBe(true);
  });

  // ─── Human turn does not get processing flag ────────────────
  it('does not mark human turns as processing even when isAgentProcessing=true', () => {
    const messages: ChatMessage[] = [
      msg({ id: '1', role: 'user', content: 'hello' }),
    ];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, true);
    expect(turns[0].isProcessing).toBe(false);
  });

  // ─── Mixed conversation: user → agent → user → agent ────────
  it('handles alternating human and agent turns', () => {
    const messages: ChatMessage[] = [
      msg({ id: '1', role: 'user', content: 'q1', sender_id: 1 }),
      msg({ id: '2', role: 'assistant', content: 'a1' }),
      msg({ id: '3', role: 'user', content: 'q2', sender_id: 1 }),
      msg({ id: '4', role: 'assistant', content: 'a2' }),
    ];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false, 1);
    expect(turns).toHaveLength(4);
    expect(turns.map(t => t.turnType)).toEqual(['human', 'agent', 'human', 'agent']);
  });

  // ─── isFirstInGroup / isLastInGroup ─────────────────────────
  it('computes isFirstInGroup and isLastInGroup for consecutive same-sender turns', () => {
    const messages: ChatMessage[] = [
      msg({ id: '1', role: 'assistant', content: 'a1', agentName: 'Bot' }),
      msg({ id: '2', role: 'user', content: 'u1', sender_id: 1 }),
      msg({ id: '3', role: 'assistant', content: 'a2', agentName: 'Bot' }),
      msg({ id: '4', role: 'user', content: 'u2', sender_id: 1 }),
      msg({ id: '5', role: 'user', content: 'u3', sender_id: 1 }),
    ];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false, 1);
    // Should be: agent, human(u1), agent, human(u2+u3)
    expect(turns).toHaveLength(4);
    // No consecutive same-type turns, so all should be first and last
    turns.forEach(t => {
      expect(t.isFirstInGroup).toBe(true);
      expect(t.isLastInGroup).toBe(true);
    });
  });

  // ─── Reactions ──────────────────────────────────────────────
  it('aggregates reactions for agent turn messages', () => {
    const messages: ChatMessage[] = [
      msg({ id: '10', role: 'assistant', content: 'tool', contentType: 'tool_call' }),
      msg({ id: '11', role: 'tool', content: 'result', contentType: 'tool_result' }),
      msg({ id: '12', role: 'assistant', content: 'done', contentType: 'text' }),
    ];
    const reactions = {
      12: { '👍': [{ user_id: 1, user_name: 'Alice' }] },
    };
    const turns = groupMessagesIntoTurns(messages, reactions, false);
    expect(turns).toHaveLength(1);
    expect(turns[0].reactions).toHaveProperty('👍');
  });

  // ─── Optimistic messages (no sender_id) group with real msgs ─
  it('groups optimistic messages (no sender_id) with real messages from same user', () => {
    const messages: ChatMessage[] = [
      msg({ id: 'temp-1', role: 'user', content: 'optimistic' }), // no sender_id
      msg({ id: '100', role: 'user', content: 'confirmed', sender_id: 5 }),
    ];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false, 5);
    expect(turns).toHaveLength(1);
    expect(turns[0].messages).toHaveLength(2);
  });

  it.each(['assistant', 'system'] as const)('renders watchdog notices as system events with %s role', (role) => {
    const turns = groupMessagesIntoTurns([
      msg({ id: '1', role: 'assistant', content: 'Working', agentName: 'Frontend Developer' }),
      msg({ id: '2', role, senderType: 'system', contentType: 'text', content: 'Agent timed out' }),
    ], NO_REACTIONS, false);
    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({ senderName: 'system', isSystemEvent: true, isProcessing: false, turnType: 'human' });
    expect(turns[1].messages.map(message => message.id)).toEqual(['2']);
  });

  // ─── System messages treated as agent ───────────────────────
  it('treats system role messages as agent turns', () => {
    const messages: ChatMessage[] = [
      msg({ id: '1', role: 'system', content: 'Agent not found' }),
    ];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false);
    expect(turns).toHaveLength(1);
    expect(turns[0].turnType).toBe('agent');
  });

  // ─── Ticket #42123: metadata.agent_name takes priority ──────
  it('resolves senderName from metadata.agent_name when agentName is missing', () => {
    // Backend sends metadata.agent_name (snake_case) but frontend ChatMessage
    // type uses agentName (camelCase). The hook returns raw API data, so
    // agentName is often undefined while metadata.agent_name is set.
    const messages: ChatMessage[] = [
      msg({ id: '1', role: 'user', content: 'hello', sender_id: 10 }),
      msg({
        id: '2',
        role: 'assistant',
        content: 'thinking...',
        contentType: 'thinking',
        // agentName is NOT set (simulates raw API response)
        metadata: { agent_name: 'Architect', agent_row_id: 100 },
        sender_name: 'Orchestrator', // wrong name from conversation-level JOIN
      }),
      msg({
        id: '3',
        role: 'assistant',
        content: '{"tool":"search"}',
        contentType: 'tool_call',
        metadata: { agent_name: 'Architect', agent_row_id: 100 },
        sender_name: 'Orchestrator',
      }),
      msg({
        id: '4',
        role: 'tool',
        content: 'result',
        contentType: 'tool_result',
        metadata: { agent_name: 'Architect', agent_row_id: 100 },
        sender_name: 'Orchestrator',
      }),
      msg({
        id: '5',
        role: 'assistant',
        content: 'Here is the answer',
        contentType: 'text',
        metadata: { agent_name: 'Architect', agent_row_id: 100 },
        sender_name: 'Orchestrator',
      }),
    ];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false, 10);
    expect(turns).toHaveLength(2); // human + agent
    // Must show "Architect" from metadata, NOT "Orchestrator" from sender_name
    expect(turns[1].senderName).toBe('Architect');
  });

  it('resolves senderName from metadata.agent_name for standalone agent text', () => {
    const messages: ChatMessage[] = [
      msg({
        id: '1',
        role: 'assistant',
        content: 'plain response',
        metadata: { agent_name: 'Developer Ralph' },
        sender_name: 'AI Agent', // generic fallback
      }),
    ];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false);
    expect(turns).toHaveLength(1);
    expect(turns[0].senderName).toBe('Developer Ralph');
  });

  it('prefers agentName (camelCase) over metadata.agent_name when both exist', () => {
    const messages: ChatMessage[] = [
      msg({
        id: '1',
        role: 'assistant',
        content: 'response',
        agentName: 'Frontend Dev',
        metadata: { agent_name: 'Frontend Developer' },
        sender_name: 'Some Other Name',
      }),
    ];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false);
    expect(turns).toHaveLength(1);
    expect(turns[0].senderName).toBe('Frontend Dev');
  });

  it('resolves metadata.agent_name for human turn with agent senderType', () => {
    const messages: ChatMessage[] = [
      msg({
        id: '1',
        role: 'user',
        content: 'agent message in user role',
        senderType: 'agent',
        metadata: { agent_name: 'Test Agent' },
      }),
    ];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false);
    expect(turns).toHaveLength(1);
    expect(turns[0].senderName).toBe('Test Agent');
  });

  // ─── Ticket #42123: different agents split into separate turns (grouping bug) ──
  it('creates separate turns for consecutive standalone messages from different agents', () => {
    // Scenario: @architect called but Orchestrator message arrives first as standalone text,
    // then Architect responds. Both should appear under their own names.
    const messages: ChatMessage[] = [
      msg({ id: '1', role: 'user', content: '@architect do something', sender_id: 1 }),
      msg({
        id: '2',
        role: 'assistant',
        content: 'Routing to Architect...',
        metadata: { agent_name: 'Orchestrator' },
        sender_name: 'Orchestrator',
      }),
      msg({
        id: '3',
        role: 'assistant',
        content: 'Hello, I am Architect!',
        metadata: { agent_name: 'Architect' },
        sender_name: 'Orchestrator', // wrong chatPartner-level name — must be ignored
      }),
    ];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false, 1);
    // Must produce 3 turns: human, Orchestrator, Architect
    expect(turns).toHaveLength(3);
    expect(turns[0].turnType).toBe('human');
    expect(turns[1].senderName).toBe('Orchestrator');
    expect(turns[2].senderName).toBe('Architect');
  });

  it('groups consecutive standalone messages from the SAME agent into one turn', () => {
    // Multiple messages from Orchestrator in a row → single agent turn
    const messages: ChatMessage[] = [
      msg({
        id: '1',
        role: 'assistant',
        content: 'First paragraph',
        metadata: { agent_name: 'Orchestrator' },
      }),
      msg({
        id: '2',
        role: 'assistant',
        content: 'Second paragraph',
        metadata: { agent_name: 'Orchestrator' },
      }),
    ];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false);
    expect(turns).toHaveLength(1);
    expect(turns[0].senderName).toBe('Orchestrator');
    expect(turns[0].messages).toHaveLength(2);
  });

  it('separates step-based turns from different agents correctly', () => {
    // Orchestrator runs tool steps, then Architect runs its own tool steps
    const messages: ChatMessage[] = [
      msg({ id: '1', role: 'user', content: 'query', sender_id: 1 }),
      msg({ id: '2', role: 'assistant', content: 'thinking', contentType: 'thinking', metadata: { agent_name: 'Orchestrator' } }),
      msg({ id: '3', role: 'assistant', content: '{"tool":"route"}', contentType: 'tool_call', metadata: { agent_name: 'Orchestrator' } }),
      msg({ id: '4', role: 'tool', content: 'routed', contentType: 'tool_result', metadata: { agent_name: 'Orchestrator' } }),
      msg({ id: '5', role: 'assistant', content: 'done', contentType: 'text', metadata: { agent_name: 'Orchestrator' } }),
      msg({ id: '6', role: 'assistant', content: 'arch thinking', contentType: 'thinking', metadata: { agent_name: 'Architect' } }),
      msg({ id: '7', role: 'assistant', content: 'arch answer', contentType: 'text', metadata: { agent_name: 'Architect' } }),
    ];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false, 1);
    expect(turns).toHaveLength(3); // human, Orchestrator steps+text, Architect steps+text
    expect(turns[1].senderName).toBe('Orchestrator');
    expect(turns[2].senderName).toBe('Architect');
  });

  // ─── Sub-agent multi-turn conversation ──────────────────────
  it('handles sub-agent conversation with different agent names', () => {
    const messages: ChatMessage[] = [
      msg({ id: '1', role: 'user', content: 'translate this', sender_id: 1 }),
      msg({ id: '2', role: 'assistant', content: '{"tool":"translate"}', contentType: 'tool_call', agentName: 'MainAgent' }),
      msg({ id: '3', role: 'tool', content: 'translated text', contentType: 'tool_result', agentName: 'MainAgent' }),
      msg({ id: '4', role: 'assistant', content: 'Here you go', contentType: 'text', agentName: 'MainAgent' }),
      msg({ id: '5', role: 'assistant', content: 'Sub-agent summary', agentName: 'Summarizer' }),
    ];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false, 1);
    expect(turns).toHaveLength(3); // human, MainAgent steps, Summarizer text
    expect(turns[1].senderName).toBe('MainAgent');
    expect(turns[2].senderName).toBe('Summarizer');
  });

  // ─── Final text seals the bubble; later steps open a NEW bubble ──
  // Regression: after a turn is sealed by a final assistant `text`, more steps
  // from the SAME agent must start a fresh turn — not get appended to the sealed
  // one (which would "drag" the completed bubble on while the agent keeps working).
  it('seals the bubble on final text — later steps from the same agent open a new turn', () => {
    const messages: ChatMessage[] = [
      msg({ id: '1', role: 'user', content: 'go', sender_id: 1 }),
      // First answer: steps + final text → sealed turn
      msg({ id: '2', role: 'assistant', content: 'thinking A', contentType: 'thinking', agentName: 'Dev', agentId: 42 }),
      msg({ id: '3', role: 'assistant', content: '{"tool":"read"}', contentType: 'tool_call', agentName: 'Dev', agentId: 42 }),
      msg({ id: '4', role: 'assistant', content: 'first answer', contentType: 'text', agentName: 'Dev', agentId: 42 }),
      // Same agent keeps working AFTER the final text → must be a new bubble
      msg({ id: '5', role: 'assistant', content: 'thinking B', contentType: 'thinking', agentName: 'Dev', agentId: 42 }),
      msg({ id: '6', role: 'assistant', content: '{"tool":"write"}', contentType: 'tool_call', agentName: 'Dev', agentId: 42 }),
      msg({ id: '7', role: 'assistant', content: 'second answer', contentType: 'text', agentName: 'Dev', agentId: 42 }),
    ];
    const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false, 1);
    expect(turns).toHaveLength(3); // human, sealed-1, sealed-2
    // First sealed bubble: only its own steps + first final text (NOT dragged on)
    expect(turns[1].messages.map(m => m.id)).toEqual(['2', '3', '4']);
    expect(turns[1].isLastInGroup).toBe(true); // completed answer breaks the group
    // Second bubble: the post-seal work
    expect(turns[2].messages.map(m => m.id)).toEqual(['5', '6', '7']);
  });

  it.each([false, true])('keeps a sealed status bubble idle while later work runs (global=%s)', (processing) => {
    const turns = groupMessagesIntoTurns([
      msg({ id: '1', role: 'assistant', contentType: 'agent_status', agentName: 'Dev', agentId: 42,
        metadata: { placeholder: true, agent_status: 'running' } }),
      msg({ id: '2', role: 'assistant', contentType: 'text', content: 'Done', agentName: 'Dev', agentId: 42 }),
      msg({ id: '3', role: 'assistant', contentType: 'thinking', content: 'Next task', agentName: 'Dev', agentId: 42 }),
    ], NO_REACTIONS, processing);
    expect(turns.map(turn => turn.isProcessing)).toEqual([false, true]);
  });

  it('does not revive a completed answer from its running placeholder', () => {
    const turns = groupMessagesIntoTurns([
      msg({ id: '1', role: 'assistant', contentType: 'agent_status', agentName: 'Dev', agentId: 42,
        metadata: { placeholder: true, agent_status: 'running' } }),
      msg({ id: '2', role: 'assistant', contentType: 'text', content: 'Done', agentName: 'Dev', agentId: 42 }),
    ], NO_REACTIONS, true);
    expect(turns[0].isProcessing).toBe(false);
  });

  it('shows processing only on the latest segment of each concurrent agent', () => {
    const turns = groupMessagesIntoTurns([
      msg({ id: '1', role: 'assistant', contentType: 'thinking', content: 'Please review <<@qa>>', agentName: 'Dev', agentId: 42 }),
      msg({ id: '2', role: 'assistant', contentType: 'thinking', content: 'Reviewing', agentName: 'QA', agentId: 43 }),
      msg({ id: '3', role: 'assistant', contentType: 'text', content: 'Review complete', agentName: 'QA', agentId: 43 }),
      msg({ id: '4', role: 'assistant', contentType: 'thinking', content: 'Continuing', agentName: 'Dev', agentId: 42 }),
      msg({ id: '5', role: 'assistant', contentType: 'thinking', content: 'Another check', agentName: 'QA', agentId: 43 }),
    ], NO_REACTIONS, true);
    expect(turns.map(turn => [turn.senderName, turn.isProcessing])).toEqual([
      ['Dev', false], ['QA', false], ['Dev', true], ['QA', true],
    ]);
  });

  // ─── WP-2 FE (Bugs 1552/228710): lazy step groups from two agents ────
  // The backend closes a step group when the agent changes and stamps
  // agent_id/agent_name on it. One annotation may therefore carry runs from
  // several agents; each run must become its own bubble.
  describe('lazy step groups from several agents (WP-2, 228710)', () => {
    const ORCH = { agent_id: 7, agent_name: 'Orchestrator', agent_icon: '🎯', agent_color: '#f59e0b' };
    const ARCH = { agent_id: 9, agent_name: 'Architect', agent_icon: '🏛️', agent_color: '#3b82f6' };
    const grp = (type: 'thinking' | 'tools', count: number, first: number, agent?: Partial<typeof ORCH>) =>
      ({ type, count, first_id: first, last_id: first + count - 1, ...(type === 'thinking' ? { preview: 'hm' } : {}), ...agent });
    const annotated = (m: ChatMessage, ann: Record<string, unknown>): ChatMessage => ({ ...m, ...ann } as ChatMessage);
    const groupsOf = (turn: Turn, side: 'before' | 'after') =>
      turn.messages.flatMap(m => ((m as any)[`_step_groups_${side}`] as unknown[] | undefined) ?? []);

    it('splits _step_groups_after on a human message into one synthetic turn per agent', () => {
      const messages: ChatMessage[] = [
        annotated(msg({ id: '1', role: 'user', content: 'go', sender_id: 1 }), {
          _step_groups_after: [grp('tools', 3, 2, ORCH), grp('thinking', 2, 5, ARCH)],
          _total_hidden_after: 5,
        }),
      ];
      const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false, 1);
      expect(turns.map(t => [t.turnType, t.senderName])).toEqual([
        ['human', 'You'], ['agent', 'Orchestrator'], ['agent', 'Architect'],
      ]);
      expect(turns[1].agentChainId).not.toBe(turns[2].agentChainId);
      expect(turns[1].agentIcon).toBe('🎯');
      expect(turns[2].agentColor).toBe('#3b82f6');
      expect(groupsOf(turns[1], 'after')).toHaveLength(1);
      expect((turns[1].messages[0] as any)._total_hidden_after).toBe(3);
      expect(groupsOf(turns[2], 'after')).toHaveLength(1);
      expect((turns[2].messages[0] as any)._total_hidden_after).toBe(2);
      // synthetic placeholders never spin
      expect(turns[1].isProcessing).toBe(false);
      expect(turns[2].isProcessing).toBe(false);
      // the human message itself is handed out clean
      expect((turns[0].messages[0] as any)._step_groups_after).toBeUndefined();
    });

    it('keeps an agent\'s own groups on its text message and lifts the other agent\'s run out', () => {
      const messages: ChatMessage[] = [
        msg({ id: '1', role: 'user', content: 'go', sender_id: 1 }),
        annotated(msg({ id: '2', role: 'assistant', content: 'dispatching', contentType: 'text', metadata: { agent_name: 'Orchestrator', agent_row_id: 7 } }), {
          _step_groups_after: [grp('tools', 2, 3, ORCH), grp('thinking', 4, 5, ARCH), grp('tools', 1, 9, ORCH)],
          _total_hidden_after: 7,
        }),
        msg({ id: '10', role: 'user', content: 'thanks', sender_id: 1 }),
      ];
      const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false, 1);
      expect(turns.map(t => t.senderName)).toEqual(['You', 'Orchestrator', 'Architect', 'You']);
      const orch = turns[1];
      expect(groupsOf(orch, 'after')).toHaveLength(2);
      expect((orch.messages[0] as any)._total_hidden_after).toBe(3);
      expect(orch.messages[0].content).toBe('dispatching');
      const arch = turns[2];
      expect(groupsOf(arch, 'after')).toHaveLength(1);
      expect((arch.messages[0] as any)._total_hidden_after).toBe(4);
      expect(arch.messages[0].contentType).toBe('agent_status');
      expect(arch.messages[0].metadata?.agent_row_id).toBe(9);
    });

    it('puts _step_groups_before runs of two agents ahead of the human turn, in order', () => {
      const messages: ChatMessage[] = [
        annotated(msg({ id: '20', role: 'user', content: 'and now?', sender_id: 1 }), {
          _step_groups_before: [grp('thinking', 1, 11, ARCH), grp('tools', 2, 12, ORCH)],
          _total_hidden_before: 3,
        }),
      ];
      const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false, 1);
      expect(turns.map(t => t.senderName)).toEqual(['Architect', 'Orchestrator', 'You']);
      expect(groupsOf(turns[0], 'before')).toHaveLength(1);
      expect(groupsOf(turns[1], 'before')).toHaveLength(1);
    });

    it('does not merge two human messages when another agent\'s steps sit between them', () => {
      const messages: ChatMessage[] = [
        annotated(msg({ id: '1', role: 'user', content: 'first', sender_id: 1 }), {
          _step_groups_after: [grp('tools', 1, 2, ARCH)],
          _total_hidden_after: 1,
        }),
        msg({ id: '3', role: 'user', content: 'second', sender_id: 1 }),
      ];
      const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false, 1);
      expect(turns.map(t => [t.turnType, t.senderName])).toEqual([
        ['human', 'You'], ['agent', 'Architect'], ['human', 'You'],
      ]);
    });

    it('legacy groups without agent info still form a single synthetic turn', () => {
      const messages: ChatMessage[] = [
        annotated(msg({ id: '1', role: 'user', content: 'go', sender_id: 1 }), {
          _step_groups_after: [grp('thinking', 1, 2), grp('tools', 2, 3)],
          _total_hidden_after: 3,
        }),
      ];
      const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false, 1);
      expect(turns).toHaveLength(2);
      expect(turns[1].turnType).toBe('agent');
      expect(groupsOf(turns[1], 'after')).toHaveLength(2);
    });

    // An interrupted run has no final text row, so its bubble is built from the
    // lazy groups alone. Those carry the raw metadata colour (null for agents
    // whose writer never stamps one) — the directory must fill the gap, or the
    // stripe falls back to purple the moment the agent is stopped.
    it('resolves colour/icon for a synthetic turn from the agent directory', () => {
      const messages: ChatMessage[] = [
        annotated(msg({ id: '1', role: 'user', content: 'go', sender_id: 1 }), {
          _step_groups_after: [grp('thinking', 1, 2, { agent_id: 44465, agent_name: 'Marketer' })],
          _total_hidden_after: 1,
        }),
      ];
      const resolveAgent = (id: number) => id === 44465 ? { color: '#f97316', icon: '📣' } : null;
      const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false, 1, [], resolveAgent);
      expect(turns[1].senderName).toBe('Marketer');
      expect(turns[1].agentColor).toBe('#f97316');
      expect(turns[1].agentIcon).toBe('📣');
    });

    it('keeps the colour stamped on the group over the directory one', () => {
      const messages: ChatMessage[] = [
        annotated(msg({ id: '1', role: 'user', content: 'go', sender_id: 1 }), {
          _step_groups_after: [grp('tools', 1, 2, ORCH)],
          _total_hidden_after: 1,
        }),
      ];
      const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false, 1, [], () => ({ color: '#000000' }));
      expect(turns[1].agentColor).toBe(ORCH.agent_color);
      expect(turns[1].agentIcon).toBe(ORCH.agent_icon);
    });

    // A user message sent mid-run cuts the agent's bubble: the steps before it
    // have no text row, so after any full reload (reconnect, chat switch) the
    // list endpoint hands them back as _step_groups_before on that user message.
    // The cut-off segment is then a synthetic turn and must keep the agent colour.
    it('keeps the colour of a segment cut off by a user message (lazy reload)', () => {
      const marketer = { agent_name: 'Marketer', agent_row_id: 44465 };
      const messages: ChatMessage[] = [
        msg({ id: '1', role: 'user', content: 'draw the garden', sender_id: 1 }),
        annotated(msg({ id: '10', role: 'user', content: 'can you also…', sender_id: 1 }), {
          _step_groups_before: [
            grp('thinking', 1, 2, { agent_id: 44465, agent_name: 'Marketer' }),
            grp('tools', 7, 3, { agent_id: 44465, agent_name: 'Marketer' }),
          ],
          _total_hidden_before: 8,
        }),
        msg({ id: '11', role: 'assistant', contentType: 'thinking', content: 'here it is', sender_id: 51, agent_color: '#f97316', metadata: marketer }),
        msg({ id: '12', role: 'assistant', contentType: 'text', content: 'here it is', sender_id: 51, agent_color: '#f97316', metadata: marketer }),
      ];
      const resolveAgent = (id: number) => id === 44465 ? { color: '#f97316', icon: '📣' } : null;
      const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false, 1, [], resolveAgent);
      expect(turns.map(t => t.senderName)).toEqual(['You', 'Marketer', 'You', 'Marketer']);
      expect(groupsOf(turns[1], 'before')).toHaveLength(2);
      expect(turns[1].agentColor).toBe('#f97316');
      expect(turns[3].agentColor).toBe('#f97316');
      // the directory is the only source here — without it the stripe goes purple
      expect(groupMessagesIntoTurns(messages, NO_REACTIONS, false, 1)[1].agentColor).toBeUndefined();
    });

    it('drops a stale annotation when the real step messages are already in the cache', () => {
      const messages: ChatMessage[] = [
        annotated(msg({ id: '1', role: 'user', content: 'go', sender_id: 1 }), {
          _step_groups_after: [grp('thinking', 1, 2, ARCH)],
          _total_hidden_after: 1,
        }),
        msg({ id: '2', role: 'assistant', content: 'hm', contentType: 'thinking', metadata: { agent_name: 'Architect', agent_row_id: 9 } }),
        msg({ id: '3', role: 'assistant', content: 'done', contentType: 'text', metadata: { agent_name: 'Architect', agent_row_id: 9 } }),
      ];
      const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false, 1);
      expect(turns.map(t => t.senderName)).toEqual(['You', 'Architect']);
      expect(turns[1].messages.map(m => m.id)).toEqual(['2', '3']);
    });

    it('does not mutate the input messages', () => {
      const user = annotated(msg({ id: '1', role: 'user', content: 'go', sender_id: 1 }), {
        _step_groups_after: [grp('tools', 1, 2, ORCH), grp('tools', 1, 3, ARCH)],
        _total_hidden_after: 2,
      });
      groupMessagesIntoTurns([user], NO_REACTIONS, false, 1);
      expect((user as any)._step_groups_after).toHaveLength(2);
      expect((user as any)._total_hidden_after).toBe(2);
    });
  });

  // ─── Settled status leftovers (empty bubbles after 228709) ───────────────
  describe('settled agent_status rows', () => {
    const settled = (id: string, name: string, rowId: number) =>
      msg({
        id, role: 'assistant', contentType: 'agent_status', content: '',
        metadata: { agent_name: name, agent_row_id: rowId, agent_status: 'finished', placeholder: false },
      });

    it('drops a turn made only of an empty finished status row', () => {
      const messages: ChatMessage[] = [
        msg({ id: '1', role: 'user', content: 'go', sender_id: 1 }),
        settled('2', 'Orchestrator', 5),
        msg({ id: '3', role: 'user', content: 'next', sender_id: 1 }),
        settled('4', 'SysAdmin', 6),
        msg({ id: '5', role: 'assistant', contentType: 'agent_status', content: '',
          metadata: { agent_name: 'Architect', agent_row_id: 7, agent_status: 'error', placeholder: false } }),
      ];
      const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, true, 1);
      expect(turns.map(t => t.senderName)).toEqual(['You', 'You']);
      // Even with the backend reporting processing, no ghost bubble is revived.
      expect(turns.some(t => t.isProcessing)).toBe(false);
    });

    it('keeps the status row when the same turn has steps or text', () => {
      const meta = { agent_name: 'Architect', agent_row_id: 7 };
      const messages: ChatMessage[] = [
        msg({ id: '1', role: 'user', content: 'go', sender_id: 1 }),
        msg({ id: '2', role: 'assistant', contentType: 'agent_status', content: '',
          metadata: { ...meta, agent_status: 'finished', placeholder: false, terminal_session_id: 42 } }),
        msg({ id: '3', role: 'assistant', contentType: 'tool_call', content: 'x', metadata: meta }),
        msg({ id: '4', role: 'assistant', contentType: 'text', content: 'done', metadata: meta }),
      ];
      const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false, 1);
      expect(turns).toHaveLength(2);
      expect(turns[1].messages.map(m => m.id)).toEqual(['2', '3', '4']);
    });

    it('keeps an active placeholder and a synthetic step-group carrier', () => {
      const messages: ChatMessage[] = [
        msg({ id: '1', role: 'user', content: 'go', sender_id: 1 }),
        msg({ id: '2', role: 'assistant', contentType: 'agent_status', content: '',
          metadata: { agent_name: 'Orchestrator', agent_row_id: 5, agent_status: 'thinking', placeholder: true } }),
        msg({ id: 'synthetic_agent_after_1_0', role: 'assistant', contentType: 'agent_status', content: '',
          metadata: { agent_name: 'SysAdmin', agent_row_id: 6, placeholder: true, synthetic: true } }),
      ];
      const turns = groupMessagesIntoTurns(messages, NO_REACTIONS, false, 1);
      expect(turns.map(t => t.senderName)).toEqual(['You', 'Orchestrator', 'SysAdmin']);
    });
  });
});


describe('plan migration', () => {
  const plan = msg({ id: '101', role: 'assistant', contentType: 'plan', agentName: 'Dev', agentId: 42,
    content: JSON.stringify({ tasks: [{ id: 1, title: 'Check', status: 'in_progress' }] }) });
  const answer = msg({ id: '102', role: 'assistant', contentType: 'text', content: 'First answer', agentName: 'Dev', agentId: 42 });

  it.each(['thinking', 'tool_call', 'agent_status'] as const)('moves on the first %s before any plan update', (contentType) => {
    const messages = [plan, answer];
    const before = groupMessagesIntoTurns(messages, {}, false);
    expect(before[0].planMessage).toBe(plan);
    const next = msg({ id: '103', role: 'assistant', contentType, agentName: 'Dev', agentId: 42,
      metadata: { placeholder: true, agent_status: 'running' } });
    const after = groupMessagesIntoTurns([...messages, next], {}, true);
    expect(after).toHaveLength(2);
    expect(after[0].planMessage).toBeNull();
    expect(after[1].planMessage).toBe(plan);
    expect(after[0].messages).toEqual([plan, answer]);
    expect(after[1].messages).toEqual([next]);
    expect(after[0].id).toBe(before[0].id);
    expect(messages).toEqual([plan, answer]);
  });

  it('keeps plans separate for concurrent agents and replaces the carried plan on update', () => {
    const otherPlan = msg({ ...plan, id: '103', agentId: 43 });
    const next = msg({ id: '104', role: 'assistant', contentType: 'thinking', content: 'Next', agentName: 'Dev', agentId: 42 });
    const messages = [plan, answer, otherPlan, next];
    const turns = groupMessagesIntoTurns(messages, {}, true);
    expect(turns.filter(t => t.planMessage).map(t => t.planMessage?.id).sort()).toEqual(['101', '103']);
    expect(turns.find(t => t.messages.includes(next))?.planMessage).toBe(plan);
    const updated = msg({ ...plan, id: '105', content: JSON.stringify({ tasks: [] }) });
    const after = groupMessagesIntoTurns([...messages, updated], {}, true);
    expect(after.find(t => t.messages.includes(next))?.planMessage).toBe(updated);
    expect(after.filter(t => t.planMessage).map(t => t.planMessage?.id).sort()).toEqual(['103', '105']);
  });
});
