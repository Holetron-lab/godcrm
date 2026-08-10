import React from 'react';
import { cn } from '@/shared/utils/cn';
import type { ChatTurnProps, MessageReaction } from './types';
import type { ChatMessage } from '../../../types';
import { formatTime } from './helpers';
import { TurnHeader } from './TurnHeader';
import { TurnBody } from './TurnBody';
import { TurnFooter } from './TurnFooter';
import ChatLinkCard, { type ChatLinkCardMovedBy } from './ChatLinkCard';
import { MovedMessagesPreview } from './MovedMessagesPreview';
import {
  groupMovedSourceStubs,
  groupMovedTarget,
  type MovedGroup,
} from './movedGrouping';

// ADR-0031 §Z / WP-24: pull `moved_by` actor snapshot from a message's
// metadata. Lives on `metadata.moved_to.moved_by` (source stubs) or
// `metadata.moved_from.moved_by` (target rows).
const getMovedBy = (
  message: ChatMessage | undefined,
  side: 'forward' | 'backward',
): ChatLinkCardMovedBy | undefined => {
  if (!message) return undefined;
  const meta = message.metadata as
    | { moved_to?: { moved_by?: ChatLinkCardMovedBy }; moved_from?: { moved_by?: ChatLinkCardMovedBy } }
    | undefined;
  if (!meta) return undefined;
  const branch = side === 'forward' ? meta.moved_to : meta.moved_from;
  return branch?.moved_by;
};

// Pull the full target message-id batch from a source stub's
// metadata.moved_to.message_ids — used to lazy-load the moved messages when
// the user expands the card.
const getMovedToMessageIds = (
  message: ChatMessage | undefined,
): number[] | undefined => {
  if (!message) return undefined;
  const meta = message.metadata as
    | { moved_to?: { message_ids?: unknown } }
    | undefined;
  const raw = meta?.moved_to?.message_ids;
  if (!Array.isArray(raw)) return undefined;
  const ids = raw.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0);
  return ids.length > 0 ? ids : undefined;
};

const AGENT_FALLBACK_COLOR = 'rgb(168, 85, 247)'; // purple-500 — bubble's own left stripe when no agent color

// ADR-0031 §Z / WP-24: ChatLinkCard stripe color reflects the MOVER, not the
// bubble owner. We hash the mover's stable identity (name, falling back to
// user_id) into an HSL hue so the same person always lights up the same color
// across cards. Mirrors the existing ForwardedQuoteBlock hashColor approach.
const MOVER_FALLBACK_COLOR = 'rgb(148, 163, 184)'; // slate-400 — unknown mover
const moverAccentColor = (movedBy: ChatLinkCardMovedBy | undefined): string => {
  const seed = movedBy?.name?.trim()
    || (movedBy?.user_id != null ? `user-${movedBy.user_id}` : '');
  if (!seed) return MOVER_FALLBACK_COLOR;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 65%, 55%)`;
};

export const ChatTurn: React.FC<ChatTurnProps> = React.memo(({
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
  onMove,
  isChatOwner,
  onPin,
  onUnpin,
  canPin,
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
  agentInvocationMode,
  agentChainId,
  isContinuation,
  hasMoreSegments,
  invokedAgents,
  onContinueAgent,
  onStopAgent,
  fetchThinkingSteps,
  fetchToolStepsPreview,
  fetchFullMessage,
  fetchToolSteps,
  isForwarded,
  isMoved,
  isAgentActiveInChat,
  onAgentNameClick,
  senderAvatar,
  onNavigateToConversation,
  isSystemEvent,
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

  const _rawReactableId = primaryMessage?.id ? Number(primaryMessage.id) : null;
  const reactableMessageId = (_rawReactableId != null && !isNaN(_rawReactableId)) ? _rawReactableId : null;

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

  // Agent work duration: span from first to last message in the bubble.
  // Minute-granularity timestamps above can collapse to one number when start
  // and end fall in the same minute, which made bubbles read as "only the
  // final-text time". Showing an explicit duration surfaces the real work span.
  const bubbleDurationMs: number | undefined = (() => {
    if (turnType !== 'agent' || messages.length < 2) return undefined;
    const firstTs = (messages[0] as unknown as { created_at?: string })?.created_at || messages[0]?.timestamp;
    const lastTs = (lastMsg as unknown as { created_at?: string })?.created_at || lastMsg?.timestamp;
    if (!firstTs || !lastTs) return undefined;
    const a = new Date(firstTs as string | Date).getTime();
    const b = new Date(lastTs as string | Date).getTime();
    if (!isFinite(a) || !isFinite(b)) return undefined;
    return Math.max(0, b - a);
  })();

  // Extract token count from metadata if available
  const tokenCount = primaryMessage?.metadata?.usage
    ? (primaryMessage.metadata.usage as { total_tokens?: number }).total_tokens
    : undefined;

  // Extract agent row ID and job ID from agent_status message metadata (for hover tooltip)
  const agentStatusMsg = messages.find(m => m.contentType === 'agent_status');
  const agentRowId = (agentStatusMsg?.metadata as Record<string, unknown>)?.agent_row_id as number | undefined
    || (primaryMessage?.metadata as Record<string, unknown>)?.agent_row_id as number | undefined;
  const jobDbId = (agentStatusMsg?.metadata as Record<string, unknown>)?.job_db_id as number | undefined;

  // Detect incomplete agent turn: has step messages but no final text response
  const hasFinalText = turnType === 'agent' && messages.some(m =>
    (m.contentType === 'text' || !m.contentType) && m.role === 'assistant' && m.content
  );
  const hasSteps = turnType === 'agent' && messages.some(m =>
    m.contentType === 'thinking' || m.contentType === 'tool_call' || m.contentType === 'tool_result'
  );
  const isIncomplete = turnType === 'agent' && !isProcessing && !hasFinalText && hasSteps && !hasMoreSegments;

  // Data attributes for agent chain scroll-to-continue
  const chainDataAttrs: Record<string, string> = {};
  if (agentChainId && isContinuation) {
    chainDataAttrs['data-agent-chain-continuation'] = agentChainId;
  }

  // ADR-0031 §Z / WP-24: extract moved-source / moved-target groups so we can
  // lift their ChatLinkCard(s) to the bubble's header zone (above the divider)
  // — TurnBody no longer renders them inline.
  const movedSourceGroups: MovedGroup[] = React.useMemo(
    () => groupMovedSourceStubs(messages),
    [messages],
  );
  const movedTargetGroups: MovedGroup[] = React.useMemo(
    () => groupMovedTarget(messages),
    [messages],
  );
  const hasMovedHeaderCards =
    movedSourceGroups.length > 0 || movedTargetGroups.length > 0;

  // Source-side bubbles use chevron-toggle to reveal the moved-message preview
  // BELOW the divider (rendered in the body, not inside the card). One state
  // entry per source group, keyed by stub-message-head id (stable across
  // re-renders).
  const [expandedSource, setExpandedSource] = React.useState<Record<string, boolean>>({});
  const toggleSourceExpanded = React.useCallback((key: string) => {
    setExpandedSource(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // The bubble has source-side stubs as its visible message body (current
  // behaviour: TurnBody had a "all-moved → cards only" early-return). With the
  // refactor, the body becomes either empty (collapsed) or the moved-message
  // preview (expanded) — TurnBody is skipped entirely for these turns.
  const isSourceOnlyTurn =
    messages.length > 0 && messages.every(m => m.contentType === 'moved');

  return (
    <div
      className={cn(
        'group relative w-full overflow-hidden',
        isMoved
          ? 'bg-cyan-500/5 ring-1 ring-cyan-500/30'
          : isForwarded
            ? 'bg-orange-500/5 ring-1 ring-orange-500/20'
            : 'bg-[var(--bg-secondary)]',
        // Rounded corners: top only for first, bottom only for last, all for solo
        isFirstInGroup && isLastInGroup && 'rounded-xl border-b border-[var(--border-secondary)]',
        isFirstInGroup && !isLastInGroup && 'rounded-t-xl',
        !isFirstInGroup && isLastInGroup && 'rounded-b-xl border-b border-[var(--border-secondary)]',
        !isFirstInGroup && !isLastInGroup && '',
      )}
      style={turnType === 'agent' ? {
        boxShadow: `inset 4px 0 0 0 ${agentColor || AGENT_FALLBACK_COLOR}`,
        // Square top-left when continuation (broken bubble), round when first in group
        borderTopLeftRadius: isFirstInGroup ? undefined : '0px',
        // Square bottom-left when still processing, interrupted, or not last (broken bubble), round when done
        borderBottomLeftRadius: (isLastInGroup && !isProcessing && !hasMoreSegments) ? undefined : '0px',
      } : undefined}
      {...chainDataAttrs}
    >
      <div className={cn('px-4', isFirstInGroup ? 'pt-3' : 'pt-1', isLastInGroup ? 'pb-3' : 'pb-1')}>
        {/* Header: avatar + name + badge + timestamp -- only for first in group */}
        {isFirstInGroup && (
          <TurnHeader
            turnType={turnType}
            senderName={senderName}
            timestamp={formatTime(messageTime)}
            timestampEnd={messageTimeEnd ? formatTime(messageTimeEnd) : undefined}
            durationMs={bubbleDurationMs}
            isProcessing={isProcessing}
            agentColor={agentColor}
            agentIcon={agentIcon}
            agentInvocationMode={agentInvocationMode}
            tokenCount={tokenCount}
            agentRowId={agentRowId}
            jobDbId={jobDbId}
            isAgentActiveInChat={isAgentActiveInChat}
            onAgentNameClick={onAgentNameClick}
            senderAvatar={senderAvatar}
            isSystemEvent={isSystemEvent}
          />
        )}

        {/* ADR-0031 §Z / WP-24: moved cards live in the header zone (between
            TurnHeader and the bubble divider). Below the divider TurnBody
            renders the message body normally — except for source-only turns
            where the body is the optional expanded preview. */}
        {hasMovedHeaderCards && (
          <div className={cn('space-y-1', isFirstInGroup ? 'mt-3' : 'mt-1')}>
            {movedSourceGroups.map((g, gi) => {
              const key = g.stubMessageIds[0] || `src-${gi}`;
              const messageIds = getMovedToMessageIds(g.stubMessages[0]);
              const canExpand = Array.isArray(messageIds) && messageIds.length > 0;
              const isExpanded = !!expandedSource[key];
              const movedBy = getMovedBy(g.stubMessages[0], 'forward');
              return (
                <ChatLinkCard
                  key={`moved-fwd-${g.conversationId}-${key}`}
                  conversationId={g.conversationId}
                  direction="forward"
                  count={g.count}
                  firstMessageId={g.firstMessageId}
                  movedBy={movedBy}
                  expandable={canExpand}
                  expanded={isExpanded}
                  onExpandToggle={() => toggleSourceExpanded(key)}
                  onClick={(convId, firstMsgId) => onNavigateToConversation?.(convId, firstMsgId)}
                  accentColor={moverAccentColor(movedBy)}
                />
              );
            })}
            {movedTargetGroups.map((g, gi) => {
              const head = g.targetMessages[0];
              const key = head?.id ? String(head.id) : `tgt-${gi}`;
              const movedBy = getMovedBy(head, 'backward');
              return (
                <ChatLinkCard
                  key={`moved-back-${g.conversationId}-${key}`}
                  conversationId={g.conversationId}
                  direction="backward"
                  count={g.count}
                  firstMessageId={g.firstMessageId}
                  movedBy={movedBy}
                  onClick={(convId, firstMsgId) => onNavigateToConversation?.(convId, firstMsgId)}
                  accentColor={moverAccentColor(movedBy)}
                />
              );
            })}
          </div>
        )}

        {/* Bubble divider — sits between header zone (TurnHeader + moved cards)
            and the message body. */}
        {(isFirstInGroup || hasMovedHeaderCards) && (
          <div className="border-b border-[var(--border-secondary)] mb-3 mt-3" />
        )}

        {/* Body. Source-only turns have nothing to render unless the user
            expanded a card → render the moved-message preview instead of
            TurnBody. Mixed and target turns render normally; TurnBody is told
            to skip the moved-stub messages it would otherwise paint. */}
        {isSourceOnlyTurn ? (
          <>
            {movedSourceGroups.map((g, gi) => {
              const key = g.stubMessageIds[0] || `src-${gi}`;
              const messageIds = getMovedToMessageIds(g.stubMessages[0]);
              if (!expandedSource[key] || !messageIds) return null;
              return (
                <MovedMessagesPreview
                  key={`preview-${g.conversationId}-${key}`}
                  conversationId={g.conversationId}
                  messageIds={messageIds}
                />
              );
            })}
          </>
        ) : (
          <TurnBody
            messages={messages}
            turnType={turnType}
            markdownEnabled={markdownEnabled}
            isProcessing={isProcessing}
            hasMoreSegments={hasMoreSegments}
            invokedAgents={invokedAgents}
            onCheckboxClick={onCheckboxClick}
            currentUser={currentUser}
            onOpenTerminal={onOpenTerminal}
            onMentionClick={onMentionClick}
            onForward={onForward}
            conversationId={conversationId}
            onToolApprove={onToolApprove}
            onToolReject={onToolReject}
            fetchThinkingSteps={fetchThinkingSteps}
            fetchToolStepsPreview={fetchToolStepsPreview}
            fetchFullMessage={fetchFullMessage}
            fetchToolSteps={fetchToolSteps}
            onContinueAgent={onContinueAgent}
            onNavigateToConversation={onNavigateToConversation}
          />
        )}

        {/* Footer: reactions + context actions -- always show for interaction */}
        <TurnFooter
          reactableMessageId={reactableMessageId}
          reactionList={reactionList}
          quickEmojis={quickEmojis}
          onReact={onReact}
          onCopy={onCopy}
          onForward={onForward}
          onMove={onMove}
          isChatOwner={isChatOwner}
          onPin={onPin}
          onUnpin={onUnpin}
          canPin={canPin}
          onDelete={onDelete}
          primaryMessage={primaryMessage || null}
          allMessages={messages}
          turnType={turnType}
          currentUserId={currentUserId}
          onContinueAgent={onContinueAgent}
          onStopAgent={onStopAgent}
          isProcessing={isProcessing}
          isIncomplete={isIncomplete}
          agentRowId={agentRowId}
          jobDbId={jobDbId}
        />
      </div>
    </div>
  );
});
