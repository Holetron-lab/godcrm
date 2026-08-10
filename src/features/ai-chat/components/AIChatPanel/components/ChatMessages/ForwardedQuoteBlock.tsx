/**
 * ForwardedQuoteBlock — renders a forwarded message inside AIChatPanel turns.
 * Design: left colored border (agent color), collapsible, header/footer separators.
 */

import React, { useState } from 'react';
import { Forward, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

interface ForwardedQuoteBlockProps {
  senderName: string;
  timestamp: string | null;
  content: string;
  chatId?: string;
  messageId?: string;
  agentColor?: string;
  defaultCollapsed?: boolean;
  /** Current conversation ID — used to auto-expand quotes from other chats */
  currentConversationId?: number | string;
}

export function ForwardedQuoteBlock({
  senderName,
  timestamp,
  content,
  chatId,
  messageId,
  agentColor,
  defaultCollapsed,
  currentConversationId,
}: ForwardedQuoteBlockProps) {
  // Always expanded by default (user can collapse manually)
  const effectiveCollapsed = defaultCollapsed ?? false;
  const [expanded, setExpanded] = useState(!effectiveCollapsed);

  const refMatch = content.match(/^_чат #(\d+), сообщение #(\d+)(?:, цвет #[0-9a-fA-F]+)?_$/m);
  const refChatId = chatId || refMatch?.[1];
  const refMsgId = messageId || refMatch?.[2];
  const cleanContent = content.replace(/^_чат #\d+, сообщение #\d+(?:, цвет #[0-9a-fA-F]+)?_$/m, '').trim();

  const borderColor = agentColor || hashColor(senderName);
  const preview = cleanContent.split('\n')[0]?.slice(0, 120) || '';

  const handleNavigate = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (refChatId) {
      window.dispatchEvent(new CustomEvent('navigate-to-chat-message', {
        detail: { chatId: refChatId, messageId: refMsgId },
      }));
    }
  };

  return (
    <div
      className="rounded-lg overflow-hidden my-1"
      style={{ borderLeft: `4px solid ${borderColor}` }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[var(--bg-tertiary)]/80 transition-colors select-none"
        onClick={() => setExpanded(prev => !prev)}
      >
        {expanded
          ? <ChevronDown className="w-3 h-3 flex-shrink-0" style={{ color: borderColor }} />
          : <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: borderColor }} />
        }
        <Forward className="w-3 h-3 flex-shrink-0" style={{ color: borderColor }} />
        <span className="text-xs font-semibold" style={{ color: borderColor }}>{senderName}</span>
        {timestamp && (
          <span className="text-[10px] text-[var(--text-tertiary)]">{timestamp}</span>
        )}
        {!expanded && preview && (
          <span className="text-[11px] text-[var(--text-tertiary)] truncate ml-1 opacity-70">— {preview}</span>
        )}
      </div>

      {/* Header separator */}
      {expanded && (
        <div className="mx-3 h-px" style={{ backgroundColor: `${borderColor}30` }} />
      )}

      {/* Body */}
      {expanded && cleanContent && (
        <div className="px-3 py-2 text-sm text-[var(--text-secondary)] bg-[var(--bg-tertiary)]/30">
          <MarkdownPreview content={cleanContent} />
        </div>
      )}

      {/* Footer separator + footer */}
      {(refChatId || expanded) && (
        <>
          {expanded && <div className="mx-3 h-px" style={{ backgroundColor: `${borderColor}30` }} />}
          <div className="flex items-center gap-2 px-3 py-1 text-[10px] text-[var(--text-tertiary)]">
            {refChatId && (
              <button
                onClick={handleNavigate}
                className="inline-flex items-center gap-1 hover:text-[var(--text-secondary)] transition-colors"
                title={`Перейти к чату #${refChatId}, сообщение #${refMsgId || '?'}`}
              >
                <ExternalLink className="w-3 h-3" />
                <span>Перейти к сообщению</span>
              </button>
            )}
            {refChatId && <span className="opacity-50">чат #{refChatId}</span>}
          </div>
        </>
      )}
    </div>
  );
}
