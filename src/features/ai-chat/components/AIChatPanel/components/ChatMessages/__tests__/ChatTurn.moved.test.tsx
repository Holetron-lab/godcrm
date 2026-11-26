// One move = one block in the source chat: who moved, how many, where to,
// whose messages — and an expandable preview.
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders as render } from '@/tests/renderWithProviders';
import { MemoryRouter } from 'react-router-dom';
import type { ChatMessage } from '../../../../../types';
import { groupMessagesIntoTurns } from '../../../../../utils/groupMessagesIntoTurns';
import { ChatTurn } from '../ChatTurn';

vi.mock('../../../../../hooks/useChatSummary', () => ({
  useChatSummary: () => ({
    data: { id: 3822, title: 'Повторяющиеся задачи', type: 'group', participants: [], participants_total: 4, agent: null, bound_row: null, deleted: false },
    isLoading: false,
    error: undefined,
  }),
}));
vi.mock('../../../../../hooks/useMovedMessagesPreview', () => ({
  useMovedMessagesPreview: () => ({
    data: [{ id: 1001, sender_id: 1, sender_type: 'human', role: 'user', content: 'перенесённый текст', content_type: 'text',
      attachments: [], metadata: {}, created_at: '2026-11-08T10:00:00.000Z', sender_name: 'GERATRON', sender_avatar: null, sender_user_type: 'human' }],
    isLoading: false,
    error: null,
  }),
}));

const movedTo = { conversation_id: 3822, message_ids: [1001, 1002, 1003, 1004, 1005], batch_id: 'batch-a', moved_by: { user_id: 1, name: 'GERATRON', avatar: null } };
const stub = (id: number, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: String(id), role: 'user', content: 'Moved to chat #3822', contentType: 'moved', timestamp: new Date('2026-11-08T10:00:00Z'),
  sender_id: 1, sender_name: 'GERATRON', metadata: { moved_to: { ...movedTo, message_id: id + 1000 } }, ...overrides,
});
// Three of the five moved messages are loaded; the other two are on an older history page.
const loadedStubs = [
  stub(1),
  stub(2, { role: 'assistant', sender_id: 42, sender_name: 'Architect', agentName: 'Architect' }),
  stub(3),
];

const renderMove = () => {
  const turns = groupMessagesIntoTurns(loadedStubs, {}, false, 99);
  expect(turns).toHaveLength(1);
  const [turn] = turns;
  return render(
    <MemoryRouter>
      <ChatTurn messages={turn.messages} turnType={turn.turnType} senderName={turn.senderName} isSystemEvent={turn.isSystemEvent} conversationId={3660} />
    </MemoryRouter>,
  );
};

describe('ChatTurn — a move out of the chat', () => {
  it('renders one card with the mover, the size of the whole move, the target chat and the authors', () => {
    const { container } = renderMove();

    expect(container.querySelectorAll('[data-chatlinkcard="true"]')).toHaveLength(1);
    expect(screen.getByText('Перенесено · GERATRON')).toBeInTheDocument();
    expect(screen.getByText('5 сообщ.')).toBeInTheDocument();
    expect(screen.getByText('в «Повторяющиеся задачи»')).toBeInTheDocument();
    expect(screen.getByText('От: GERATRON, Architect')).toBeInTheDocument();
  });

  it('opens the message preview from the card', () => {
    renderMove();
    expect(screen.queryByText('перенесённый текст')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Показать сообщения' }));

    expect(screen.getByRole('button', { name: 'Развернуть сообщение от GERATRON', expanded: false })).toBeInTheDocument();
  });
});
