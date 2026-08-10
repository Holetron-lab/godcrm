/**
 * MessagesArea — Chat messages display with infinite scroll.
 * ADR-119: Extracted from AIChatPanel.tsx JSX.
 */

import React from 'react';
import {
  Bot, User, Users, MessageSquare, Loader2, AlertCircle, Square, ArrowDown
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { ChatTurn } from './ChatMessages/ChatTurn';
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
  processingElapsed: number;
  stopAgent: () => void;
  messageReactions: Record<number, Record<string, { user_id: number; user_name: string }[]>>;
  quickEmojis: string[];
  currentUserId: number | undefined;
  currentUser: { name: string; id: number } | undefined;
  // Handlers
  onReact: (messageId: number, emoji: string) => void;
  onCopy: (message: ChatMessage) => void;
  onForward: (message: ChatMessage) => void;
  onDelete: (messageId: number) => void;
  onCheckboxClick: (info: CheckboxClickInfo) => void;
  onMentionClick: (token: string) => void;
  onOpenTerminal: (sessionId?: number) => void;
  onContinueAgent?: (senderName: string) => void;
  sendMessage: (...args: any[]) => void;
  currentAgent: { name?: string } | null;
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
  // Lazy tool loading
  fetchToolSteps?: (afterId: number, beforeId: number) => Promise<ChatMessage[]>;
}

export function MessagesArea(props: MessagesAreaProps) {
  const {
    chatMode, chatPartner, displayMessages, markdownEnabled, isAgentProcessing,
    processingAgentName, processingElapsed, stopAgent, messageReactions, quickEmojis,
    currentUserId, currentUser, onReact, onCopy, onForward, onDelete,
    onCheckboxClick, onMentionClick, onOpenTerminal, sendMessage, currentAgent,
    messagesEndRef, messagesContainerRef, loadMoreSentinelRef,
    dragOver, setDragOver, onDrop, isMobile, setActivePanel,
    hasOlderMessages, isFetchingOlderMessages, hasNextAIPage, isFetchingNextAIPage,
    showScrollToBottom, setShowScrollToBottom, newMessageCount, setNewMessageCount,
    agentWorking, setAgentWorking,
    activePollingError, activePollingStopped, activeReconnect,
    error, localError, fetchToolSteps,
  } = props;

  const isUserOrGroup = chatPartner?.type === 'user' || chatPartner?.type === 'group';
  const isAgent = chatPartner?.type === 'agent';
  const hasMore = isUserOrGroup ? hasOlderMessages : (isAgent ? !!hasNextAIPage : false);
  const isLoadingOlder = isUserOrGroup ? isFetchingOlderMessages : (isAgent ? isFetchingNextAIPage : false);

  return (
    <>
      {/* Messages scroll container */}
      <div
        ref={messagesContainerRef}
        className={cn(
          'flex-1 overflow-y-auto px-4 py-4 min-h-0 overscroll-contain',
          isMobile && 'touch-pan-y',
          displayMessages.length === 0 && 'flex items-center justify-center',
          dragOver && 'bg-[var(--color-primary-500)]/5 ring-2 ring-inset ring-[var(--color-primary-500)]/50'
        )}
        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y', overscrollBehavior: 'contain' }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {chatMode === 'people' && (!chatPartner || chatPartner.type === 'agent') ? (
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

            {groupMessagesIntoTurns(displayMessages, messageReactions, isAgentProcessing, currentUserId).map((turn) => (
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
                onDelete={onDelete}
                onCheckboxClick={onCheckboxClick}
                currentUser={currentUser}
                onMentionClick={(token) => onMentionClick(token)}
                onOpenTerminal={onOpenTerminal}
                isFirstInGroup={turn.isFirstInGroup}
                isLastInGroup={turn.isLastInGroup}
                onContinueAgent={turn.turnType === 'agent' && currentAgent ? () => {
                  const slug = turn.senderName.toLowerCase().replace(/\s+/g, '-');
                  sendMessage(`<<@${slug}>> continue`, undefined, undefined, undefined, true);
                } : undefined}
                fetchToolSteps={fetchToolSteps}
              />
            ))}

            {/* Processing status bar */}
            {isAgentProcessing && (
              <div className={cn(
                "flex items-center justify-between px-4 py-1.5 text-xs",
                processingElapsed >= 600 ? "bg-yellow-500/10 border-t border-yellow-500/30 text-yellow-400" : "text-[var(--text-tertiary)]"
              )}>
                <div className="flex items-center gap-2">
                  {processingElapsed >= 600 ? <AlertCircle className="w-3.5 h-3.5" /> : <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-primary-500)]" />}
                  <span>{processingAgentName || 'AI'}{processingElapsed >= 1500 ? ' — возможно завис' : processingElapsed >= 600 ? ' — работает давно' : ''}</span>
                  {processingElapsed > 0 && (
                    <span className="opacity-70 tabular-nums">
                      {processingElapsed >= 60 ? `${Math.floor(processingElapsed / 60)}m ${processingElapsed % 60}s` : `${processingElapsed}s`}
                    </span>
                  )}
                </div>
                <button onClick={stopAgent}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 transition-colors" title="Остановить агента">
                  <Square className="w-3 h-3 fill-current" /><span>Стоп</span>
                </button>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Scroll-to-bottom arrow */}
      {showScrollToBottom && (
        <div className="absolute bottom-4 right-4 z-20 flex flex-col items-end gap-1.5">
          {agentWorking && newMessageCount === 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--bg-primary)] border border-[var(--border-primary)] shadow-lg text-[var(--text-secondary)] text-[11px]">
              <Loader2 className="w-3 h-3 animate-spin text-[var(--color-primary-500)]" /><span>Agent working…</span>
            </div>
          )}
          <button onClick={() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); setShowScrollToBottom(false); setNewMessageCount(0); setAgentWorking(false); }}
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
