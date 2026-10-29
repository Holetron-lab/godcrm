import { fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { PerChatSettingsInline } from '../PerChatSettingsInline';
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn().mockResolvedValue({ data: { created_by: 1, participants: [{ user_id: 2, name: 'Agent', role: 'member', avatar_url: '🤖', color: '#12ab34' }] } }) } }));
vi.mock('../../ParticipantSelector', () => ({ ParticipantSelector: () => null }));
it('shows participant emoji and left accent, with close in the tab strip', async () => {
  const close = vi.fn();
  const { container } = renderWithProviders(<PerChatSettingsInline conversationId={7} initialTab="participants" onClose={close} />);
  expect(await screen.findByText('🤖')).toBeInTheDocument();
  expect(container.querySelector('img[src="🤖"]')).toBeNull();
  expect(screen.getByRole('listitem')).toHaveStyle({ boxShadow: 'inset 4px 0 0 0 #12ab34' });
  expect(screen.queryByText('Настройки чата')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  expect(close).toHaveBeenCalledOnce();
});
