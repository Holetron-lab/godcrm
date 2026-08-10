import React from 'react';
import { Bot, Cpu, User, Zap } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Avatar } from '@/shared/components/ui/Avatar';
import type { TurnHeaderProps } from './types';
import { formatDuration } from './helpers';

export const TurnHeader: React.FC<TurnHeaderProps> = ({
  turnType,
  senderName,
  timestamp,
  timestampEnd,
  durationMs,
  isProcessing,
  agentColor,
  agentIcon,
  agentInvocationMode,
  tokenCount,
  agentRowId,
  jobDbId,
  isAgentActiveInChat,
  onAgentNameClick,
  senderAvatar,
  isSystemEvent,
}) => {
  // ⚡ Zap for slash-command agents (`<</slug>>`), 🤖 Bot for @-mention agents.
  // `both` defaults to Bot (mention is the legacy/primary path).
  const AgentRoleIcon = agentInvocationMode === 'command' ? Zap : Bot;
  const durationLabel = formatDuration(durationMs);
  // Show green dot if this turn is processing OR if the same agent is active elsewhere in chat
  const showGreenDot = isProcessing || isAgentActiveInChat;
  return (
  <div className="flex items-center gap-2 mb-2">
    {/* Avatar + system-event overlay. The wrapper is `relative` so the
        microchip badge in the bottom-right corner anchors to the avatar. */}
    <div className="relative w-7 h-7 flex-shrink-0">
      {turnType === 'agent' || (senderName && senderName !== 'AI') ? (
        <Avatar
          url={senderAvatar}
          emoji={turnType === 'agent' ? agentIcon : null}
          name={senderName}
          color={turnType === 'agent' ? agentColor : (turnType === 'human' ? '#3b82f6' : '#a855f7')}
          size={28}
        />
      ) : (
        <div
          className={cn(
            'w-7 h-7 rounded-full flex items-center justify-center',
            turnType === 'human'
              ? 'bg-blue-500/20 text-blue-400'
              : 'bg-purple-500/20 text-purple-400'
          )}
        >
          {turnType === 'human' ? (
            <User className="w-3.5 h-3.5" />
          ) : (
            <AgentRoleIcon className="w-3.5 h-3.5" />
          )}
        </div>
      )}
      {isSystemEvent && (
        <span
          className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-slate-700 ring-2 ring-[var(--bg-primary,#0b0f14)] flex items-center justify-center text-slate-200"
          title="Сообщение отправлено системой от имени пользователя"
        >
          <Cpu className="w-2.5 h-2.5" />
        </span>
      )}
    </div>

    {/* Status dot: green pulsing = this turn processing, green solid = agent active elsewhere, grey = idle */}
    {turnType === 'agent' && (
      <span
        className="relative flex h-2.5 w-2.5 flex-shrink-0"
        title={[
          isProcessing ? 'Агент работает' : isAgentActiveInChat ? 'Агент активен' : 'Агент не активен',
          agentRowId ? `Agent #${agentRowId}` : '',
          jobDbId ? `Job #${jobDbId}` : '',
        ].filter(Boolean).join(' • ')}
      >
        {isProcessing && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        )}
        <span
          className="relative inline-flex rounded-full h-2.5 w-2.5"
          style={{ backgroundColor: showGreenDot ? '#22c55e' : (agentColor || '#6b7280') + '60' }}
        />
      </span>
    )}

    {/* Sender name — clickable for agents to insert mention */}
    {turnType === 'agent' && onAgentNameClick ? (
      <button
        onClick={onAgentNameClick}
        className="text-sm font-medium text-[var(--text-primary)] truncate hover:underline hover:text-[var(--color-primary-500)] transition-colors cursor-pointer"
        title={`Упомянуть @${senderName}`}
      >
        {senderName}
      </button>
    ) : (
      <span className="text-sm font-medium text-[var(--text-primary)] truncate">
        {senderName}
      </span>
    )}

    {/* Badge — system badge wins over the human/bot badge when this turn was
        emitted by the service on behalf of the actor (e.g. row_mutation). */}
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium',
        isSystemEvent
          ? 'bg-slate-500/15 text-slate-400'
          : turnType === 'human'
            ? 'bg-blue-500/15 text-blue-400'
            : 'bg-purple-500/15 text-purple-400'
      )}
      style={
        !isSystemEvent && turnType === 'agent' && agentColor
          ? { backgroundColor: `${agentColor}15`, color: agentColor }
          : undefined
      }
      title={isSystemEvent ? 'Сообщение от системы' : undefined}
    >
      {isSystemEvent ? (
        <>
          <Cpu className="w-3 h-3" />
          <span>system</span>
        </>
      ) : turnType === 'human' ? (
        <User className="w-3 h-3" />
      ) : (
        <AgentRoleIcon className="w-3 h-3" />
      )}
    </span>

    {/* Token count */}
    {tokenCount != null && tokenCount > 0 && (
      <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0 tabular-nums">
        {tokenCount.toLocaleString()} tokens
      </span>
    )}

    {/* Spacer */}
    <span className="flex-1" />

    {/* Timestamp -- show range if start != end */}
    <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0">
      {timestampEnd && timestampEnd !== timestamp ? `${timestamp} – ${timestampEnd}` : timestamp}
    </span>

    {/* Agent work duration: span from first to last message in the bubble.
        Surfaces real elapsed time even when the timestamp range collapses
        because start and end fall in the same minute. */}
    {durationLabel && (
      <span
        className="text-[10px] text-[var(--text-tertiary)] opacity-70 tabular-nums flex-shrink-0"
        title="Agent work duration: first → last message in this bubble"
      >
        · {durationLabel}
      </span>
    )}
  </div>
  );
};
