import { useEffect, useRef, useCallback } from 'react';

interface UseInfiniteScrollOptions {
  /** Whether more data is available */
  hasNextPage: boolean;
  /** Whether a page is currently being fetched */
  isFetchingNextPage: boolean;
  /** Function to fetch the next page */
  fetchNextPage: () => void;
  /** IntersectionObserver rootMargin (default: '400px') */
  rootMargin?: string;
  /** Whether the hook is enabled (default: true) */
  enabled?: boolean;
}

/**
 * Shared infinite scroll hook using IntersectionObserver.
 * Attach `sentinelRef` to a div at the bottom of your list.
 */
export function useInfiniteScroll({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  rootMargin = '400px',
  enabled = true,
}: UseInfiniteScrollOptions) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage]
  );

  useEffect(() => {
    if (!enabled || !sentinelRef.current) return;

    const observer = new IntersectionObserver(handleIntersect, {
      rootMargin,
    });

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [handleIntersect, rootMargin, enabled]);

  return { sentinelRef };
}
