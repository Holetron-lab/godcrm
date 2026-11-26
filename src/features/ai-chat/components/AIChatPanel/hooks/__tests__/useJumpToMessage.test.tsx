import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProvidersWrapper } from '@/tests/renderWithProviders';
import { showToast } from '@/shared/hooks/useToast';
import { useJumpToMessage } from '../useJumpToMessage';

vi.mock('@/shared/hooks/useToast', () => ({ showToast: vi.fn() }));

const addMessage = (container: HTMLElement, id: number) => {
  const el = document.createElement('div');
  el.setAttribute('data-message-id', String(id));
  el.scrollIntoView = vi.fn();
  container.prepend(el);
  return el;
};

describe('useJumpToMessage', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div');
    vi.mocked(showToast).mockReset();
  });
  const jumpWith = (fetchOlderPage: () => Promise<{ hasNextPage: boolean }>) =>
    renderHook(() => useJumpToMessage({ current: container }, fetchOlderPage), { wrapper: ProvidersWrapper }).result.current;

  it('scrolls straight to a message that is already rendered', async () => {
    const target = addMessage(container, 5);
    const fetchOlderPage = vi.fn();

    await jumpWith(fetchOlderPage)(5);

    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(fetchOlderPage).not.toHaveBeenCalled();
  });

  it('pages history backwards until the message is rendered', async () => {
    let target: HTMLElement | undefined;
    const fetchOlderPage = vi.fn()
      .mockImplementationOnce(async () => { addMessage(container, 40); return { hasNextPage: true }; })
      .mockImplementationOnce(async () => { target = addMessage(container, 5); return { hasNextPage: true }; });

    await jumpWith(fetchOlderPage)(5);

    expect(fetchOlderPage).toHaveBeenCalledTimes(2);
    expect(target?.scrollIntoView).toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('does not page history for a message inside the loaded range that has no element of its own', async () => {
    addMessage(container, 40);
    addMessage(container, 3);
    const fetchOlderPage = vi.fn();

    await jumpWith(fetchOlderPage)(5);

    expect(fetchOlderPage).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('Не удалось найти сообщение в истории чата', 'info');
  });

  it('says so instead of failing silently when the whole history does not contain the message', async () => {
    const fetchOlderPage = vi.fn().mockResolvedValue({ hasNextPage: false });

    await jumpWith(fetchOlderPage)(5);

    expect(fetchOlderPage).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('Не удалось найти сообщение в истории чата', 'info');
  });
});
