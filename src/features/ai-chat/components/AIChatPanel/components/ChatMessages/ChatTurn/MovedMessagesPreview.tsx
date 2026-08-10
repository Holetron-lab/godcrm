/**
 * MovedMessagesPreview — ADR-0031 §Z / WP-24.
 *
 * Renders the preview body (moved-message contents) below the bubble divider
 * when a source-side ChatLinkCard is expanded. Lives outside the card itself
 * so the card stays a flat plate in the bubble's header zone.
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import {
  useMovedMessagesPreview,
  type MovedMessagePreview,
} from '../../../../../hooks/useMovedMessagesPreview';

const PreviewMessageBubble: React.FC<{ msg: MovedMessagePreview }> = ({ msg }) => {
  const text = (msg.content || '').trim();
  if (!text) {
    return (
      <div className="text-[11px] text-[var(--text-tertiary)] italic py-1">(без текста)</div>
    );
  }
  const display = text.length > 1200 ? text.slice(0, 1200) + '…' : text;
  return (
    <div className="text-sm text-[var(--text-primary)] break-words py-1">
      <MarkdownPreview content={display} />
    </div>
  );
};

export interface MovedMessagesPreviewProps {
  conversationId: number;
  messageIds: number[];
}

export const MovedMessagesPreview: React.FC<MovedMessagesPreviewProps> = ({
  conversationId,
  messageIds,
}) => {
  const preview = useMovedMessagesPreview(conversationId, messageIds, true);

  if (preview.isLoading) {
    return (
      <div className="flex items-center gap-2 py-1 text-[11px] text-[var(--text-tertiary)]">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>Загрузка сообщений…</span>
      </div>
    );
  }
  if (preview.error) {
    return (
      <div className="py-1 text-[11px] text-[var(--text-tertiary)]">
        Не удалось загрузить сообщения
      </div>
    );
  }
  if (!preview.data || preview.data.length === 0) {
    return (
      <div className="py-1 text-[11px] text-[var(--text-tertiary)] italic">
        Сообщения недоступны
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {preview.data.map(m => <PreviewMessageBubble key={m.id} msg={m} />)}
    </div>
  );
};

export default MovedMessagesPreview;
