import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatListView } from '../ChatListView';
import { ChatConversationView } from '../ChatConversationView';

vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key, language: 'en' }) }));
vi.mock('../ChatMessageList', () => ({ ChatMessageList: () => null }));
vi.mock('../MentionInput', () => ({ MentionInput: () => <input aria-label="Message" /> }));
vi.mock('../PinnedBanner', () => ({ PinnedBanner: () => null }));
vi.mock('@/features/auth/store/authStore', () => ({ useAuthStore: () => null }));
afterEach(cleanup);

const chats = [{ id: 1, title: 'Team chat', type: 'group' as const }];

it('selects a chat with Enter and Space', async () => {
  const user = userEvent.setup();
  const onSelectChat = vi.fn();
  render(<ChatListView chats={chats} onSelectChat={onSelectChat} onCreateChat={vi.fn()} />);
  const chat = screen.getByRole('button', { name: 'Team chat' });
  chat.focus();
  await user.keyboard('{Enter} ');
  expect(onSelectChat.mock.calls).toEqual([[1], [1]]);
});

it('opens chat actions by keyboard, closes with Escape, and does not select the chat', async () => {
  const user = userEvent.setup();
  const onSelectChat = vi.fn();
  const onPinChat = vi.fn();
  render(<ChatListView chats={chats} onSelectChat={onSelectChat} onCreateChat={vi.fn()} onPinChat={onPinChat} />);
  const trigger = screen.getByLabelText('aiChat.ui.more: Team chat');
  trigger.focus();
  await user.keyboard('{Enter}');
  await user.tab();
  expect(screen.getByRole('button', { name: 'aiChat.ui.pin' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(trigger).toHaveFocus();
  expect(trigger.closest('details')).not.toHaveAttribute('open');
  await user.keyboard(' ');
  await user.tab();
  await user.keyboard('{Enter}');
  expect(onPinChat).toHaveBeenCalledExactlyOnceWith(1);
  expect(onSelectChat).not.toHaveBeenCalled();
  expect(trigger.closest('details')).not.toHaveAttribute('open');
  expect(trigger).toHaveFocus();
});

it('retains right-click actions and dismisses them when focus leaves', async () => {
  const user = userEvent.setup();
  render(<ChatListView chats={chats} onSelectChat={vi.fn()} onCreateChat={vi.fn()} onMuteChat={vi.fn()} />);
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Team chat' }));
  const trigger = screen.getByLabelText('aiChat.ui.more: Team chat');
  expect(trigger.closest('details')).toHaveAttribute('open');
  expect(trigger).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'settings.2fa.disable' })).toHaveFocus();
  await user.tab();
  expect(trigger.closest('details')).not.toHaveAttribute('open');
});

it('opens settings from the header with keyboard activation', async () => {
  const user = userEvent.setup();
  const onOpenSettings = vi.fn();
  render(<ChatConversationView chat={chats[0]} messages={[]} onSendMessage={vi.fn()} onOpenSettings={onOpenSettings} />);
  const header = screen.getByRole('button', { name: 'aiChat.ui.chatSettings: Team chat' });
  expect(within(header).getByText('Team chat')).toBeInTheDocument();
  header.focus();
  await user.keyboard('{Enter} ');
  expect(onOpenSettings).toHaveBeenCalledTimes(2);
});

it('disables settings controls when no settings handler is supplied', () => {
  render(<ChatConversationView chat={chats[0]} messages={[]} onSendMessage={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'aiChat.ui.chatSettings: Team chat' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'aiChat.ui.chatSettings' })).toBeDisabled();
});
