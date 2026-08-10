/**
 * useHideSystemEvents — per-conversation toggle for hiding `row_mutation`
 * system bubbles (ADR-0031 P2). Stored in localStorage under
 * `aiChat.hideSystemEvents.<conversationId>`. Cross-component sync via a
 * custom window event so the SettingsPanel toggle and the message list see
 * the same value without prop drilling.
 */
import { useCallback, useEffect, useState } from 'react';

const STORAGE_PREFIX = 'aiChat.hideSystemEvents.';
const CHANGE_EVENT = 'aiChat:hideSystemEventsChanged';

type ChangeDetail = { key: string; value: boolean };

const storageKey = (id: number | string | null | undefined): string | null =>
  id == null || id === '' ? null : `${STORAGE_PREFIX}${id}`;

const readBool = (key: string | null): boolean => {
  if (!key) return false;
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

export function useHideSystemEvents(
  conversationId: number | string | null | undefined,
): [boolean, (next: boolean) => void] {
  const key = storageKey(conversationId);
  const [hidden, setHidden] = useState<boolean>(() => readBool(key));

  useEffect(() => {
    setHidden(readBool(key));
    if (!key) return;

    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<ChangeDetail>).detail;
      if (detail?.key === key) setHidden(detail.value);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) setHidden(e.newValue === '1');
    };

    window.addEventListener(CHANGE_EVENT, onChange as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, [key]);

  const set = useCallback(
    (next: boolean) => {
      if (!key) return;
      try {
        if (next) localStorage.setItem(key, '1');
        else localStorage.removeItem(key);
      } catch {
        /* quota exceeded / disabled — fall through, in-memory still works */
      }
      window.dispatchEvent(
        new CustomEvent<ChangeDetail>(CHANGE_EVENT, {
          detail: { key, value: next },
        }),
      );
      setHidden(next);
    },
    [key],
  );

  return [hidden, set];
}
