/**
 * InvocationPills - ADR-116: Structured Invocation Tokens
 *
 * MentionPill:  renders <<@slug>> as a styled pill/chip (blue bg, user icon)
 * CommandPill:  renders <</slug>> as a styled command pill (purple bg, bot icon)
 *
 * Plain @slug and /slug render as subtle reference highlights (not pills).
 */

import React from 'react';
import { Bot, User } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

// ── MentionPill ──────────────────────────────────────────────────────────────

interface MentionPillProps {
  /** The slug without delimiters, e.g. "dev-user" */
  slug: string;
  /** Optional click handler */
  onClick?: (token: string) => void;
  className?: string;
}

/**
 * Renders a structured invocation mention (<<@slug>>) as a styled pill.
 * Blue background with user icon.
 */
export const MentionPill: React.FC<MentionPillProps> = ({ slug, onClick, className }) => {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick?.(`<<@${slug}>>`);
      }}
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full',
        'bg-blue-500/20 text-blue-400 text-xs font-medium',
        'cursor-pointer hover:bg-blue-500/30 transition-colors',
        'align-middle leading-tight',
        className
      )}
      title={`Invocation: @${slug}`}
    >
      <User className="w-3 h-3 flex-shrink-0" />
      <span>@{slug}</span>
    </span>
  );
};

// ── CommandPill ──────────────────────────────────────────────────────────────

interface CommandPillProps {
  /** The slug without delimiters, e.g. "developer" */
  slug: string;
  /** Optional click handler */
  onClick?: (token: string) => void;
  className?: string;
}

/**
 * Renders a structured invocation command (<</slug>>) as a styled pill.
 * Purple background with bot icon.
 */
export const CommandPill: React.FC<CommandPillProps> = ({ slug, onClick, className }) => {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick?.(`<</${slug}>>`);
      }}
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full',
        'bg-purple-500/20 text-purple-400 text-xs font-medium',
        'cursor-pointer hover:bg-purple-500/30 transition-colors',
        'align-middle leading-tight',
        className
      )}
      title={`Invocation: /${slug}`}
    >
      <Bot className="w-3 h-3 flex-shrink-0" />
      <span>/{slug}</span>
    </span>
  );
};

export default { MentionPill, CommandPill };
