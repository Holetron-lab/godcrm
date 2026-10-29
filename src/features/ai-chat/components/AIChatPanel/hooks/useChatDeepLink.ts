import { useEffect, useRef } from 'react';
import type { ChatActions } from '../types';

// Kept outside the panel wiring to respect its repository file-size gate.
export function useChatDeepLink(
  openChat: () => void,
  selectConversation: (id: number) => Promise<{title?: string | null} | void>,
  setUserConversationId: (id: number) => void,
  actions: Pick<ChatActions, 'setChatMode' | 'setChatPartner' | 'setActivePanel' | 'setLocalError'>,
) {
  const openedLink = useRef(false);
  useEffect(() => {
    if (openedLink.current) return;
    const raw = new URLSearchParams(window.location.search).get('chat');
    const id = Number(raw);
    if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(id) || id < 1) return;
    openedLink.current = true;
    openChat();
    actions.setActivePanel('none');
    void selectConversation(id).then(conversation => {
      if (!conversation) return;
      setUserConversationId(id);
      actions.setChatMode('people');
      actions.setChatPartner({type:'group',id,name:conversation.title || `#${id}`});
      actions.setActivePanel('none');
    }).catch(error => actions.setLocalError(error instanceof Error ? error.message : String(error)));
  }, [openChat, selectConversation, setUserConversationId, actions]);
}
