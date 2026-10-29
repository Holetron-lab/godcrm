import { useLanguage } from '@/shared/i18n/LanguageContext';
/**
 * InvocationPills - ADR-116: Structured Invocation Tokens
 *
 * MentionPill:  renders <<@slug>> as a styled pill/chip (agent accent fill)
 * CommandPill:  renders <</slug>> as a styled command pill (agent accent fill)
 *
 * Plain @slug renders as an outlined reference without an invocation action.
 */

import React from 'react';
import { Bot, User } from 'lucide-react';
import { Avatar } from '@/shared/components/ui/Avatar';
import { cn } from '@/shared/utils/cn';
import { MentionTooltip } from './MentionTooltip';
import { useMentionUsers } from './MentionUsersContext';

// ── Custom event for pill click → insert into chat input ─────────────────────
export const PILL_INSERT_EVENT = 'pill-invoke-insert';

/** Use the agent accent for invocation fills and reference outlines. */
function colorTintStyle(color: string, reference = false): React.CSSProperties {
  const accent = color.trim();
  const hex = /^#[0-9a-f]{3}$/i.test(accent)
    ? '#' + [...accent.slice(1)].map(char => char + char).join('')
    : accent;
  return {
    borderColor: accent,
    borderWidth: 0,
    boxShadow: reference ? `inset 0 0 0 0.5px ${accent}` : undefined,
    backgroundColor: reference ? 'transparent' : /^#[0-9a-f]{6}$/i.test(hex)
      ? `${hex}33`
      : `color-mix(in srgb, ${accent} 20%, transparent)`,
  };
}

/** Public version — can be called from MarkdownPreview safety-net click handler */
export function handlePillClickExternal(token: string, t: (key: string) => string) {
  handlePillClick(token, t);
}

function handlePillClick(token: string, t: (key: string) => string, onClick?: (token: string) => void) {
  if (onClick) {
    onClick(token);
    return;
  }
  // Dispatch custom event — AIChatPanel listens and inserts into input
  const event = new CustomEvent(PILL_INSERT_EVENT, { detail: { token }, cancelable: true });
  const handled = !window.dispatchEvent(event); // returns false if preventDefault was called
  if (handled) {
    // Chat open — token was inserted into input
    showPillToast(t('aiChat.ui.insertedInInput'));
  } else {
    // No chat open — copy to clipboard
    navigator.clipboard.writeText(token).then(() => {
      showPillToast(t('aiChat.ui.copied'));
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
  reference?: boolean;
}

/**
 * Renders a structured invocation mention (<<@slug>>) as a styled pill.
 * Uses the agent accent; references keep only the outline.
 */
export const MentionPill: React.FC<MentionPillProps> = ({ slug, onClick, className, reference = false }) => {
  const { t } = useLanguage();
  const { getBySlug } = useMentionUsers();
  const info = getBySlug(slug);
  const color = info?.color || '#3B82F6';
  // Keep a visible fallback while agent metadata is unavailable.
  const tinted = colorTintStyle(color, reference);
  const Tag = reference ? 'span' : 'button';

  return (
    <MentionTooltip slug={slug}>
      <Tag
        type={reference ? undefined : "button"}
        onClick={reference ? undefined : (e) => {
          e.preventDefault();
          e.stopPropagation();
          handlePillClick(`<<@${slug}>>`, t, onClick);
        }}
        style={tinted}
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full',
          'text-xs font-medium border text-[var(--text-primary)]',
          !reference && 'cursor-pointer hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
          'align-middle leading-tight',
          className
        )}
        title={t(reference ? 'aiChat.ui.mentionReference' : 'aiChat.ui.mentionInvocation', { name: slug })}
      >
        {info?.icon
          ? /^(\/|https?:\/\/|data:)/.test(info.icon)
            ? <Avatar url={info.icon} name={info.name} size={14} color={info.color} />
            : <span className="text-[11px] leading-none flex-shrink-0">{info.icon}</span>
          : <User className="w-3 h-3 flex-shrink-0" />}
        <span>@{slug}</span>
      </Tag>
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
 * Uses the same agent accent as mention invocations.
 */
export const CommandPill: React.FC<CommandPillProps> = ({ slug, onClick, className }) => {
  const { t } = useLanguage();
  const { getBySlug } = useMentionUsers();
  const info = getBySlug(slug);
  const color = info?.color || '#8B5CF6';
  const tinted = colorTintStyle(color);

  return (
    <MentionTooltip slug={slug}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handlePillClick(`<</${slug}>>`, t, onClick);
        }}
        style={tinted}
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full',
          'text-xs font-medium border text-[var(--text-primary)]',
          'cursor-pointer hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
          'align-middle leading-tight',
          className
        )}
        title={t('aiChat.ui.commandInvocation', { name: slug })}
      >
        {info?.icon
          ? /^(\/|https?:\/\/|data:)/.test(info.icon)
            ? <Avatar url={info.icon} name={info.name} size={14} color={info.color} />
            : <span className="text-[11px] leading-none flex-shrink-0">{info.icon}</span>
          : <Bot className="w-3 h-3 flex-shrink-0" />}
        <span>/{slug}</span>
      </button>
    </MentionTooltip>
  );
};

export default { MentionPill, CommandPill };
