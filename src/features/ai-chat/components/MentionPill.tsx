/**
 * MentionPill Component — ADR-116
 *
 * Renders an invocation pill for `<<@slug>>` tokens.
 * Visually prominent: primary-colored badge with @ prefix.
 */

import React from 'react';
import { cn } from '@/shared/utils/cn';

interface MentionPillProps {
  /** The slug (without <<@ and >>) */
  slug: string;
  /** Raw token string, e.g. "<<@developer>>" — passed to onMentionClick */
  rawToken: string;
  onClick?: (token: string, e: React.MouseEvent) => void;
  className?: string;
}

export const MentionPill: React.FC<MentionPillProps> = ({
  slug,
  rawToken,
  onClick,
  className,
}) => {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClick?.(rawToken, e);
  };

  return (
    <span
      data-testid={`mention-pill-${slug}`}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.(rawToken, e as unknown as React.MouseEvent);
        }
      }}
      role="button"
      tabIndex={0}
      title={`Invoke agent @${slug}`}
      className={cn(
        'inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5',
        'rounded-full text-xs font-semibold',
        'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-400)]',
        'border border-[var(--color-primary-500)]/30',
        'cursor-pointer select-none',
        'hover:bg-[var(--color-primary-500)]/30 hover:border-[var(--color-primary-500)]/50',
        'transition-colors duration-150',
        className
      )}
    >
      @{slug}
    </span>
  );
};

export default MentionPill;
