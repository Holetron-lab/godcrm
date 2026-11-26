import { describe, expect, it } from 'vitest';
import { groupMessagesIntoTurns } from '../groupMessagesIntoTurns';
import type { ChatMessage } from '../../types';

const mover = { user_id: 1, name: 'GERATRON', avatar: '/avatars/1.png' };

const stub = (id: number, overrides: Partial<ChatMessage> = {}, batchId = 'batch-a', movedBy = mover): ChatMessage => ({
  id: String(id),
  role: 'user',
  content: 'Moved to chat #3822',
  contentType: 'moved',
  timestamp: new Date('2026-11-08T10:00:00Z'),
  sender_id: 1,
  sender_name: 'GERATRON',
  metadata: { moved_to: { conversation_id: 3822, message_id: id + 1000, message_ids: [1001, 1002, 1003], batch_id: batchId, moved_by: movedBy } },
  ...overrides,
});
const text = (id: number, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: String(id), role: 'user', content: 'hello', contentType: 'text', timestamp: new Date('2026-11-08T11:00:00Z'),
  sender_id: 1, sender_name: 'GERATRON', ...overrides,
});
const agentStub = (id: number, batchId = 'batch-a') =>
  stub(id, { role: 'assistant', sender_id: 42, sender_name: 'Architect', agentName: 'Architect', agentId: 7 }, batchId);

describe('groupMessagesIntoTurns — moved-out messages', () => {
  it('collapses one move into a single turn even when the moved messages had different authors', () => {
    const turns = groupMessagesIntoTurns([stub(1), agentStub(2), stub(3)], {}, false, 1);

    expect(turns).toHaveLength(1);
    expect(turns[0].messages.map(m => m.id)).toEqual(['1', '2', '3']);
  });

  it('attributes the block to whoever moved the messages, marked as a system event', () => {
    const turns = groupMessagesIntoTurns([agentStub(2), stub(3)], {}, false, 99);

    expect(turns[0]).toMatchObject({ turnType: 'human', senderName: 'GERATRON', senderAvatar: '/avatars/1.png', isSystemEvent: true });
  });

  it('keeps separate moves separate', () => {
    const turns = groupMessagesIntoTurns([stub(1), agentStub(2), stub(3, {}, 'batch-b'), agentStub(4, 'batch-b')], {}, false, 1);

    expect(turns.map(turn => turn.messages.map(m => m.id))).toEqual([['1', '2'], ['3', '4']]);
  });

  it('does not swallow the messages around a move', () => {
    const turns = groupMessagesIntoTurns(
      [text(1), stub(2), agentStub(3), text(4), text(5, { role: 'assistant', sender_id: 42, sender_name: 'Architect', agentName: 'Architect', agentId: 7 })],
      {}, false, 99,
    );

    expect(turns.map(turn => turn.messages.map(m => m.id))).toEqual([['1'], ['2', '3'], ['4'], ['5']]);
    // The mover's own messages keep their header: the block is not theirs to merge into.
    expect(turns.map(turn => turn.isFirstInGroup)).toEqual([true, true, true, true]);
    expect(turns.map(turn => turn.isLastInGroup)).toEqual([true, true, true, true]);
  });

  it('keeps reactions left on the moved messages', () => {
    const reactions = { 2: { '👍': [{ user_id: 5, user_name: 'Anna' }] } };

    const turns = groupMessagesIntoTurns([stub(1), agentStub(2)], reactions, false, 1);

    expect(turns[0].reactions).toEqual({ '👍_2': [{ user_id: 5, user_name: 'Anna' }] });
  });
});
