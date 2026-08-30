/**
 * MessagesArea — Chat messages display with infinite scroll.
 * ADR-119: Extracted from AIChatPanel.tsx JSX.
 */

import React, { useMemo, memo } from 'react';
import {
  Bot, User, Users, MessageSquare, Loader2, AlertCircle, ArrowDown
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { ChatTurn } from './ChatMessages/ChatTurn';
import { ProcessingStatusBar, type ProcessingActiveAgent } from './ProcessingStatusBar';
import { groupMessagesIntoTurns } from '../../../utils/groupMessagesIntoTurns';
import type { ChatMessage } from '../../../types';
import type { CheckboxClickInfo } from '@/shared/components/MarkdownPreview';

interface ChatPartner {
  type: 'agent' | 'user' | 'group';
  id: number;
  name: string;
  icon?: string;
}

interface MessagesAreaProps {
  chatMode: 'ai' | 'people';
  chatPartner: ChatPartner | null;
  displayMessages: ChatMessage[];
  markdownEnabled: boolean;
  isAgentProcessing: boolean;
  processingAgentName: string | undefined | null;
  /** Epoch ms when processing began — ProcessingStatusBar owns the tick. */
  processingStartedAt: number | null | undefined;
  /** ADR-0057-A WP-A: backend's `active_agents[]`; when 2+ entries, the
   *  status bar switches to multi-agent rows keyed by agent_user_id. */
  activeAgents?: ProcessingActiveAgent[];
  stopAgent: () => void;
  messageReactions: Record<number, Record<string, { user_id: number; user_name: string }[]>>;
  quickEmojis: string[];
  currentUserId: number | undefined;
  currentUser: { name: string; id: number } | undefined;
  // Handlers
  onReact: (messageId: number, emoji: string) => void;
  onCopy: (message: ChatMessage) => void;
  onForward: (message: ChatMessage) => void;
  /** ADR-0031 WP-24: open MoveMessageModal for the given message (chat-owner only) */
  onMove?: (message: ChatMessage) => void;
  /** ADR-0031 WP-24: current user owns this conversation; controls visibility of «Перенести» */
  isChatOwner?: boolean;
  /** ADR-0068 WP-E — pin/unpin handlers passed through to TurnFooter. */
  onPin?: (messageId: number) => void;
  onUnpin?: (messageId: number) => void;
  /** ADR-0068 WP-E — true when current user may pin in this chat. Footer
   *  hides the icon entirely when false. */
  canPin?: boolean;
  onDelete: (messageId: number) => void;
  onCheckboxClick: (info: CheckboxClickInfo) => void;
  onMentionClick: (token: string) => void;
  onOpenTerminal: (sessionId?: number) => void;
  onContinueAgent?: (senderName: string) => void;
  sendMessage: (...args: any[]) => void;
  currentAgent: { name?: string } | null;
  setInputValue?: (v: string | ((prev: string) => string)) => void;
  // Scroll
  messagesEndRef: React.RefObject<HTMLDivElement>;
  messagesContainerRef: React.RefObject<HTMLDivElement>;
  loadMoreSentinelRef: React.RefObject<HTMLDivElement>;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  isMobile: boolean;
  setActivePanel: (v: 'contacts' | 'none') => void;
  // Infinite scroll state
  hasOlderMessages: boolean;
  isFetchingOlderMessages: boolean;
  hasNextAIPage: boolean;
  isFetchingNextAIPage: boolean;
  // Scroll-to-bottom
  showScrollToBottom: boolean;
  setShowScrollToBottom: (v: boolean) => void;
  newMessageCount: number;
  setNewMessageCount: (v: number | ((p: number) => number)) => void;
  agentWorking: boolean;
  setAgentWorking: (v: boolean) => void;
  // Polling error
  activePollingError: string | null | undefined;
  activePollingStopped: boolean | undefined;
  activeReconnect: (() => void) | undefined;
  // Errors
  error: string | null | undefined;
  localError: string | null;
  // Loading state — show spinner instead of empty state while messages load
  isLoadingMessages?: boolean;
  // Progressive lazy loading (4-tier)
  fetchThinkingSteps?: (afterId: number, beforeId: number) => Promise<ChatMessage[]>;
  fetchToolStepsPreview?: (afterId: number, beforeId: number) => Promise<ChatMessage[]>;
  fetchFullMessage?: (messageId: number) => Promise<{ id: number; content: string; content_type: string } | null>;
  fetchToolSteps?: (afterId: number, beforeId: number) => Promise<ChatMessage[]>;
  // Forward highlight
  forwardMessageIds?: Set<number>;
  // Move highlight (cyan)
  moveMessageIds?: Set<number>;
  // Forward messages (for continue agent)
  setForwardMessages?: (v: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  /** ADR-0031 §Z / WP-24: ChatLinkCard click — open another conversation. */
  onNavigateToConversation?: (conversationId: number, firstMessageId?: number) => void;
  /** ADR-185 — active conversation id, threaded to ChatTurn so the per-message
   *  translate mutation patches the right `['conversation-messages', id]` cache.
   *  Without it ChatTurn saw `undefined` and the translation landed on a phantom
   *  cache key → server persisted it (success toast) but the body never updated. */
  conversationId?: number | null;
}

function MessagesAreaImpl(props: MessagesAreaProps) {
  const {
    chatMode, chatPartner, displayMessages, markdownEnabled, isAgentProcessing,
    processingAgentName, processingStartedAt, activeAgents, stopAgent, messageReactions, quickEmojis,
    currentUserId, currentUser, onReact, onCopy, onForward, onMove, isChatOwner,
    onPin, onUnpin, canPin, onDelete,
    onCheckboxClick, onMentionClick, onOpenTerminal, sendMessage, currentAgent,
    messagesEndRef, messagesContainerRef, loadMoreSentinelRef,
    dragOver, setDragOver, onDrop, isMobile, setActivePanel,
    hasOlderMessages, isFetchingOlderMessages, hasNextAIPage, isFetchingNextAIPage,
    showScrollToBottom, setShowScrollToBottom, newMessageCount, setNewMessageCount,
    agentWorking, setAgentWorking,
    activePollingError, activePollingStopped, activeReconnect,
    error, localError, fetchThinkingSteps, fetchToolStepsPreview, fetchFullMessage, fetchToolSteps,
    isLoadingMessages, forwardMessageIds, moveMessageIds, setInputValue, setForwardMessages,
    onNavigateToConversation, conversationId,
  } = props;

  const isUserOrGroup = chatPartner?.type === 'user' || chatPartner?.type === 'group';
  const isAgent = chatPartner?.type === 'agent';
  const hasMore = isUserOrGroup ? hasOlderMessages : (isAgent ? !!hasNextAIPage : false);
  const isLoadingOlder = isUserOrGroup ? isFetchingOlderMessages : (isAgent ? isFetchingNextAIPage : false);

  // Memoize turn grouping — only recomputes when messages, reactions,
  // processing state, or user changes.
  const turns = useMemo(
    () => groupMessagesIntoTurns(displayMessages, messageReactions, isAgentProcessing, currentUserId),
    [displayMessages, messageReactions, isAgentProcessing, currentUserId]
  );

  // Perf: the per-agent-turn "continue" / "name-click" handlers used to be
  // inline closures rebuilt on every render of this component. Because this
  // component re-renders on every keystroke in the chat input (input state
  // lives up in useAIChatPanelLogic), those fresh closures defeated ChatTurn's
  // React.memo — every heavy agent bubble re-rendered on each keypress, which
  // is the typing lag in long agent chats. Hoisting them into a Map keyed by
  // turn.id makes the refs stable across keystrokes (only changes when `turns`
  // or the stable setters change), so ChatTurn bails out of re-render.
  const agentTurnHandlers = useMemo(() => {
    const map = new Map<string, { onContinueAgent: () => void; onAgentNameClick: () => void }>();
    for (const turn of turns) {
      if (turn.turnType !== 'agent') continue;
      const slug = turn.senderName.toLowerCase().replace(/\s+/g, '-');
      const turnMessages = turn.messages;
      const turnSenderName = turn.senderName;
      const turnAgentColor = turn.agentColor;
      map.set(turn.id, {
        onContinueAgent: () => {
          // Add last message as forwarded (repost) via existing forward strip
          if (setForwardMessages) {
            const finalText = [...turnMessages].reverse().find(m =>
              (m.contentType === 'text' || !m.contentType) && m.role === 'assistant' && m.content
            );
            const lastThinking = [...turnMessages].reverse().find(m => m.contentType === 'thinking' && m.content);
            const source = finalText || lastThinking;
            if (source) {
              setForwardMessages(prev => prev.some(m => m.id === source.id) ? prev : [...prev, {
                ...source,
                sender_name: turnSenderName,
                agent_color: turnAgentColor,
              }]);
            }
          }
          if (setInputValue) {
            setInputValue((prev: string) => prev ? prev : `<<@${slug}>> `);
          } else {
            sendMessage(`<<@${slug}>> continue`, undefined, undefined, undefined, true);
          }
        },
        onAgentNameClick: () => {
          if (setInputValue) {
            setInputValue((prev: string) => prev ? `${prev}<<@${slug}>> ` : `<<@${slug}>> `);
          }
        },
      });
    }
    return map;
  }, [turns, setForwardMessages, setInputValue, sendMessage]);

  return (
    <>
      {/* Messages scroll container */}
      <div
        ref={messagesContainerRef}
        className={cn(
          'flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 min-h-0 overscroll-contain [overflow-anchor:none]',
          'flex flex-col',
          isMobile && 'touch-pan-y',
          displayMessages.length === 0 && 'items-center justify-center',
          dragOver && 'bg-[var(--color-primary-500)]/5 ring-2 ring-inset ring-[var(--color-primary-500)]/50'
        )}
        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y', overscrollBehavior: 'contain', overflowAnchor: 'none' as never }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
       <div className="w-full mt-auto">
        {chatMode === 'people' && (!chatPartner || chatPartner.type === 'agent') && displayMessages.length === 0 ? (
          <div className="text-center px-6">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500/20 to-green-500/20 flex items-center justify-center mb-4 mx-auto">
              <Users className="w-10 h-10 text-blue-400" />
            </div>
            <h3 className="font-medium text-[var(--text-primary)] mb-2">Выберите собеседника</h3>
            <p className="text-sm text-[var(--text-tertiary)] mb-4">Выберите контакт из списка для начала разговора</p>
            <button onClick={() => setActivePanel('contacts')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors">
              <Users className="w-4 h-4" />Открыть контакты
            </button>
          </div>
        ) : displayMessages.length === 0 ? (
          (isLoadingMessages || isAgentProcessing) ? (
            <div className="text-center px-6">
              <Loader2 className="w-8 h-8 animate-spin text-[var(--color-primary-500)] mx-auto mb-3" />
              <p className="text-sm text-[var(--text-tertiary)]">{isAgentProcessing ? 'Агент работает...' : 'Загрузка сообщений...'}</p>
            </div>
          ) : (
            <div className="text-center px-6">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500/20 to-primary-500/20 flex items-center justify-center mb-4 mx-auto">
                {chatPartner?.type === 'agent' ? <Bot className="w-8 h-8 text-[var(--color-primary-500)]" /> :
                 chatPartner?.type === 'user' ? <User className="w-8 h-8 text-blue-400" /> :
                 chatPartner?.type === 'group' ? <Users className="w-8 h-8 text-green-400" /> :
                 <MessageSquare className="w-8 h-8 text-[var(--text-tertiary)]" />}
              </div>
              <h3 className="font-medium text-[var(--text-primary)] mb-2">Начните разговор</h3>
              <p className="text-sm text-[var(--text-tertiary)]">
                {chatPartner ? `Чат с ${chatPartner.name}` : 'Выберите собеседника из контактов или AI агентов'}
              </p>
            </div>
          )
        ) : (
          <div className="space-y-4">
            {/* Infinite scroll sentinel */}
            <div ref={loadMoreSentinelRef} className="flex justify-center" style={{ minHeight: hasMore ? 40 : 1 }}>
              {hasMore && isLoadingOlder ? (
                <div className="inline-flex items-center gap-2 px-4 py-2 text-xs text-[var(--text-tertiary)]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Loading older messages...</span>
                </div>
              ) : hasMore ? (
                <div className="py-2 text-xs text-[var(--text-quaternary)]">↑ Scroll up for older messages</div>
              ) : null}
            </div>

            {turns.map((turn) => (
              <ChatTurn
                key={turn.id}
                messages={turn.messages}
                turnType={turn.turnType}
                senderName={turn.senderName}
                markdownEnabled={markdownEnabled}
                isProcessing={turn.isProcessing}
                currentUserId={currentUserId}
                reactions={turn.reactions}
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
                onCheckboxClick={onCheckboxClick}
                currentUser={currentUser}
                onMentionClick={onMentionClick}
                onOpenTerminal={onOpenTerminal}
                isFirstInGroup={turn.isFirstInGroup}
                isLastInGroup={turn.isLastInGroup}
                agentColor={turn.agentColor}
                agentIcon={typeof turn.agentIcon === 'string' && turn.agentIcon !== 'NaN' ? turn.agentIcon : undefined}
                agentChainId={turn.agentChainId}
                isContinuation={turn.isContinuation}
                hasMoreSegments={turn.hasMoreSegments}
                isAgentActiveInChat={turn.isAgentActiveInChat}
                senderAvatar={turn.senderAvatar}
                onContinueAgent={turn.turnType === 'agent' ? agentTurnHandlers.get(turn.id)?.onContinueAgent : undefined}
                onAgentNameClick={turn.turnType === 'agent' ? agentTurnHandlers.get(turn.id)?.onAgentNameClick : undefined}
                onStopAgent={turn.turnType === 'agent' && turn.isProcessing ? stopAgent : undefined}
                fetchThinkingSteps={fetchThinkingSteps}
                fetchToolStepsPreview={fetchToolStepsPreview}
                fetchFullMessage={fetchFullMessage}
                fetchToolSteps={fetchToolSteps}
                isForwarded={forwardMessageIds ? turn.messages.some(m => m.id && forwardMessageIds.has(m.id)) : false}
                isMoved={moveMessageIds ? turn.messages.some(m => m.id && moveMessageIds.has(m.id)) : false}
                onNavigateToConversation={onNavigateToConversation}
                conversationId={conversationId ?? undefined}
              />
            ))}

            {/* Processing status bar — owns its own 1Hz tick so it does not
                invalidate the whole MessagesArea on every elapsed second. */}
            <ProcessingStatusBar
              isAgentProcessing={isAgentProcessing}
              processingAgentName={processingAgentName}
              processingStartedAt={processingStartedAt}
              activeAgents={activeAgents}
              stopAgent={stopAgent}
            />
            <div ref={messagesEndRef} />
          </div>
        )}
       </div>
      </div>

      {/* Scroll-to-bottom arrow */}
      {showScrollToBottom && (
        <div className="absolute bottom-4 right-4 z-20 flex flex-col items-end gap-1.5">
          {agentWorking && newMessageCount === 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--bg-primary)] border border-[var(--border-primary)] shadow-lg text-[var(--text-secondary)] text-[11px]">
              <Loader2 className="w-3 h-3 animate-spin text-[var(--color-primary-500)]" /><span>Agent working…</span>
            </div>
          )}
          <button onClick={() => { const c = messagesContainerRef.current; if (c) c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' }); setShowScrollToBottom(false); setNewMessageCount(0); setAgentWorking(false); }}
            className="w-9 h-9 rounded-full bg-[var(--bg-primary)] border border-[var(--border-primary)] shadow-lg flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-all"
            title={newMessageCount > 0 ? `${newMessageCount} new message${newMessageCount > 1 ? 's' : ''}` : 'Scroll to bottom'}>
            <ArrowDown className="w-4 h-4" />
            {newMessageCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--color-primary-500)] text-white text-[10px] font-bold flex items-center justify-center leading-none">
                {newMessageCount > 99 ? '99+' : newMessageCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Polling connection error banner */}
      {activePollingError && (
        <div className="px-4 py-2 bg-yellow-500/10 border-t border-yellow-500/30">
          <div className="flex items-center justify-between text-sm text-yellow-400">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /><span>{activePollingError}</span>
            </div>
            {activePollingStopped && (
              <button onClick={activeReconnect}
                className="px-3 py-1 rounded text-xs font-medium bg-yellow-500/20 hover:bg-yellow-500/30 transition-colors">
                Reconnect
              </button>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {(error || localError) && (
        <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/30">
          <div className="flex items-center gap-2 text-sm text-red-400">
            <AlertCircle className="w-4 h-4" /><span>{error || localError}</span>
          </div>
        </div>
      )}
    </>
  );
}

export const MessagesArea = memo(MessagesAreaImpl);
