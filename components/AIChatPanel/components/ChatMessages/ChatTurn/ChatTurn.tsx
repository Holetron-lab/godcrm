import React from 'react';
import { cn } from '@/shared/utils/cn';
import type { ChatTurnProps, MessageReaction } from './types';
import { formatTime } from './helpers';
import { TurnHeader } from './TurnHeader';
import { TurnBody } from './TurnBody';
import { TurnFooter } from './TurnFooter';

export const ChatTurn: React.FC<ChatTurnProps> = ({
  messages,
  turnType,
  senderName,
  markdownEnabled = true,
  isProcessing = false,
  currentUserId,
  reactions = {},
  quickEmojis = ['\uD83D\uDC4D', '\u2764\uFE0F', '\uD83D\uDE02', '\uD83D\uDE2E', '\uD83D\uDE22', '\uD83D\uDE4F'],
  onReact,
  onCopy,
  onForward,
  onDelete,
  onCheckboxClick,
  currentUser,
  onMentionClick,
  onOpenTerminal,
  isFirstInGroup = true,
  isLastInGroup = true,
  conversationId,
  onToolApprove,
  onToolReject,
  agentColor,
  agentIcon,
  agentChainId,
  isContinuation,
  onContinueAgent,
  fetchToolSteps,
}) => {
  // Determine the "primary" message -- for human it's the single message,
  // for agent it's the final text message or the last message in the group.
  const primaryMessage =
    turnType === 'human'
      ? messages[0]
      : messages.find(
          (m) =>
            (m.contentType === 'text' || !m.contentType) &&
            m.role === 'assistant'
        ) || messages[messages.length - 1];

  const reactableMessageId = primaryMessage?.id
    ? Number(primaryMessage.id)
    : null;

  // Process reactions
  const reactionList: MessageReaction[] = Object.entries(reactions).map(
    ([emoji, users]) => ({
      emoji,
      users,
      hasMyReaction: users.some((u) => u.user_id === currentUserId),
    })
  );

  // Timestamp from first message (start of turn)
  const messageTime =
    (messages[0] as unknown as { created_at?: string })?.created_at ||
    messages[0]?.timestamp;

  // Timestamp from last message (end of turn) -- for time range display
  const lastMsg = messages[messages.length - 1];
  const messageTimeEnd = messages.length > 1
    ? ((lastMsg as unknown as { created_at?: string })?.created_at || lastMsg?.timestamp)
    : undefined;

  // Extract token count from metadata if available
  const tokenCount = primaryMessage?.metadata?.usage
    ? (primaryMessage.metadata.usage as { total_tokens?: number }).total_tokens
    : undefined;

  // Data attributes for agent chain scroll-to-continue
  const chainDataAttrs: Record<string, string> = {};
  if (agentChainId && isContinuation) {
    chainDataAttrs['data-agent-chain-continuation'] = agentChainId;
  }

  return (
    <div
      className={cn(
        'group relative w-full bg-[var(--bg-secondary)]',
        // Rounded corners: top only for first, bottom only for last, all for solo
        isFirstInGroup && isLastInGroup && 'rounded-xl border-b border-[var(--border-secondary)]',
        isFirstInGroup && !isLastInGroup && 'rounded-t-xl',
        !isFirstInGroup && isLastInGroup && 'rounded-b-xl border-b border-[var(--border-secondary)]',
        !isFirstInGroup && !isLastInGroup && '',
      )}
      {...chainDataAttrs}
    >
      <div className={cn('px-4', isFirstInGroup ? 'pt-3' : 'pt-1', isLastInGroup ? 'pb-3' : 'pb-1')}>
        {/* Header: avatar + name + badge + timestamp -- only for first in group */}
        {isFirstInGroup && (
          <>
            <TurnHeader
              turnType={turnType}
              senderName={senderName}
              timestamp={formatTime(messageTime)}
              timestampEnd={messageTimeEnd ? formatTime(messageTimeEnd) : undefined}
              isProcessing={isProcessing}
              agentColor={agentColor}
              agentIcon={agentIcon}
              tokenCount={tokenCount}
            />

            {/* Separator */}
            <div className="border-b border-[var(--border-secondary)] mb-3" />
          </>
        )}

        {/* Body: tool steps + message content + attachments */}
        <TurnBody
          messages={messages}
          turnType={turnType}
          markdownEnabled={markdownEnabled}
          isProcessing={isProcessing}
          onCheckboxClick={onCheckboxClick}
          currentUser={currentUser}
          onOpenTerminal={onOpenTerminal}
          onMentionClick={onMentionClick}
          conversationId={conversationId}
          onToolApprove={onToolApprove}
          onToolReject={onToolReject}
          fetchToolSteps={fetchToolSteps}
        />

        {/* Footer: reactions + context actions -- always show for interaction */}
        <TurnFooter
          reactableMessageId={reactableMessageId}
          reactionList={reactionList}
          quickEmojis={quickEmojis}
          onReact={onReact}
          onCopy={onCopy}
          onForward={onForward}
          onDelete={onDelete}
          primaryMessage={primaryMessage || null}
          turnType={turnType}
          currentUserId={currentUserId}
          onContinueAgent={onContinueAgent}
        />
      </div>
    </div>
  );
};
