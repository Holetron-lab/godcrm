import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from '@/tests/renderWithProviders';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { PinnedBanner } from '../PinnedBanner';
import { showToast } from '@/shared/hooks/useToast';
vi.mock('@/shared/hooks/useToast', () => ({ showToast: vi.fn() }));
const message = { id: 1, content: '**Важное** сообщение ' + 'длинный текст '.repeat(30) + 'конец', pinned_at: '2026-09-15', senderLabel: 'Автор' };
describe('PinnedBanner', () => {
  it('renders markdown without truncating source and forwards independently of jump', () => {
    const onJump = vi.fn(); const onForward = vi.fn(); const onUnpin = vi.fn();
    const { container } = render(<MemoryRouter><PinnedBanner open messages={[message]} onJump={onJump} onForward={onForward} onUnpin={onUnpin} /></MemoryRouter>);
    expect(container.querySelector('strong')).toHaveTextContent('Важное');
    expect(container.textContent).toContain('конец');
    fireEvent.click(screen.getByRole('button', { name: 'Переслать' }));
    expect(onForward).toHaveBeenCalledWith(1);
    expect(onJump).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Открепить' }));
    expect(onUnpin).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Перейти к сообщению от Автор' }));
    expect(onJump).toHaveBeenCalledWith(1);
  });
  it('copies the full source and reports clipboard failure', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<MemoryRouter><PinnedBanner open messages={[message]} onJump={vi.fn()} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Копировать' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(message.content));
    writeText.mockRejectedValueOnce(new Error('denied'));
    fireEvent.click(screen.getByRole('button', { name: 'Копировать' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Не удалось скопировать сообщение', 'error'));
  });
});
