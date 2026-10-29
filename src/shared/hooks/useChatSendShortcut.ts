import { useEffect, useState } from 'react';

export type ChatSendMode = 'enter' | 'shift-enter';
export type ChatDevice = 'desktop' | 'mobile';
type Preferences = Record<ChatDevice, ChatSendMode>;
const STORAGE_KEY = 'god-crm-chat-send-shortcut';
const CHANGE_EVENT = 'god-crm:chat-send-shortcut-changed';

function readPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      desktop: value?.desktop === 'enter' ? 'enter' : 'shift-enter',
      mobile: value?.mobile === 'enter' ? 'enter' : 'shift-enter',
    };
  } catch {
    return { desktop: 'shift-enter', mobile: 'shift-enter' };
  }
}

/** Same browser persistence and tab synchronization as the other CRM preferences. */
export function useChatSendShortcut() {
  const [preferences, setPreferences] = useState(readPreferences);
  const [error, setError] = useState(false);
  useEffect(() => {
    const sync = () => setPreferences(readPreferences());
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) sync();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);
  const setMode = (device: ChatDevice, mode: ChatSendMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readPreferences(), [device]: mode }));
      setError(false);
      window.dispatchEvent(new Event(CHANGE_EVENT));
    } catch {
      setError(true);
    }
  };
  return { preferences, setMode, error };
}

/** Read at keypress so resizing/rotating always uses the current site layout. */
export function getChatSendMode(preferences: Preferences): ChatSendMode {
  return preferences[window.innerWidth < 768 ? 'mobile' : 'desktop'];
}
