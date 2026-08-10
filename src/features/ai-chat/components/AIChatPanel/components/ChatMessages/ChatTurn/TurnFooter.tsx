import React, { useState } from 'react';
import {
  Copy,
  Forward,
  Trash2,
  Plus,
  Play,
  Square,
  Loader2,
  ArrowRightLeft,
  Pin,
  PinOff,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import type { TurnFooterProps } from './types';

export const TurnFooter: React.FC<TurnFooterProps> = React.memo(({
  reactableMessageId,
  reactionList,
  quickEmojis,
  onReact,
  onCopy,
  onForward,
  onMove,
  isChatOwner,
  onPin,
  onUnpin,
  canPin,
  onDelete,
  primaryMessage,
  allMessages,
  turnType,
  currentUserId,
  onContinueAgent,
  onStopAgent,
  isProcessing,
  isIncomplete,
  agentRowId,
  jobDbId,
}) => {
  const [showReactionPicker, setShowReactionPicker] = useState(false);

  const handleReact = (emoji: string) => {
    if (onReact && reactableMessageId) {
      onReact(reactableMessageId, emoji);
    }
    setShowReactionPicker(false);
  };

  const isFromMe =
    primaryMessage?.sender_id !== undefined &&
    primaryMessage?.sender_id !== null
      ? Number(primaryMessage.sender_id) === Number(currentUserId)
      : primaryMessage?.role === 'user';

  return (
    <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--text-tertiary)]">
      {/* Reactions */}
      {onReact && reactableMessageId && (
        <div
          className="relative flex items-center gap-1"
          onMouseEnter={() => setShowReactionPicker(true)}
          onMouseLeave={() => setShowReactionPicker(false)}
        >
          {/* Plus button for mobile */}
          <button
            onClick={() => setShowReactionPicker(!showReactionPicker)}
            className="md:hidden w-5 h-5 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            title="Добавить реакцию"
          >
            <Plus className="w-3 h-3" />
          </button>

          {/* Heart reaction */}
          <button
            onClick={() => handleReact('\u2764\uFE0F')}
            className={cn(
              'flex items-center gap-0.5 transition-colors',
              reactionList.some(
                (r) => r.emoji === '\u2764\uFE0F' && r.hasMyReaction
              )
                ? 'text-red-500'
                : 'text-[var(--text-tertiary)] hover:text-red-400'
            )}
            title={
              reactionList
                .find((r) => r.emoji === '\u2764\uFE0F')
                ?.users.map((u) => u.user_name)
                .join(', ') || 'Нравится'
            }
          >
            {reactionList.some((r) => r.emoji === '\u2764\uFE0F') ? '\u2764\uFE0F' : '\uD83E\uDD0D'}
            {reactionList.find((r) => r.emoji === '\u2764\uFE0F')?.users.length ? (
              <span className="text-[10px]">
                {reactionList.find((r) => r.emoji === '\u2764\uFE0F')?.users.length}
              </span>
            ) : null}
          </button>

          {/* Other reactions */}
          {reactionList.filter((r) => r.emoji !== '\u2764\uFE0F').length > 0 && (
            <div className="flex items-center gap-0.5 ml-1">
              {reactionList
                .filter((r) => r.emoji !== '\u2764\uFE0F')
                .slice(0, 3)
                .map(({ emoji, users, hasMyReaction }) => (
                  <button
                    key={emoji}
                    onClick={() => handleReact(emoji)}
                    className={cn(
                      'flex items-center transition-colors',
                      hasMyReaction
                        ? 'opacity-100'
                        : 'opacity-70 hover:opacity-100'
                    )}
                    title={users.map((u) => u.user_name).join(', ')}
                  >
                    <span className="text-xs">{emoji}</span>
                    <span className="text-[10px] text-[var(--text-tertiary)]">
                      {users.length}
                    </span>
                  </button>
                ))}
            </div>
          )}

          {/* Hover picker (desktop) / Click picker (mobile) */}
          {showReactionPicker && (
            <div className="absolute top-1/2 -translate-y-1/2 left-full ml-1 z-50 flex gap-0.5 p-1 rounded-full bg-[var(--bg-secondary)] shadow-lg">
              {quickEmojis
                .filter((e) => e !== '\u2764\uFE0F')
                .map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => handleReact(emoji)}
                    className={cn(
                      'w-6 h-6 rounded-full flex items-center justify-center text-sm transition-transform hover:scale-125',
                      reactionList.some(
                        (r) => r.emoji === emoji && r.hasMyReaction
                      ) && 'bg-[var(--bg-tertiary)]'
                    )}
                  >
                    {emoji}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Processing indicator + stop button */}
      {turnType === 'agent' && isProcessing && (
        <span className="flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin text-[var(--color-primary-500)]" />
          {onStopAgent && (
            <button
              onClick={onStopAgent}
              className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title={[
                'Остановить агента',
                agentRowId ? `Agent #${agentRowId}` : '',
                jobDbId ? `Job #${jobDbId}` : '',
              ].filter(Boolean).join(' • ')}
            >
              <Square className="w-2.5 h-2.5 fill-current" />
            </button>
          )}
        </span>
      )}
      {/* Continue button — prominent when incomplete, on-hover otherwise */}
      {turnType === 'agent' && !isProcessing && onContinueAgent && (
        <button
          onClick={onContinueAgent}
          className={cn(
            "flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors",
            isIncomplete
              ? "text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 font-medium"
              : "text-[var(--text-tertiary)] hover:text-[var(--color-primary-500)] hover:bg-[var(--color-primary-500)]/10 opacity-0 group-hover:opacity-100"
          )}
          title={[
            'Продолжить агента',
            agentRowId ? `Agent #${agentRowId}` : '',
            jobDbId ? `Job #${jobDbId}` : '',
          ].filter(Boolean).join(' • ')}
        >
          <Play className="w-3 h-3 fill-current" />
          <span>Продолжить</span>
        </button>
      )}

      {/* Spacer */}
      <span className="flex-1" />

      {/* Context actions: Copy, Forward, Delete */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {onCopy && primaryMessage && (
          <button
            onClick={() => onCopy(primaryMessage)}
            className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            title="Копировать"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        )}
        {/* ADR-0031 WP-24: «Перенести» — owner-only, between Copy and Forward */}
        {isChatOwner && onMove && primaryMessage && (
          <button
            onClick={() => onMove(primaryMessage)}
            className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            title="Перенести"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
          </button>
        )}
        {onForward && primaryMessage && (
          <button
            onClick={() => {
              // Forward only final text or last reasoning by default (not all agent steps)
              if (allMessages?.length && turnType === 'agent') {
                const finalText = allMessages.find(m => (m.contentType === 'text' || !m.contentType) && m.content);
                if (finalText) { onForward(finalText); return; }
                const lastReasoning = [...allMessages].reverse().find(m => m.contentType === 'thinking' && m.content);
                if (lastReasoning) { onForward(lastReasoning); return; }
              }
              onForward(primaryMessage);
            }}
            className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            title="Переслать"
          >
            <Forward className="w-3.5 h-3.5" />
          </button>
        )}
        {/* ADR-0068 WP-E — Pin / Unpin. Reflects authoritative pinned_at on the
            primary message; hidden entirely when canPin is false (DM
            non-owners, read-only viewers). */}
        {canPin && primaryMessage?.id && (
          primaryMessage.pinned_at
            ? onUnpin && (
              <button
                onClick={() => onUnpin(Number(primaryMessage.id))}
                className="w-6 h-6 rounded flex items-center justify-center text-[var(--color-primary-500)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                title="Открепить"
              >
                <PinOff className="w-3.5 h-3.5" />
              </button>
            )
            : onPin && (
              <button
                onClick={() => onPin(Number(primaryMessage.id))}
                className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                title="Закрепить"
              >
                <Pin className="w-3.5 h-3.5" />
              </button>
            )
        )}
        {isFromMe && onDelete && primaryMessage?.id && (
          <button
            onClick={() => onDelete(Number(primaryMessage.id))}
            className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Удалить"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
});
