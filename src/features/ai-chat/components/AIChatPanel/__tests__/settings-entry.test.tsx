import { createContext, useState } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { AIChatPanel } from '../AIChatPanel';

const state = vi.hoisted(() => ({ conversationId: 44 as number | null, isWideMode: false, isMobile: false }));
vi.mock('../hooks/useAIChatPanelLogic', () => ({ useAIChatPanelLogic: () => {
  const [activePanel, setActivePanel] = useState('none');
  return ({
  isWideMode: state.isWideMode, isMobile: state.isMobile, panelMode: 'default',
  isOpen: true, currentConversationId: null, userConversationId: state.conversationId,
  currentUser: { id: 1 }, chatPartner: { type: 'group', id: state.conversationId },
  activePanel, setActivePanel, renderPanelContent: () => <div>Panel settings</div>, agents: [], users: [], displayMessages: [], messages: [],
  boundRows: [], chatParticipants: [], availableMentionUsers: [], availableSlashAgents: [], searchMatchIds: [],
  mutations: {}, events: {}, resize: { togglePanel: setActivePanel }, scheduled: {}, voiceNote: {},
  attachments: [], forwardMessages: [], moveMessages: [],
  conversationSpace: { conversation: { id: state.conversationId, space_id: 11 }, openSettings: vi.fn() },
}); } }));
vi.mock('../../../context/AIChatContext', () => ({ useAIChat: () => ({ mentionAgents: [] }) }));
vi.mock('../../../hooks/usePinMessage', () => ({ usePinMessage: () => ({}) }));
vi.mock('../../../hooks/useHumanChatPresence', () => ({
  HumanChatPresenceContext: createContext({}), useHumanChatPresence: () => ({}),
}));
vi.mock('../../../context/ValidSlugsContext', () => ({ ValidSlugsProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../../MentionUsersContext', () => ({ MentionUsersProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/features/chat/call/CallBar', () => ({ CallBar: () => null }));
vi.mock('@/features/chat/call/callStore', () => ({ useCallStore: () => false }));
vi.mock('../components/ChatHeader/ChatHeaderFull', () => ({ ChatPanelToolbar: ({ togglePanel }: { togglePanel: (panel: 'settings') => void }) => <button onClick={() => togglePanel('settings')}>Panel preferences</button>, ChatInfoBar: () => null }));
vi.mock('../components/BoundRowsStrip', () => ({ BoundRowsStrip: () => null }));
vi.mock('../components/MessagesArea', () => ({ MessagesArea: () => null }));
vi.mock('../components/InputArea', () => ({ InputArea: () => <input aria-label="Draft" defaultValue="Keep draft" /> }));
vi.mock('../../PinnedBanner', () => ({ PinnedBanner: () => null }));
vi.mock('@/features/terminal', () => ({ TerminalPanel: () => null }));
vi.mock('@/features/spaces/hooks/useSpacesQuery', () => ({ useSpacesQuery: () => ({ data: [{ id: 11, name: 'Development' }] }) }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn().mockResolvedValue({ data: { prefs: null, participants: [] } }) } }));
vi.mock('../../ParticipantSelector', () => ({ ParticipantSelector: () => null }));

it.each([[false, false], [true, false], [false, true]])('opens inline settings (wide=%s, mobile=%s) and preserves the draft on navigation', async (isWideMode, isMobile) => {
  state.conversationId = 44;
  state.isWideMode = isWideMode;
  state.isMobile = isMobile;
  const { rerender } = renderWithProviders(<AIChatPanel fillContainer />);
  fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Настройки чата' }));
  expect(await screen.findByRole('region', { name: 'Настройки чата' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Настройки чата' })).toHaveFocus();
  expect(await screen.findByText('Development #11')).toBeInTheDocument();
  state.conversationId = 45;
  rerender(<AIChatPanel fillContainer />);
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Настройки чата' })).not.toBeInTheDocument());
  expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Keep draft');
  fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Участники' }));
  expect(await screen.findByRole('region', { name: 'Настройки чата' })).toBeInTheDocument();
  expect(screen.queryByText('Space чата')).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('region', { name: 'Настройки чата' }), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Настройки чата' })).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Ещё' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Настройки чата' }));
  await screen.findByText('Development #11');
  fireEvent.click(screen.getByRole('button', { name: 'Panel preferences' }));
  expect(screen.queryByRole('region', { name: 'Настройки чата' })).not.toBeInTheDocument();
  expect(screen.getByText('Panel settings')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Настройки чата' }));
  await screen.findByText('Development #11');
  fireEvent.click(within(screen.getByRole('region', { name: 'Настройки чата' })).getByRole('button', { name: 'Закрыть' }));
  expect(screen.queryByRole('region', { name: 'Настройки чата' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ещё' })).toHaveFocus();
  state.conversationId = null;
  rerender(<AIChatPanel fillContainer />);
  fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));
  expect(screen.getByRole('menuitem', { name: 'Настройки чата' })).toBeDisabled();
});
