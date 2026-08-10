import { useEffect, useState } from 'react';

const STORAGE_KEY = 'god-crm-header-language-switcher';

const read = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(STORAGE_KEY) === 'true';
};

export function useHeaderLanguageSwitcher(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(read);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setEnabled(read());
    };
    const onLocal = () => setEnabled(read());
    window.addEventListener('storage', onStorage);
    window.addEventListener('god-crm:header-language-switcher-changed', onLocal);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('god-crm:header-language-switcher-changed', onLocal);
    };
  }, []);

  const set = (next: boolean) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false');
    setEnabled(next);
    window.dispatchEvent(new Event('god-crm:header-language-switcher-changed'));
  };

  return [enabled, set];
}
