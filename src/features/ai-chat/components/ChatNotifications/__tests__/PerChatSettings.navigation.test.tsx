import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { ChatToolbarOverflowMenu } from '../../AIChatPanel/components/ChatToolbarOverflowMenu';
import { PerChatSettingsInline } from '../PerChatSettingsInline';
import type { useConversationSpace } from '../../AIChatPanel/hooks/useConversationSpace';

vi.mock('@/features/spaces/hooks/useSpacesQuery', () => ({ useSpacesQuery: () => ({ data: [{ id: 11, name: 'Development' }] }) }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn().mockResolvedValue({ data: { prefs: null, participants: [] } }) } }));
vi.mock('../../ParticipantSelector', () => ({ ParticipantSelector: () => null }));

describe('conversation settings navigation', () => {
  it('opens chat settings beside notifications, participants and delete', () => {
    const settings = vi.fn();
    renderWithProviders(<ChatToolbarOverflowMenu onSettings={settings} onNotifications={vi.fn()} onParticipants={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));
    expect(screen.getByRole('menuitem', { name: 'Участники' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Удалить чат' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Настройки чата' }));
    expect(settings).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('disables settings without a conversation', () => {
    renderWithProviders(<ChatToolbarOverflowMenu onSettings={vi.fn()} settingsDisabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));
    expect(screen.getByRole('menuitem', { name: 'Настройки чата' })).toBeDisabled();
  });

  it('shows Space only on the conversation settings tab and preserves restrictions', () => {
    const binding = {
      conversation: { id: 44, space_id: 11 }, loading: false, loadError: false,
      restriction: null, error: '', dialogOpen: false, openSettings: vi.fn(),
    } as unknown as ReturnType<typeof useConversationSpace>;
    const { rerender } = renderWithProviders(<PerChatSettingsInline conversationId={44} initialTab="settings" conversationSpace={binding} onClose={vi.fn()} />);
    expect(screen.getByText('Development #11')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать Space' }));
    expect(binding.openSettings).toHaveBeenCalledOnce();
    rerender(<PerChatSettingsInline conversationId={44} initialTab="settings" conversationSpace={{ ...binding, restriction: 'Только владелец чата' }} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Выбрать Space' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Участники' }));
    expect(screen.queryByText('Space чата')).not.toBeInTheDocument();
  });
});
