import { useEffect } from 'react';

/**
 * ADR-158 — Gmail-style keyboard shortcuts for the mail shell. Single-use, so it
 * lives with the feature rather than in shared/ (Ponytail). Handlers are optional;
 * a key is a no-op when its handler is absent or returns without a selection.
 *
 * Ignores keystrokes while the user is typing in an input/textarea/contenteditable
 * (or with a modifier held) so it never hijacks compose or search.
 *
 *   c        compose            /        focus search
 *   r        reply              f        forward
 *   j        next message       k        previous message
 *   u / Esc  back to list (deselect)
 *
 * Reply-all (`a`) and archive (`e`) are intentionally unbound until their backend
 * mutations land — binding a key to a disabled action reads as broken.
 */
export interface MailHotkeyHandlers {
  onCompose?: () => void;
  onSearch?: () => void;
  onReply?: () => void;
  onForward?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onBack?: () => void;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function useMailHotkeys(handlers: MailHotkeyHandlers, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      // Esc always returns to the list, even from a focused field (Gmail parity).
      if (e.key === 'Escape') {
        handlers.onBack?.();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;

      const run = (fn?: () => void) => {
        if (!fn) return;
        e.preventDefault();
        fn();
      };

      switch (e.key) {
        case 'c':
          return run(handlers.onCompose);
        case '/':
          return run(handlers.onSearch);
        case 'r':
          return run(handlers.onReply);
        case 'f':
          return run(handlers.onForward);
        case 'j':
          return run(handlers.onNext);
        case 'k':
          return run(handlers.onPrev);
        case 'u':
          return run(handlers.onBack);
        default:
          return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers, enabled]);
}
