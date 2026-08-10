/**
 * ChatMessage - Single message component
 * @see ADR-069-MODULE-INTEGRATION.md
 */
import React from 'react';
import type { ChatMessage as ChatMessageType } from '@/shared/hooks/useRowChat';

export interface ChatMessageProps {
  message: ChatMessageType;
  className?: string;
}

export function ChatMessage({ message, className = '' }: ChatMessageProps) {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className={`flex gap-3 ${className}`}>
      {/* Avatar */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-xs font-medium text-[var(--text-secondary)]">
        {message.user?.name?.charAt(0)?.toUpperCase() || '?'}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-[var(--text-primary)] truncate">
            {message.user?.name || 'Unknown'}
          </span>
          <span className="text-xs text-[var(--text-tertiary)]">
            {formatDate(message.created_at)}
          </span>
        </div>
        <p className="text-sm text-[var(--text-secondary)] break-words whitespace-pre-wrap">
          {message.content}
        </p>
      </div>
    </div>
  );
}
