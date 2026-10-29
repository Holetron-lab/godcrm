import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../types';
import { groupMessagesIntoTurns } from '../groupMessagesIntoTurns';

const message = (id: string, contentType: ChatMessage['contentType'], agentName = 'Frontend QA'): ChatMessage => ({
  id, contentType, role: 'assistant', agentName,
  timestamp: new Date('2026-09-24T20:45:50Z'),
  content: contentType === 'thinking' ? 'Ready. <<@developer-ralph>> check the fix.' : 'Ready for review.',
});

describe('thinking invocation followed by a final answer', () => {
  it.each([false, true])('keeps uninterrupted steps and answer in one bubble (processing=%s)', processing => {
    const messages = [message('1', 'tool_call'), message('2', 'thinking'), message('3', 'text')];
    const turns = groupMessagesIntoTurns(messages, { 3: { '❤️': [{ user_id: 1, user_name: 'Owner' }] } }, processing);
    expect(turns).toHaveLength(1);
    expect(turns[0].messages).toEqual(messages);
    expect(turns[0].id).toBe('turn_agent_1');
    expect(turns[0].isProcessing).toBe(false);
    expect(turns[0].reactions['❤️']).toHaveLength(1);
  });

  it('keeps an early handoff placeholder after the complete source answer', () => {
    const status = { ...message('2', 'agent_status', 'Developer Ralph'), content: '', metadata: { placeholder: true } };
    const turns = groupMessagesIntoTurns([message('1', 'thinking'), status, message('3', 'text')], {}, true);
    expect(turns.map(turn => turn.messages.map(item => item.id))).toEqual([['1', '3'], ['2']]);
    expect(turns.map(turn => turn.isProcessing)).toEqual([false, true]);
  });

  it.each(['thinking', 'text'] as const)('preserves a real intervening agent %s', contentType => {
    const intervening = { ...message('2', contentType, 'Developer Ralph'), content: 'Checking now.' };
    const turns = groupMessagesIntoTurns([message('1', 'thinking'), intervening, message('3', 'text')], {}, false);
    expect(turns.map(turn => turn.messages.map(item => item.id))).toEqual([['1'], ['2'], ['3']]);
  });

  it('preserves an intervening human message', () => {
    const human: ChatMessage = { id: '2', role: 'user', content: 'Wait', timestamp: new Date() };
    const turns = groupMessagesIntoTurns([message('1', 'thinking'), human, message('3', 'text')], {}, false);
    expect(turns.map(turn => turn.messages.map(item => item.id))).toEqual([['1'], ['2'], ['3']]);
  });

  it('keeps work after a completed answer in a separate bubble', () => {
    const turns = groupMessagesIntoTurns([
      message('1', 'thinking'), message('2', 'text'), message('3', 'tool_call'), message('4', 'text'),
    ], {}, false);
    expect(turns.map(turn => turn.messages.map(item => item.id))).toEqual([['1', '2'], ['3', '4']]);
  });
});
