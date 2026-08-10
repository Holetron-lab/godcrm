/**
 * MentionTooltip — hover card for @slug and /slug mentions
 * Shows agent/user info: name, role/type, avatar, status
 *
 * Rendered via portal at document.body with position:fixed so it escapes
 * any overflow:hidden ancestor (chat bubble, scroll container).
 * Auto-hides on scroll/resize so the card doesn't drift away from the
 * trigger or cover content (esp. on mobile).
 */

import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/shared/utils/cn';
import { useMentionUsers } from './MentionUsersContext';

interface MentionTooltipProps {
  slug: string;
  children: React.ReactNode;
}

const CARD_WIDTH = 224; // 14rem (w-56)
const CARD_GAP = 8;
const VIEWPORT_PAD = 8;

export const MentionTooltip: React.FC<MentionTooltipProps> = ({ slug, children }) => {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; placement: 'top' | 'bottom' } | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const { getBySlug } = useMentionUsers();

  const info = getBySlug(slug);

  const computeCoords = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return null;
    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const cardHeight = cardRef.current?.offsetHeight ?? 120;
    const placement: 'top' | 'bottom' =
      rect.top - cardHeight - CARD_GAP < VIEWPORT_PAD ? 'bottom' : 'top';

    let left = rect.left + rect.width / 2 - CARD_WIDTH / 2;
    left = Math.max(VIEWPORT_PAD, Math.min(left, vw - CARD_WIDTH - VIEWPORT_PAD));

    const top =
      placement === 'top'
        ? rect.top - cardHeight - CARD_GAP
        : Math.min(rect.bottom + CARD_GAP, vh - cardHeight - VIEWPORT_PAD);

    return { top, left, placement };
  }, []);

  const show = useCallback(() => {
    clearTimeout(hideTimerRef.current);
    clearTimeout(showTimerRef.current);
    showTimerRef.current = setTimeout(() => {
      const next = computeCoords();
      if (next) setCoords(next);
      setVisible(true);
    }, 300);
  }, [computeCoords]);

  const hide = useCallback(() => {
    clearTimeout(showTimerRef.current);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setVisible(false), 150);
  }, []);

  const hideImmediate = useCallback(() => {
    clearTimeout(showTimerRef.current);
    clearTimeout(hideTimerRef.current);
    setVisible(false);
  }, []);

  // Refine coords once card has rendered (we know its real height now)
  useLayoutEffect(() => {
    if (!visible) return;
    const next = computeCoords();
    if (next) setCoords(next);
  }, [visible, computeCoords]);

  // Auto-hide on scroll/resize so the card doesn't drift or cover content
  useEffect(() => {
    if (!visible) return;
    const onScroll = () => hideImmediate();
    const onResize = () => hideImmediate();
    window.addEventListener('scroll', onScroll, true); // capture: catch nested scrollers
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [visible, hideImmediate]);

  useEffect(() => {
    return () => {
      clearTimeout(showTimerRef.current);
      clearTimeout(hideTimerRef.current);
    };
  }, []);

  if (!info) {
    return <>{children}</>;
  }

  const card = visible && coords && (
    <div
      ref={cardRef}
      role="tooltip"
      style={{
        position: 'fixed',
        top: coords.top,
        left: coords.left,
        width: CARD_WIDTH,
        zIndex: 9999,
      }}
      className={cn(
        'p-3 rounded-lg shadow-xl',
        'bg-[var(--bg-secondary)] border border-[var(--border-primary)]',
        'text-[var(--text-primary)] text-xs',
        'pointer-events-auto',
        'animate-in fade-in-0 zoom-in-95 duration-150'
      )}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            'flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-base',
            'bg-[var(--color-primary-500)]/20 border border-[var(--color-primary-500)]/30'
          )}
        >
          {info.icon || info.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <span className="font-semibold text-sm truncate">{info.name}</span>
          <span className="text-[var(--text-tertiary)] truncate">
            {info.type === 'agent' ? 'AI Agent' : 'User'}
            {info.model && <span className="ml-1 opacity-60">· {info.model}</span>}
          </span>
          {info.description && (
            <span className="text-[var(--text-secondary)] mt-1 line-clamp-2 leading-relaxed">
              {info.description}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-[var(--border-primary)]">
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full',
            info.isActive !== false ? 'bg-green-500' : 'bg-gray-500'
          )}
        />
        <span className="text-[var(--text-tertiary)]">
          {info.isActive !== false ? 'Active' : 'Inactive'}
        </span>
      </div>
    </div>
  );

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {card && createPortal(card, document.body)}
    </>
  );
};

export default MentionTooltip;
