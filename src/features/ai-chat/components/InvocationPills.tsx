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
import { MentionTooltip } from './MentionTooltip';
import { useMentionUsers } from './MentionUsersContext';

// ── Custom event for pill click → insert into chat input ─────────────────────
export const PILL_INSERT_EVENT = 'pill-invoke-insert';

/**
 * Builds a tinted pill style from an agent's accent color.
 * Accepts hex (#rgb / #rrggbb); falls back to the raw value as text color so
 * named colors still work. Background is the same color at ~13% alpha.
 */
function colorTintStyle(color: string): React.CSSProperties {
  const hex = color.trim();
  const isHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex);
  return isHex
    ? { color: hex, backgroundColor: `${hex}22`, borderColor: `${hex}40` }
    : { color: hex };
}

/** Public version — can be called from MarkdownPreview safety-net click handler */
export function handlePillClickExternal(token: string) {
  handlePillClick(token);
}

function handlePillClick(token: string, onClick?: (token: string) => void) {
  if (onClick) {
    onClick(token);
    return;
  }
  // Dispatch custom event — AIChatPanel listens and inserts into input
  const event = new CustomEvent(PILL_INSERT_EVENT, { detail: { token }, cancelable: true });
  const handled = !window.dispatchEvent(event); // returns false if preventDefault was called
  if (handled) {
    // Chat open — token was inserted into input
    showPillToast('Вставлено в инпут');
  } else {
    // No chat open — copy to clipboard
    navigator.clipboard.writeText(token).then(() => {
      showPillToast('Скопировано');
    }).catch(() => {});
  }
}

export function showPillToast(text: string) {
  const toast = document.createElement('div');
  toast.textContent = text;
  toast.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:8px 16px;border-radius:8px;background:rgba(0,0,0,0.8);color:#fff;font-size:13px;z-index:99999;pointer-events:none;transition:opacity 0.3s';
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; }, 1500);
  setTimeout(() => { toast.remove(); }, 1800);
}

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
  const { getBySlug } = useMentionUsers();
  const info = getBySlug(slug);
  const color = info?.color;
  // When the mention resolves to an agent we know, tint the pill with its accent
  // color and show its emoji icon; otherwise keep the generic blue/user fallback.
  const tinted = color ? colorTintStyle(color) : undefined;

  return (
    <MentionTooltip slug={slug}>
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handlePillClick(`<<@${slug}>>`, onClick);
        }}
        style={tinted}
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full',
          'text-xs font-medium',
          !tinted && 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30',
          'cursor-pointer transition-colors',
          'align-middle leading-tight',
          className
        )}
        title={`Invocation: @${slug}`}
      >
        {info?.icon
          ? <span className="text-[11px] leading-none flex-shrink-0">{info.icon}</span>
          : <User className="w-3 h-3 flex-shrink-0" />}
        <span>@{slug}</span>
      </span>
    </MentionTooltip>
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
  const { getBySlug } = useMentionUsers();
  const info = getBySlug(slug);
  const color = info?.color;
  const tinted = color ? colorTintStyle(color) : undefined;

  return (
    <MentionTooltip slug={slug}>
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handlePillClick(`<</${slug}>>`, onClick);
        }}
        style={tinted}
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full',
          'text-xs font-medium',
          !tinted && 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30',
          'cursor-pointer transition-colors',
          'align-middle leading-tight',
          className
        )}
        title={`Invocation: /${slug}`}
      >
        {info?.icon
          ? <span className="text-[11px] leading-none flex-shrink-0">{info.icon}</span>
          : <Bot className="w-3 h-3 flex-shrink-0" />}
        <span>/{slug}</span>
      </span>
    </MentionTooltip>
  );
};

export default { MentionPill, CommandPill };
