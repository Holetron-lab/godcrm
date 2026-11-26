import { useCallback, type RefObject } from 'react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { showToast } from '@/shared/hooks/useToast';

// 20 pages × 50 messages: deep enough for a pin from months ago, bounded so a
// stale id cannot walk the entire history into the DOM.
const MAX_PAGES = 20;

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/**
 * Scroll to a message by id. A pinned message can be older than the loaded
 * history pages, so when it is not rendered yet the history is paged backwards
 * until it is.
 */
export function useJumpToMessage(
  containerRef: RefObject<HTMLElement | null>,
  fetchOlderPage: () => Promise<{ hasNextPage: boolean }>,
) {
  const { t } = useLanguage();
  return useCallback(async (messageId: number | string) => {
    const find = () => containerRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(String(messageId))}"]`);
    // History is paged by descending id, so only a message older than
    // everything rendered can be waiting on a page that is not loaded yet.
    const isOlderThanLoaded = () => {
      const rendered = Array.from(containerRef.current?.querySelectorAll('[data-message-id]') ?? [])
        .map(node => Number(node.getAttribute('data-message-id')))
        .filter(Number.isFinite);
      return Number(messageId) < Math.min(...rendered);
    };
    let el = find();
    for (let page = 0; !el && page < MAX_PAGES && isOlderThanLoaded(); page++) {
      const { hasNextPage } = await fetchOlderPage();
      await nextFrame(); // the fetched page renders after the query settles
      el = find();
      if (!hasNextPage) break;
    }
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else showToast(t('aiChat.ui.messageNotFoundInHistory'), 'info');
  }, [containerRef, fetchOlderPage, t]);
}
