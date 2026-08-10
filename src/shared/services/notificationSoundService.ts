// notificationSoundService.ts — ADR-0064 WP-B.
//
// Single shared HTMLAudioElement per asset. 2-second debounce per sender slug
// to prevent audio fatigue during agent runs (ADR §Decision §Debounce).
//
// The first call may be silently blocked by the browser's autoplay policy
// until a user gesture occurs. Opening the chat counts as a gesture, but a
// "Test sound" button in Personal/Notifications gives users an explicit
// unlock path (see WP-C).
//
// Asset-kind→file mapping (ADR-0064 + asset commit bcf95d97):
//   'human'   → dm.mp3        (warmer tone for DMs and human senders)
//   'agent'   → message.mp3   (neutral tone for agent chatter)
//   'mention' → mention.mp3   (reserved — not yet wired to resolver shape)

export type NotificationSoundKind = 'human' | 'agent' | 'mention';

const ASSETS: Record<NotificationSoundKind, string> = {
  human: '/sounds/notifications/dm.mp3',
  agent: '/sounds/notifications/message.mp3',
  mention: '/sounds/notifications/mention.mp3',
};

const DEBOUNCE_MS = 2_000;

const audioCache = new Map<NotificationSoundKind, HTMLAudioElement>();
const lastPlayedAtBySender = new Map<string, number>();

function getAudio(kind: NotificationSoundKind): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  let el = audioCache.get(kind);
  if (!el) {
    el = new Audio(ASSETS[kind]);
    el.preload = 'auto';
    audioCache.set(kind, el);
  }
  return el;
}

export interface PlayOptions {
  /** Sender slug for debouncing — typically `${sender_type}:${sender_id}`. */
  senderSlug: string;
  /** 0..1. Falls back to the cached value if omitted. */
  volume?: number;
  /** Bypass the 2s per-sender debounce — used by the "Test sound" button. */
  force?: boolean;
}

/**
 * Play a notification sound. Returns true if a sound was actually triggered
 * (false on debounce-suppress, autoplay block, or SSR).
 */
export function playNotificationSound(
  kind: NotificationSoundKind,
  opts: PlayOptions,
): boolean {
  const audio = getAudio(kind);
  if (!audio) return false;

  const now = Date.now();
  if (!opts.force) {
    const last = lastPlayedAtBySender.get(opts.senderSlug) ?? 0;
    if (now - last < DEBOUNCE_MS) return false;
  }
  lastPlayedAtBySender.set(opts.senderSlug, now);

  if (typeof opts.volume === 'number') {
    audio.volume = Math.max(0, Math.min(1, opts.volume));
  }

  try {
    audio.currentTime = 0;
    const result = audio.play();
    if (result && typeof result.catch === 'function') {
      result.catch(() => {
        // Autoplay blocked or asset missing — silent failure is acceptable.
      });
    }
    return true;
  } catch {
    return false;
  }
}

/** Test-only / autoplay-unlock helper. */
export function resetDebounce(): void {
  lastPlayedAtBySender.clear();
}
