import { useLanguage } from '@/shared/i18n/LanguageContext';
/**
 * ADR-0068 WP-E — Pinned-messages panel.
 *
 * The old collapsed "N закреплённых ▾" strip is gone: the pinned count now
 * lives solely on the toolbar Pin badge (ChatToolbar). This component only
 * renders the pinned list, and only while `open` (driven by that toolbar
 * button). Each row is a MessagePreviewCard — rounded corners, accent left border,
 * sender/status header + actions, divider, and two-line Markdown preview.
 *
 * Accepts a generic `PinnedBannerItem` shape so both the new canvas
 * (ChatMessageItem) and the production AIChatPanel canvas (ChatMessage) can
 * feed it without coupling to either type. Cap soft-warns at 50.
 */

import { useMemo, useState } from 'react';
import { Copy, Forward, X } from 'lucide-react';
import { showToast } from '@/shared/hooks/useToast';
import type { ProcessingActiveAgent } from './AIChatPanel/components/ProcessingStatusBar';
import { MessagePreviewCard, type MessagePreviewItem } from './MessagePreviewCard';

export interface PinnedBannerItem extends MessagePreviewItem {
  pinned_at?: string | null;
  is_deleted?: boolean;
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
  const { t } = useLanguage();
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
            const actionClass = 'flex h-7 w-7 shrink-0 items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';
            return (
              <MessagePreviewCard
                key={m.id}
                message={m}
                onOpen={() => { onJump(m.id); setOpen(false); }}
                headerLabelKey="aiChat.ui.jumpToSenderMessage"
                bodyLabelKey="aiChat.ui.openSenderMessage"
                isAgentActive={(senderName) => activeAgents.some(agent =>
                  (!agent.inflight_status || agent.inflight_status === 'running') &&
                  (m.sender_id != null && agent.agent_user_id != null
                    ? agent.agent_user_id === m.sender_id
                    : agent.agent_name === senderName))}
                actions={<>
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
                </>}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
