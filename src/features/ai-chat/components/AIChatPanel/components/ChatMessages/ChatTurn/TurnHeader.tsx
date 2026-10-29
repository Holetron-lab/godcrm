import { useLanguage } from '@/shared/i18n/LanguageContext';
import React, { useContext } from 'react';
import { HumanChatPresenceContext } from '@/features/ai-chat/hooks/useHumanChatPresence';
import { Bot, Cpu, User, Zap } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Avatar } from '@/shared/components/ui/Avatar';
import { MentionTooltip } from '../../../../MentionTooltip';
import { useMentionUsers } from '../../../../MentionUsersContext';
import type { TurnHeaderProps } from './types';

export const TurnHeader: React.FC<TurnHeaderProps> = ({
  turnType,
  senderName,
  timestamp,
  timestampEnd,
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
  senderUserId,
  conversationId,
  isSystemEvent,
}) => {
  const { t } = useLanguage();
  const presence = useContext(HumanChatPresenceContext);
  const presenceKnown = presence.known && presence.conversationId === conversationId;
  const humanOnline = presenceKnown && senderUserId != null && presence.onlineUserIds.has(Number(senderUserId));
  const humanStatus = t(humanOnline ? 'aiChat.ui.humanOnlineInChat' : presenceKnown ? 'aiChat.ui.humanAwayFromChat' : 'aiChat.ui.humanPresenceUnknown');
  const { getByUserId, getByAgentId } = useMentionUsers();
  const identity = (senderUserId != null ? getByUserId(senderUserId) : null)
    || (turnType === 'agent' && agentRowId != null ? getByAgentId(agentRowId) : null);
  const senderInfo = identity || {
    userId: senderUserId, name: senderName, type: turnType === 'agent' ? 'agent' as const : 'user' as const,
    icon: agentIcon, color: agentColor, avatar: senderAvatar,
  };
  // ⚡ Zap for slash-command agents (`<</slug>>`), 🤖 Bot for @-mention agents.
  // `both` defaults to Bot (mention is the legacy/primary path).
  const AgentRoleIcon = agentInvocationMode === 'command' ? Zap : Bot;
  // Show green dot if this turn is processing OR if the same agent is active elsewhere in chat
  const showGreenDot = isProcessing || isAgentActiveInChat;
  // Message enrichment may supply an uploaded avatar in agent_icon.
  const icon = turnType === 'agent' ? (agentIcon || identity?.icon)?.trim() : undefined;
  const iconIsImage = !!icon && /^(\/|https?:\/\/|data:)/.test(icon);
  return (
  <div className="flex items-center gap-2 mb-2">
    {/* Avatar + system-event overlay. The wrapper is `relative` so the
        microchip badge in the bottom-right corner anchors to the avatar. */}
    <MentionTooltip info={senderInfo}>
    <button type="button" aria-label={`${senderName} — ${t(turnType === 'agent' ? 'aiChat.ui.agent' : 'aiChat.ui.user')}`} className="relative w-7 h-7 flex-shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
      {turnType === 'agent' || (senderName && senderName !== 'AI') ? (
        <Avatar
          url={senderAvatar || identity?.avatar || (iconIsImage ? icon : undefined)}
          emoji={iconIsImage ? null : icon}
          name={senderName}
          color={turnType === 'agent' ? (agentColor || identity?.color) : (turnType === 'human' ? '#3b82f6' : '#a855f7')}
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
          title={t('aiChat.ui.messageSentByTheSystemOnBehalfOfTheUser')}
        >
          <Cpu className="w-2.5 h-2.5" />
        </span>
      )}
    </button>
    </MentionTooltip>

    {/* Status dot: green pulsing = this turn processing, green solid = agent active elsewhere, grey = idle */}
    {turnType === 'agent' && (
      <span
        className="relative flex h-2.5 w-2.5 flex-shrink-0"
        title={[
          isProcessing ? t('aiChat.ui.agentIsWorking') : isAgentActiveInChat ? t('aiChat.ui.agentIsActive') : t('aiChat.ui.agentIsInactive'),
          agentRowId ? t('aiChat.ui.agentNumber', { id: agentRowId }) : '',
          jobDbId ? t('aiChat.ui.jobNumber', { id: jobDbId }) : '',
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

    {turnType === 'human' && (
      <span role="img" aria-label={humanStatus} title={humanStatus} className={cn('h-2.5 w-2.5 flex-shrink-0 rounded-full', humanOnline ? 'bg-green-500' : 'bg-[var(--text-tertiary)]')} />
    )}

    {/* Sender name — clickable for agents to insert mention */}
    {turnType === 'agent' && onAgentNameClick ? (
      <button
        onClick={onAgentNameClick}
        className="text-sm font-medium text-[var(--text-primary)] truncate hover:underline hover:text-[var(--color-primary-500)] transition-colors cursor-pointer"
        title={t('aiChat.ui.mentionSender', { name: senderName })}
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
      title={isSystemEvent ? t('aiChat.ui.systemMessage') : undefined}
    >
      {isSystemEvent ? (
        <>
          <Cpu className="w-3 h-3" />
          <span>{t('aiChat.ui.systemLower')}</span>
        </>
      ) : turnType === 'human' ? (
        <User className="w-3 h-3" />
      ) : (
        <AgentRoleIcon className="w-3 h-3" />
      )}
    </span>

    {/* Token count */}
    {tokenCount != null && tokenCount > 0 && (
      <span className="text-[10px] text-[var(--text-secondary)] flex-shrink-0 tabular-nums">
        {t('aiChat.ui.tokensCount', { count: tokenCount.toLocaleString() })}
      </span>
    )}

    {/* Spacer */}
    <span className="flex-1" />

    {/* Timestamp — span of the whole bubble: first message → last message.
        Collapses to a single time when both fall in the same minute. */}
    <span className="text-[10px] text-[var(--text-secondary)] flex-shrink-0">
      {timestampEnd && timestampEnd !== timestamp ? `${timestamp} – ${timestampEnd}` : timestamp}
    </span>
  </div>
  );
};
