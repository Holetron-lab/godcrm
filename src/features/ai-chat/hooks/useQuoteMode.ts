/**
 * useQuoteMode — quote-selection state machine for ADR-0068 WP-C.
 *
 * Owns the "user is selecting text inside this specific message to quote it"
 * lifecycle: arm a message → track selection → confirm or cancel.
 *
 * Why a hook: keeps ChatMessageList under the 800-line gate AND isolates the
 * three concerns (state, document listeners, confirm-with-range) that
 * otherwise sprawl across three useEffects in the parent.
 *
 * Confirm semantics: computes a char-offset range against the *original*
 * content string. Markdown rendering may rewrite the DOM, so DOM-Range offsets
 * are unreliable — we fall back to `indexOf` on raw content. If the fragment
 * isn't found (whitespace collapsed, link rewrites, etc.) we emit `fragment`
 * without `range`; the server accepts that shape.
 */

import { useState, useEffect, useCallback } from 'react';
import type { ChatMessageItem } from '../components/ChatConversationView';

export interface UseQuoteModeOptions {
  onReply: (
    message: ChatMessageItem,
    quote?: { fragment: string; range?: [number, number] },
  ) => void;
  resetKey: string | number;
}

export interface UseQuoteModeReturn {
  quoteFor: ChatMessageItem | null;
  setQuoteFor: (m: ChatMessageItem | null) => void;
  quoteFragment: string;
  handleQuoteConfirm: () => void;
}

export function useQuoteMode({ onReply, resetKey }: UseQuoteModeOptions): UseQuoteModeReturn {
  const [quoteFor, setQuoteFor] = useState<ChatMessageItem | null>(null);
  const [quoteFragment, setQuoteFragment] = useState('');

  // Reset on chat switch — parent passes chat.id as resetKey.
  useEffect(() => {
    setQuoteFor(null);
    setQuoteFragment('');
  }, [resetKey]);

  // Track selection while quote-mode is active. Esc cancels.
  useEffect(() => {
    if (!quoteFor) return;
    const handleSelection = () => {
      const sel = typeof window !== 'undefined' ? window.getSelection() : null;
      setQuoteFragment(sel ? sel.toString() : '');
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setQuoteFor(null);
        setQuoteFragment('');
        window.getSelection()?.removeAllRanges();
      }
    };
    document.addEventListener('selectionchange', handleSelection);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('selectionchange', handleSelection);
      document.removeEventListener('keydown', handleKey);
    };
  }, [quoteFor]);

  const handleQuoteConfirm = useCallback(() => {
    if (!quoteFor) return;
    const fragment = quoteFragment.trim();
    if (!fragment) return;
    const idx = quoteFor.content.indexOf(fragment);
    const range: [number, number] | undefined =
      idx >= 0 ? [idx, idx + fragment.length] : undefined;
    onReply(quoteFor, { fragment, range });
    setQuoteFor(null);
    setQuoteFragment('');
    window.getSelection()?.removeAllRanges();
  }, [onReply, quoteFor, quoteFragment]);

  return { quoteFor, setQuoteFor, quoteFragment, handleQuoteConfirm };
}
