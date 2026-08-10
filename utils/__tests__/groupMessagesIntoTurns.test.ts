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
});
