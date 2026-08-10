/**
 * PublicViewContext — read-only marker for public-surface render trees (ADR-0060 P5c).
 *
 * Anything mounted under <PublicViewProvider readOnly={true} ...> can opt-in to
 * `useIsPublicReadOnly()` and short-circuit mutations / hide edit affordances.
 * Mutation hooks (useRowMutations, useColumnMutations, useUpdateWidget, …)
 * consume this context as a belt-and-braces guard against UI-only readOnly hides.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';

export interface PublicViewState {
  readOnly: boolean;
  /** Public slug of the space we're rendered under, or null when not in a public route. */
  publicSlug: string | null;
}

const DEFAULT_STATE: PublicViewState = { readOnly: false, publicSlug: null };

const PublicViewContext = createContext<PublicViewState>(DEFAULT_STATE);

export function PublicViewProvider({
  readOnly,
  publicSlug,
  children,
}: {
  readOnly: boolean;
  publicSlug: string | null;
  children: ReactNode;
}) {
  return (
    <PublicViewContext.Provider value={{ readOnly, publicSlug }}>
      {children}
    </PublicViewContext.Provider>
  );
}

export function usePublicView(): PublicViewState {
  return useContext(PublicViewContext);
}

/** Convenience hook — true only inside a public read-only subtree. */
export function useIsPublicReadOnly(): boolean {
  return useContext(PublicViewContext).readOnly;
}

/**
 * Replace `mutate` / `mutateAsync` with no-op + warn when `readOnly` is true.
 * Belt-and-braces against UI-only hides: nothing reaches the API even if a
 * read-only button slips through.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function guardMutation<T extends UseMutationResult<any, any, any, any>>(
  mutation: T,
  readOnly: boolean,
  hookName: string,
): T {
  if (!readOnly) return mutation;
  const warn = () => {
    // eslint-disable-next-line no-console
    console.warn(`[publicView] mutation suppressed: ${hookName}`);
  };
  return {
    ...mutation,
    mutate: ((..._args: unknown[]) => {
      warn();
    }) as T['mutate'],
    mutateAsync: (async (..._args: unknown[]) => {
      warn();
      return undefined as never;
    }) as T['mutateAsync'],
  };
}
