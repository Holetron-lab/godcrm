import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForwardMessageModal } from '../ForwardMessageModal';
import { apiClient } from '@/shared/utils/apiClient';
import { showToast } from '@/shared/hooks/useToast';
import type { ChatMessage } from '../../../../types';

vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { post: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ showToast: vi.fn() }));
vi.mock('../shared/useChatPickerList', () => ({
  useChatPickerList: () => ({ search: '', setSearch: vi.fn(), filtered: [{ id: 42, title: 'Target chat' }], isLoading: false }),
}));

const voice = { id: 'voice-1', name: 'voice.webm', type: 'audio/webm', size: 1024, url: '/uploads/spaces/11/voice.webm' };
const file = { id: 'file-1', name: 'notes.pdf', type: 'application/pdf', size: 2048, url: '/uploads/spaces/11/notes.pdf' };
const message: ChatMessage = { id: '123', role: 'user', sender_name: 'GERATRON', content: '', timestamp: new Date('2026-09-17T07:00:00Z') };

beforeEach(() => { vi.clearAllMocks(); vi.mocked(apiClient.post).mockResolvedValue({}); });
afterEach(cleanup);

describe('forward message attachments', () => {
  it.each([[voice], [voice, file]])('preserves attachments for an audio-only message: %j', async (...attachments) => {
    const onClose = vi.fn();
    render(<ForwardMessageModal message={{ ...message, attachments }} currentConversationId={3660} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Target chat' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(apiClient.post).toHaveBeenCalledWith('/chat/conversations/42/messages', {
      content: expect.stringContaining('сообщение #123'), attachments,
    });
  });

  it('still forwards text without attachments', async () => {
    render(<ForwardMessageModal message={{ ...message, content: 'Hello' }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Target chat' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('aiChat.ui.messageForwarded', 'success'));
    expect(apiClient.post).toHaveBeenCalledWith('/chat/conversations/42/messages', expect.objectContaining({ content: expect.stringContaining('Hello') }));
  });

  it('keeps the modal open when forwarding fails', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('Offline'));
    const onClose = vi.fn();
    render(<ForwardMessageModal message={{ ...message, attachments: [voice] }} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Target chat' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('aiChat.ui.couldNotForwardMessage', 'error'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Target chat' })).not.toBeDisabled();
  });
});
