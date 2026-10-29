// ADR-158 — client-side mail preferences (Gmail-style Settings).
//
// These are view/interaction preferences with no backend counterpart yet, so they
// live in localStorage keyed per browser (same pattern as `mail.customTypes`). The
// Settings modal edits them; MailPage owns the state and prop-drills the slices
// each pane needs. Kept intentionally small — only settings that actually drive
// behaviour today are here; the rest of Gmail's settings surface is a backend
// follow-up and is not stubbed as dead toggles (Ponytail).

import { isOutgoingFolder, type MailFolderId } from './types';

/** Logical "kind" of a message, derived from its folder — drives the list indicator. */
export type MailMessageType = 'incoming' | 'outgoing' | 'archive';

export interface MailTypeColors {
  incoming: string;
  outgoing: string;
  archive: string;
}

export interface MailSettings {
  /** Show the per-row quick actions (reply/forward/…) on hover/focus. */
  hoverActions: boolean;
  /** Show the 3-line body snippet under each subject in the list. */
  showSnippets: boolean;
  /** Enable Gmail-style keyboard shortcuts (c / r / f / j / k / u). */
  hotkeys: boolean;
  /** Show the colored type indicator under each list checkbox. */
  typeIndicators: boolean;
  /** Per-type indicator colors (any CSS color). */
  typeColors: MailTypeColors;
  /**
   * Reading-pane body surface. Mail HTML is authored for a white page, so `light`
   * renders it on one regardless of the app theme; `dark` forces a dark surface and
   * neutralises the message's own colors so it stays readable. Toggled from the
   * read toolbar, persisted like every other mail preference.
   */
  bodyTheme: MailBodyTheme;
  /** Group the list into conversation threads (rail toggle under Мультивыбор). */
  threads: boolean;
}

export type MailBodyTheme = 'light' | 'dark';

export const DEFAULT_MAIL_SETTINGS: MailSettings = {
  hoverActions: true,
  showSnippets: true,
  hotkeys: true,
  typeIndicators: true,
  bodyTheme: 'light',
  threads: false,
  typeColors: {
    incoming: '#22c55e', // green — received
    outgoing: '#3b82f6', // blue — sent/drafts
    archive: '#f59e0b', // amber — archived
  },
};

const STORAGE_KEY = 'mail.settings';

/** Classify a message by folder for the list indicator. */
export function messageType(folder: MailFolderId): MailMessageType {
  if (folder === 'archive') return 'archive';
  if (isOutgoingFolder(folder)) return 'outgoing';
  return 'incoming';
}

/** Read settings from localStorage, merged over defaults so new keys stay populated. */
export function loadMailSettings(): MailSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_MAIL_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<MailSettings>;
    return {
      ...DEFAULT_MAIL_SETTINGS,
      ...parsed,
      typeColors: { ...DEFAULT_MAIL_SETTINGS.typeColors, ...(parsed.typeColors ?? {}) },
    };
  } catch {
    return DEFAULT_MAIL_SETTINGS;
  }
}

export function saveMailSettings(settings: MailSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable — settings stay in-memory this session */
  }
}
