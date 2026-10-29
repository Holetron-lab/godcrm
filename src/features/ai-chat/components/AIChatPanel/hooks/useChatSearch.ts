import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import type { ChatMessage } from '../../../types';

/** Search navigation and highlighting for the currently displayed conversation. */
export function useChatSearch(displayMessages: ChatMessage[], messagesContainerRef: RefObject<HTMLDivElement>) {
  const [chatSearchActive, setChatSearchActive] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [chatSearchCurrentMatch, setChatSearchCurrentMatch] = useState(0);

  const searchMatchIds = useMemo(() => {
    if (!chatSearchQuery || !chatSearchActive) return [];
    const q = chatSearchQuery.toLowerCase();
    const ids: string[] = [];
    displayMessages.forEach((msg: ChatMessage) => {
      const text = (msg.content || '').toLowerCase();
      if (text.includes(q) && msg.id) ids.push(msg.id);
    });
    return ids;
  }, [chatSearchQuery, chatSearchActive, displayMessages]);

  const handleSearchNext = useCallback(() => {
    if (searchMatchIds.length === 0) return;
    setChatSearchCurrentMatch(prev => (prev + 1) % searchMatchIds.length);
  }, [searchMatchIds.length]);

  const handleSearchPrev = useCallback(() => {
    if (searchMatchIds.length === 0) return;
    setChatSearchCurrentMatch(prev => (prev - 1 + searchMatchIds.length) % searchMatchIds.length);
  }, [searchMatchIds.length]);

  // Scroll to current search match
  useEffect(() => {
    if (searchMatchIds.length === 0 || !messagesContainerRef.current) return;
    const msgId = searchMatchIds[chatSearchCurrentMatch];
    const msgEl = messagesContainerRef.current.querySelector(`[data-message-id="${msgId}"]`);
    if (msgEl) {
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      msgEl.classList.add('search-highlight');
      setTimeout(() => msgEl.classList.remove('search-highlight'), 2000);
    }
  }, [chatSearchCurrentMatch, searchMatchIds, messagesContainerRef]);

  return {
    chatSearchActive, setChatSearchActive, chatSearchQuery, setChatSearchQuery,
    chatSearchCurrentMatch, setChatSearchCurrentMatch, searchMatchIds, handleSearchNext, handleSearchPrev,
  };
}
