import { useEffect, useState } from 'react';

/**
 * Persisted preference: should the sidebar (menu) be shown or hidden by
 * default on desktop when the app first loads (new device / cleared cache)?
 * Mobile always starts collapsed regardless of this setting.
 *
 * Mirrors `useHeaderLanguageSwitcher` — localStorage-backed, cross-tab and
 * same-tab sync via a custom event.
 */
export type SidebarDefault = 'show' | 'hide';

const STORAGE_KEY = 'god-crm-sidebar-default';
const CHANGE_EVENT = 'god-crm:sidebar-default-changed';

export const readSidebarDefault = (): SidebarDefault => {
  if (typeof window === 'undefined') return 'show';
  return window.localStorage.getItem(STORAGE_KEY) === 'hide' ? 'hide' : 'show';
};

export function useSidebarDefault(): [SidebarDefault, (next: SidebarDefault) => void] {
  const [value, setValue] = useState<SidebarDefault>(readSidebarDefault);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setValue(readSidebarDefault());
    };
    const onLocal = () => setValue(readSidebarDefault());
    window.addEventListener('storage', onStorage);
    window.addEventListener(CHANGE_EVENT, onLocal);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CHANGE_EVENT, onLocal);
    };
  }, []);

  const set = (next: SidebarDefault) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, next);
    setValue(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  return [value, set];
}
