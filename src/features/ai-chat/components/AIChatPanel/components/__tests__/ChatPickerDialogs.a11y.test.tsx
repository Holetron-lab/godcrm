import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ForwardMessageModal } from '../ForwardMessageModal';
import { MoveMessageModal } from '../MoveMessageModal';
import type { ChatMessage } from '../../../../types';

vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { post: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('../shared/useChatPickerList', () => ({
  useChatPickerList: () => ({ search: '', setSearch: vi.fn(), filtered: [{ id: 42, title: 'Target chat' }], isLoading: false }),
}));
const message: ChatMessage = { id: '123', role: 'user', content: 'Hello', timestamp: new Date('2026-09-20T08:00:00Z') };

function Harness({ kind }: { kind: 'forward' | 'move' }) {
  const [open, setOpen] = useState(false);
  const Picker = kind === 'forward' ? ForwardMessageModal : MoveMessageModal;
  return <>
    <button onClick={() => setOpen(true)}>Open picker</button>
    {open && <Picker message={message} currentConversationId={3660} onClose={() => setOpen(false)} />}
    <button>Outside</button>
  </>;
}

it.each(['forward', 'move'] as const)('%s dialog contains keyboard focus, closes with Escape and restores focus', async kind => {
  const user = userEvent.setup();
  render(<Harness kind={kind} />);
  const opener = screen.getByRole('button', { name: 'Open picker' });
  await user.click(opener);
  const dialog = screen.getByRole('dialog', { name: kind === 'forward' ? 'aiChat.ui.chooseAChatToForwardTo' : 'aiChat.ui.moveToChat' });
  expect(screen.getByRole('textbox', { name: 'aiChat.ui.searchChatsLabel' })).toHaveFocus();
  for (let i = 0; i < 5; i++) {
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  }
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(opener).toHaveFocus());
});
