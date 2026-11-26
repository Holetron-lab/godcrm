/**
 * One message as a compact card: sender header, divider, two-line Markdown
 * preview. Shared by the pinned-messages panel (PinnedBanner) and the
 * moved-messages preview (MovedMessagesPreview) so both read the same.
 *
 * The card only knows how to show a message. What a click means — jump to the
 * message, expand it — is the host's call via `onOpen`.
 */
import type { ReactNode } from 'react';
import { Bot, ChevronDown, ChevronUp, Monitor, User } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import { Avatar } from '@/shared/components/ui/Avatar';

export interface MessagePreviewItem {
  id: number | string;
  content: string;
  /** Display label for the sender (e.g. "Вы", agent name). */
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

export interface MessagePreviewCardProps {
  message: MessagePreviewItem;
  /** Click on the header or on the collapsed preview. */
  onOpen: () => void;
  /** i18n keys for the two click targets; both receive `{ name, content }`. */
  headerLabelKey: string;
  bodyLabelKey: string;
  /** Whether the sending agent is running right now. Omit to hide the status dot. */
  isAgentActive?: (senderName: string) => boolean;
  /** Show the whole message instead of the two-line preview. Omit when the card cannot expand. */
  expanded?: boolean;
  /** Buttons on the right of the header. */
  actions?: ReactNode;
}

export function MessagePreviewCard({ message: m, onOpen, headerLabelKey, bodyLabelKey, isAgentActive, expanded, actions }: MessagePreviewCardProps) {
  const { t, language } = useLanguage();
  const isSystem = m.role === 'system' || m.role === 'tool';
  const isAgent = !isSystem && (m.role === 'assistant' || !!m.agentName || !!m.agent_icon);
  const senderType = isSystem ? t('aiChat.ui.system') : isAgent ? t('aiChat.ui.agent') : t('aiChat.ui.person');
  const SenderIcon = isSystem ? Monitor : isAgent ? Bot : User;
  const senderName = m.senderLabel || m.sender_name || m.sender?.name || m.agentName || senderType;
  const sentAt = m.timestamp || m.created_at;
  const date = sentAt ? new Date(sentAt) : null;
  const validDate = date && !Number.isNaN(date.getTime()) ? date : null;
  const isActive = isAgent && !!isAgentActive?.(senderName);
  const labelParams = { name: senderName, content: m.content };
  const ExpandIcon = expanded ? ChevronUp : ChevronDown;
  return (
    <li
      style={{ borderLeftColor: m.agent_color || 'var(--text-tertiary)' }}
      className="min-w-0 rounded-xl px-2 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] border-l-4 hover:bg-[var(--bg-tertiary)] transition-colors"
    >
      <div className="mb-2 border-b border-[var(--border-secondary)] pb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
        <button
          type="button"
          onClick={onOpen}
          aria-label={t(headerLabelKey, labelParams)}
          aria-expanded={expanded}
          className="flex min-w-0 items-center gap-1 text-left text-xs focus-visible:outline focus-visible:outline-2"
        >
          <Avatar url={m.sender_avatar || m.sender?.avatar} emoji={m.agent_icon} name={senderName} color={m.agent_color} size={20} />
          {isAgentActive && (
            <span role="img" aria-label={isAgent ? (isActive ? t('aiChat.ui.agentIsActive') : t('aiChat.ui.agentIsInactive')) : t('aiChat.ui.unknownStatus')}
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? 'bg-green-500' : 'bg-[var(--text-tertiary)]'}`} />
          )}
          <span className="truncate font-medium text-[var(--text-primary)]" title={senderName}>{senderName}</span>
          <SenderIcon className="h-3 w-3 shrink-0 text-[var(--text-secondary)]" aria-label={senderType} />
          {expanded !== undefined && <ExpandIcon className="h-3 w-3 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />}
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {validDate && (
            <time dateTime={validDate.toISOString()} className="whitespace-nowrap text-[10px] tabular-nums text-[var(--text-secondary)]">
              {validDate.toLocaleString(language, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </time>
          )}
          {actions}
        </div>
      </div>
      {expanded ? (
        <div className="text-sm text-[var(--text-primary)] break-words">
          <MarkdownPreview content={m.content} />
        </div>
      ) : (
        <div className="relative max-h-8 overflow-hidden text-xs leading-4">
          <div aria-hidden="true" ref={(node) => { node?.setAttribute('inert', ''); }} className="pointer-events-none">
            <MarkdownPreview content={m.content} className="line-clamp-2 [&_*]:!text-xs [&_*]:!leading-4 [&_*]:!my-0 [&_*]:!py-0 [&_img]:hidden [&_button]:hidden [&_hr]:hidden" />
          </div>
          <button type="button" className="absolute inset-0 w-full focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2" aria-label={t(bodyLabelKey, labelParams)} onClick={onOpen} />
        </div>
      )}
    </li>
  );
}
