import { useLanguage } from '@/shared/i18n/LanguageContext';
/**
 * MovedMessagesPreview — ADR-0031 §Z / WP-24.
 *
 * Renders the preview body (moved-message contents) below the bubble divider
 * when a source-side ChatLinkCard is expanded. Lives outside the card itself
 * so the card stays a flat plate in the bubble's header zone.
 *
 * Each message is a MessagePreviewCard — the card of the pinned panel — that
 * starts as a two-line preview and expands to the whole message on click.
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
import {
  useMovedMessagesPreview,
  type MovedMessagePreview,
} from '../../../../../hooks/useMovedMessagesPreview';
import { MessagePreviewCard } from '../../../../MessagePreviewCard';
import { useMentionUsers } from '../../../../MentionUsersContext';

// GET …/messages/by-ids returns at most this many rows per request.
const PREVIEW_LIMIT = 50;

// Agent working steps travel with a moved turn but are not messages to read.
const STEP_CONTENT_TYPES = new Set(['thinking', 'tool_call', 'tool_result', 'agent_status', 'plan']);

export interface MovedMessagesPreviewProps {
  conversationId: number;
  messageIds: number[];
}

export const MovedMessagesPreview: React.FC<MovedMessagesPreviewProps> = ({
  conversationId,
  messageIds,
}) => {
  const { t } = useLanguage();
  const { getByUserId, getByAgentId } = useMentionUsers();
  const preview = useMovedMessagesPreview(conversationId, messageIds, true);
  const [expandedIds, setExpandedIds] = React.useState<ReadonlySet<number>>(new Set());
  const toggleExpanded = (id: number) => setExpandedIds(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  if (preview.isLoading) {
    return (
      <div className="flex items-center gap-2 py-1 text-[11px] text-[var(--text-tertiary)]">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>{t('aiChat.ui.loadingMessages')}</span>
      </div>
    );
  }
  if (preview.error) {
    return (
      <div className="py-1 text-[11px] text-[var(--text-tertiary)]">
        {t('aiChat.ui.couldNotLoadMessages')}</div>
    );
  }
  const messages = (preview.data ?? []).filter((m: MovedMessagePreview) => !STEP_CONTENT_TYPES.has(m.content_type ?? ''));
  if (messages.length === 0) {
    return (
      <div className="py-1 text-[11px] text-[var(--text-tertiary)] italic">
        {t('aiChat.ui.messagesUnavailable')}</div>
    );
  }
  return (
    <>
      <ul className="flex flex-col gap-1">
        {messages.map(m => {
          const agentRowId = Number(m.metadata.agent_row_id);
          const sender = (m.sender_id != null ? getByUserId(m.sender_id) : null)
            || (agentRowId ? getByAgentId(agentRowId) : null);
          const expanded = expandedIds.has(m.id);
          return (
            <MessagePreviewCard
              key={m.id}
              message={{
                id: m.id,
                content: (m.content || '').trim() || t('aiChat.ui.noText'),
                role: m.role ?? undefined,
                created_at: m.created_at ?? undefined,
                sender_name: m.sender_name ?? sender?.name,
                sender_avatar: m.sender_avatar ?? sender?.avatar,
                agent_icon: sender?.type === 'agent' ? sender.icon : undefined,
                agent_color: sender?.color,
              }}
              expanded={expanded}
              onOpen={() => toggleExpanded(m.id)}
              headerLabelKey={expanded ? 'aiChat.ui.collapseSenderMessage' : 'aiChat.ui.expandSenderMessage'}
              bodyLabelKey="aiChat.ui.expandSenderMessage"
            />
          );
        })}
      </ul>
      {messageIds.length > PREVIEW_LIMIT && (
        <p className="pt-1 text-[11px] text-[var(--text-tertiary)]">
          {t('aiChat.ui.movedPreviewLimited', { shown: PREVIEW_LIMIT, total: messageIds.length })}
        </p>
      )}
    </>
  );
};

export default MovedMessagesPreview;
