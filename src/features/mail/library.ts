// ADR-158 — client-side mail "library": reusable signatures + templates.
//
// Same rationale as `settings.ts`: these have no backend counterpart yet, so they
// live in localStorage keyed per browser. A default signature is auto-appended to
// new compositions; templates seed subject + body on demand. Bodies are stored as
// plain text (with line breaks) and escaped → HTML at insert time, so a signature
// can't inject markup into the composed message (Ponytail: lazy ≠ negligent).
//
// Kept self-contained (a hook that syncs via a window event) so the composer and
// the Settings surface stay in sync without threading state through MailPage.

import { useCallback, useEffect, useState } from 'react';

export interface MailSignature {
  id: string;
  name: string;
  /** Optional emoji shown beside the name in the picker menus. */
  icon?: string;
  /** Plain text; line breaks preserved. Converted to escaped HTML on insert. */
  text: string;
}

export interface MailTemplate {
  id: string;
  name: string;
  /** Optional emoji shown beside the name in the picker menus. */
  icon?: string;
  subject: string;
  /** Plain text body; same text→HTML conversion on insert as signatures. */
  body: string;
}

export interface MailLibrary {
  signatures: MailSignature[];
  /** Auto-appended to new compositions; null = no default. */
  defaultSignatureId: string | null;
  templates: MailTemplate[];
}

export const EMPTY_LIBRARY: MailLibrary = {
  signatures: [],
  defaultSignatureId: null,
  templates: [],
};

const STORAGE_KEY = 'mail.library';
const CHANGE_EVENT = 'mail-library-changed';

/** Short, collision-safe id (crypto where available, else time+counter). */
let seq = 0;
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${(seq++).toString(36)}`;
}

export function loadLibrary(): MailLibrary {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_LIBRARY;
    const parsed = JSON.parse(raw) as Partial<MailLibrary>;
    return {
      signatures: Array.isArray(parsed.signatures) ? parsed.signatures : [],
      defaultSignatureId: parsed.defaultSignatureId ?? null,
      templates: Array.isArray(parsed.templates) ? parsed.templates : [],
    };
  } catch {
    return EMPTY_LIBRARY;
  }
}

function saveLibrary(lib: MailLibrary): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
  } catch {
    /* storage unavailable — stays in-memory this session */
  }
}

/** The default signature object, or null if none / not set. */
export function defaultSignature(lib: MailLibrary): MailSignature | null {
  if (!lib.defaultSignatureId) return null;
  return lib.signatures.find((s) => s.id === lib.defaultSignatureId) ?? null;
}

/**
 * Read + mutate the library, staying in sync across every component that uses the
 * hook (composer, Settings) via a window event — no prop drilling through MailPage.
 */
export function useMailLibrary() {
  const [library, setLibrary] = useState<MailLibrary>(loadLibrary);

  useEffect(() => {
    const sync = () => setLibrary(loadLibrary());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync); // other tabs
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const update = useCallback((next: MailLibrary) => {
    saveLibrary(next);
    setLibrary(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { library, update };
}
