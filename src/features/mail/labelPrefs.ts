// ADR-158 §P4 — client-side "colorize row" preference, per label id.
//
// A label's colour is server-persisted (mail_labels.color); whether to tint the
// message-list rows that carry it is a per-browser *view* choice, so it lives in
// localStorage (same pattern as `settings.ts` / `library.ts`) and needs no
// backend column. Synced across the manager (writer) and the list (reader) via a
// window event, so toggling in Settings repaints the list immediately.

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'mail.labelColorize';
const CHANGE_EVENT = 'mail-label-colorize-changed';

function load(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

function save(ids: number[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable — stays in-memory this session */
  }
}

/**
 * Read + toggle the set of label ids whose colour tints their message rows.
 * Stays in sync across every component using the hook via a window event.
 */
export function useMailLabelColorize() {
  const [ids, setIds] = useState<number[]>(load);

  useEffect(() => {
    const sync = () => setIds(load());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync); // other tabs
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const setColorize = useCallback((id: number, on: boolean) => {
    setIds((prev) => {
      const has = prev.includes(id);
      if (on === has) return prev;
      const next = on ? [...prev, id] : prev.filter((x) => x !== id);
      save(next);
      window.dispatchEvent(new Event(CHANGE_EVENT));
      return next;
    });
  }, []);

  return { colorizeIds: new Set(ids), setColorize };
}
