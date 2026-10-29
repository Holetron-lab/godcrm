import { useEffect, useRef } from 'react';

/** Focus an editor only when its open state or edited item changes. */
export function useRequestedFocus<T extends HTMLElement>(request: string | number | boolean | null) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (request !== null && request !== false) ref.current?.focus({ preventScroll: true });
  }, [request]);
  return ref;
}
