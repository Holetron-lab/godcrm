import { useEffect, useState } from 'react';

export type ChatInputMode = 'shared' | 'per-chat';
const STORAGE_KEY = 'god-crm-chat-input-mode';
const CHANGE_EVENT = 'god-crm:chat-input-mode-changed';

function readMode(): ChatInputMode {
  try { return localStorage.getItem(STORAGE_KEY) === 'per-chat' ? 'per-chat' : 'shared'; }
  catch { return 'shared'; }
}

/** Browser preference, synchronized like the adjacent send-shortcut setting. */
export function useChatInputMode() {
  const [mode, setCurrentMode] = useState(readMode);
  const [error, setError] = useState(false);
  useEffect(() => {
    const sync = () => setCurrentMode(readMode());
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
  const setMode = (value: ChatInputMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, value);
      setError(false);
      window.dispatchEvent(new Event(CHANGE_EVENT));
    } catch { setError(true); }
  };
  return { mode, setMode, error };
}
