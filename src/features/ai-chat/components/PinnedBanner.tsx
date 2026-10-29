import { useLanguage } from '@/shared/i18n/LanguageContext';
/**
 * ADR-0068 WP-E — Pinned-messages panel.
 *
 * The old collapsed "N закреплённых ▾" strip is gone: the pinned count now
 * lives solely on the toolbar Pin badge (ChatToolbar). This component only
 * renders the pinned list, and only while `open` (driven by that toolbar
 * button). Each row is a message-style card — rounded corners, accent left border,
 * sender/status header + actions, divider, and two-line Markdown preview.
 *
 * Accepts a generic `PinnedBannerItem` shape so both the new canvas
 * (ChatMessageItem) and the production AIChatPanel canvas (ChatMessage) can
 * feed it without coupling to either type. Cap soft-warns at 50.
 */

import { useMemo, useState } from 'react';
import { Bot, Copy, Forward, Monitor, User, X } from 'lucide-react';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import { showToast } from '@/shared/hooks/useToast';
import type { ProcessingActiveAgent } from './AIChatPanel/components/ProcessingStatusBar';
import { Avatar } from '@/shared/components/ui/Avatar';

export interface PinnedBannerItem {
  id: number | string;
  content: string;
  pinned_at?: string | null;
  is_deleted?: boolean;
  /** Display label for the sender of the pinned message (e.g. "Вы", agent name). */
  senderLabel?: string;
  sender_id?: number;
  role?: string;
  timestamp?: Date | string;
  created_at?: string;
  sender_name?: string;
  sender_avatar?: string;
  agentName?: string;
  agent_icon?: string;
  agent_color?: string;
  sender?: { name: string; avatar?: string };
}

export interface PinnedBannerProps {
  messages: PinnedBannerItem[];
  onJump: (messageId: number | string) => void;
  activeAgents?: ProcessingActiveAgent[];
  onForward?: (messageId: number | string) => void;
  onUnpin?: (messageId: number | string) => void;
  capReached?: boolean;
  onClearCapNotice?: () => void;
  /**
   * Controlled expanded state. When provided together with `onOpenChange`,
   * the host owns the open/closed flag (e.g. AIChatPanel toolbar button).
   * When omitted, the banner falls back to internal uncontrolled state.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const PIN_CAP = 50;

export function PinnedBanner({ messages, onJump, onUnpin, onForward, activeAgents = [], capReached, onClearCapNotice, open: openProp, onOpenChange }: PinnedBannerProps) {
  const { t, language } = useLanguage();
  const [openInternal] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? !!openProp : openInternal;
  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
  };

  const pinned = useMemo(() => {
    return messages
      .filter((m) => !!m.pinned_at && !m.is_deleted)
      .sort((a, b) => new Date(b.pinned_at as string).getTime() - new Date(a.pinned_at as string).getTime());
  }, [messages]);

  // Nothing to surface: no open list and no cap warning.
  if (!capReached && (!open || pinned.length === 0)) return null;

  return (
    <div className="flex-shrink-0 border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
      {capReached && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-100/40 dark:bg-amber-900/20 border-b border-amber-200/40 dark:border-amber-800/40">
          <span className="flex-1">{t('aiChat.ui.pinLimit', { count: PIN_CAP })}</span>
          {onClearCapNotice && (
            <button
              type="button"
              onClick={onClearCapNotice}
              className="p-0.5 hover:bg-amber-200/40 dark:hover:bg-amber-800/40"
              aria-label={t('aiChat.ui.hide')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
      {open && pinned.length > 0 && (
        <ul className="max-h-[40vh] overflow-y-auto flex flex-col gap-1 p-1.5">
          {pinned.map((m) => {
            const isSystem = m.role === 'system' || m.role === 'tool';
            const isAgent = !isSystem && (m.role === 'assistant' || !!m.agentName || !!m.agent_icon);
            const senderType = isSystem ? t('aiChat.ui.system') : isAgent ? t('aiChat.ui.agent') : t('aiChat.ui.person');
            const SenderIcon = isSystem ? Monitor : isAgent ? Bot : User;
            const senderName = m.senderLabel || m.sender_name || m.sender?.name || m.agentName || senderType;
            const sentAt = m.timestamp || m.created_at;
            const date = sentAt ? new Date(sentAt) : null;
            const validDate = date && !Number.isNaN(date.getTime()) ? date : null;
            const isActive = isAgent && activeAgents.some(agent =>
              (!agent.inflight_status || agent.inflight_status === 'running') &&
              (m.sender_id != null && agent.agent_user_id != null
                ? agent.agent_user_id === m.sender_id
                : agent.agent_name === senderName));
            const actionClass = 'flex h-7 w-7 shrink-0 items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';
            return (
              <li
                key={m.id}
                style={{ borderLeftColor: m.agent_color || 'var(--text-tertiary)' }}
                className="min-w-0 rounded-xl px-2 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] border-l-4 hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <div className="mb-2 border-b border-[var(--border-secondary)] pb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
                  <button
                    type="button"
                    onClick={() => { onJump(m.id); setOpen(false); }}
                    aria-label={t('aiChat.ui.jumpToSenderMessage', { name: senderName })}
                    className="flex min-w-0 items-center gap-1 text-left text-xs focus-visible:outline focus-visible:outline-2"
                  >
                    <Avatar url={m.sender_avatar || m.sender?.avatar} emoji={m.agent_icon} name={senderName} color={m.agent_color} size={20} />
                    <span role="img" aria-label={isAgent ? (isActive ? t('aiChat.ui.agentIsActive') : t('aiChat.ui.agentIsInactive')) : t('aiChat.ui.unknownStatus')}
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? 'bg-green-500' : 'bg-[var(--text-tertiary)]'}`} />
                    <span className="truncate font-medium text-[var(--text-primary)]" title={senderName}>{senderName}</span>
                    <SenderIcon className="h-3 w-3 shrink-0 text-[var(--text-secondary)]" aria-label={senderType} />
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {validDate && (
                      <time dateTime={validDate.toISOString()} className="whitespace-nowrap text-[10px] tabular-nums text-[var(--text-secondary)]">
                        {validDate.toLocaleString(language, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </time>
                    )}
                    {onForward && <button type="button" onClick={() => onForward(m.id)} className={actionClass} title={t('aiChat.ui.forward')} aria-label={t('aiChat.ui.forward')}><Forward className="h-3.5 w-3.5" /></button>}
                    <button type="button" className={actionClass} title={t('settings.profile.referralCopy')} aria-label={t('settings.profile.referralCopy')} onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(m.content);
                        showToast(t('aiChat.ui.messageCopied'), 'success');
                      } catch {
                        showToast(t('aiChat.ui.couldNotCopyMessage'), 'error');
                      }
                    }}><Copy className="h-3.5 w-3.5" /></button>
                    {onUnpin && <button type="button" onClick={() => onUnpin(m.id)} className={actionClass} title={t('aiChat.ui.unpin')} aria-label={t('aiChat.ui.unpin')}><X className="h-3.5 w-3.5" /></button>}
                  </div>
                </div>
                <div className="relative max-h-8 overflow-hidden text-xs leading-4">
                  <div aria-hidden="true" ref={(node) => { node?.setAttribute('inert', ''); }} className="pointer-events-none">
                    <MarkdownPreview content={m.content} className="line-clamp-2 [&_*]:!text-xs [&_*]:!leading-4 [&_*]:!my-0 [&_*]:!py-0 [&_img]:hidden [&_button]:hidden [&_hr]:hidden" />
                  </div>
                  <button type="button" className="absolute inset-0 w-full focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2" aria-label={t('aiChat.ui.openSenderMessage', { name: senderName, content: m.content })} onClick={() => { onJump(m.id); setOpen(false); }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
