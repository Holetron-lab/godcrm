// Moved-messages preview: the same compact cards as the pinned panel, each
// expandable to the whole message.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders as render } from '@/tests/renderWithProviders';
import { MemoryRouter } from 'react-router-dom';
import { MovedMessagesPreview } from '../ChatTurn/MovedMessagesPreview';
import type { MovedMessagePreview } from '../../../../../hooks/useMovedMessagesPreview';

const previewState: { data?: MovedMessagePreview[]; isLoading: boolean; error: Error | null } = { isLoading: false, error: null };
vi.mock('../../../../../hooks/useMovedMessagesPreview', () => ({ useMovedMessagesPreview: () => previewState }));

const moved = (id: number, overrides: Partial<MovedMessagePreview> = {}): MovedMessagePreview => ({
  id, sender_id: 1, sender_type: 'human', role: 'user', content: `message ${id}`, content_type: 'text',
  attachments: [], metadata: {}, created_at: '2026-11-08T10:00:00.000Z', sender_name: 'GERATRON',
  sender_avatar: null, sender_user_type: 'human', ...overrides,
});
const longText = `**Итог** ${'очень длинный текст '.repeat(40)}конец`;
const renderPreview = (messageIds: number[]) =>
  render(<MemoryRouter><MovedMessagesPreview conversationId={3822} messageIds={messageIds} /></MemoryRouter>);

describe('MovedMessagesPreview', () => {
  beforeEach(() => { previewState.data = undefined; previewState.isLoading = false; previewState.error = null; });

  it('shows each moved message as a card with its author', () => {
    previewState.data = [
      moved(1),
      moved(2, { role: 'assistant', sender_id: 42, sender_name: 'Architect', sender_type: 'agent', metadata: { agent_name: 'Architect' } }),
    ];

    renderPreview([1, 2]);

    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText('GERATRON')).toBeInTheDocument();
    expect(within(cards[1]).getByText('Architect')).toBeInTheDocument();
  });

  it('starts collapsed and expands one message to its full text on demand', () => {
    previewState.data = [moved(1, { content: longText }), moved(2)];

    renderPreview([1, 2]);

    const [first, second] = screen.getAllByRole('listitem');
    const toggle = within(first).getByRole('button', { name: 'Развернуть сообщение от GERATRON', expanded: false });
    fireEvent.click(toggle);

    expect(within(first).getByRole('button', { name: 'Свернуть сообщение от GERATRON', expanded: true })).toBeInTheDocument();
    expect(first.querySelector('.line-clamp-2')).toBeNull();
    expect(first.textContent).toContain('конец');
    // The neighbour stays a preview.
    expect(second.querySelector('.line-clamp-2')).not.toBeNull();
  });

  it('leaves agent step messages out of the preview', () => {
    previewState.data = [moved(1), moved(2, { content_type: 'tool_call', content: '{"tool":"x"}' }), moved(3, { content_type: 'thinking' })];

    renderPreview([1, 2, 3]);

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('says when the move is larger than the preview', () => {
    previewState.data = [moved(1)];

    renderPreview(Array.from({ length: 120 }, (_, i) => i + 1));

    expect(screen.getByText('Показаны первые 50 из 120 — остальные в чате')).toBeInTheDocument();
  });

  it('keeps the loading, error and empty states', () => {
    previewState.isLoading = true;
    const { unmount } = renderPreview([1]);
    expect(screen.getByText('Загрузка сообщений...')).toBeInTheDocument();
    unmount();

    previewState.isLoading = false;
    previewState.error = new Error('500');
    const second = renderPreview([1]);
    expect(screen.getByText('Не удалось загрузить сообщения')).toBeInTheDocument();
    second.unmount();

    previewState.error = null;
    previewState.data = [];
    renderPreview([1]);
    expect(screen.getByText('Сообщения недоступны')).toBeInTheDocument();
  });
});
