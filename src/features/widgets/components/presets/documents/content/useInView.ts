/**
 * ADR-0005 C-2 — minimal `useInView` hook for lazy-mounting widget-atoms
 * inside document pages.
 *
 * Design notes:
 * - One-shot: once `isInView` flips to `true`, we disconnect the observer
 *   and the value stays `true` forever. This is intentional — we never
 *   unmount widget-atoms after they've rendered (avoids losing internal
 *   state like scroll position, expanded rows, in-flight queries).
 * - rootMargin lets us mount slightly before the element scrolls into the
 *   viewport so the user doesn't catch a skeleton flash.
 * - SSR / no-IO: if `IntersectionObserver` is unavailable we degrade to
 *   eager rendering (returning `true` immediately).
 * - Reduced motion / print: callers can pass `enabled={false}` to bypass
 *   the observer entirely (see DocumentWidgetItem).
 */

import { useEffect, useRef, useState } from 'react';

interface UseInViewOptions {
  /** IntersectionObserver rootMargin (default: '200px 0px'). */
  rootMargin?: string;
  /** When false, returns true immediately (eager render). */
  enabled?: boolean;
}

export function useInView<T extends Element = HTMLDivElement>(
  options: UseInViewOptions = {},
): { ref: React.MutableRefObject<T | null>; isInView: boolean } {
  const { rootMargin = '200px 0px', enabled = true } = options;
  const ref = useRef<T | null>(null);
  const [isInView, setIsInView] = useState<boolean>(!enabled);

  useEffect(() => {
    if (!enabled) {
      setIsInView(true);
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      setIsInView(true);
      return;
    }
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsInView(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, rootMargin]);

  return { ref, isInView };
}

/**
 * Detect environments where lazy-mount should be bypassed:
 *   - print preview (CSS will collapse all content into a paginated layout)
 *   - user prefers reduced motion (loading flickers are jarring)
 *
 * SSR-safe: returns false when `window` is unavailable.
 */
export function shouldEagerRenderWidgets(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    if (window.matchMedia('print').matches) return true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  } catch {
    // Some test environments stub matchMedia incompletely — fall back to
    // lazy mount in that case.
    return false;
  }
  return false;
}
