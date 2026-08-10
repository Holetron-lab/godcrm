import React, { useMemo } from 'react';
import { Users, Bot, User, MessageSquare, AlertCircle, X } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { getFileIcon } from '@/shared/utils/fileHelpers';
// @deprecated — use ChatTurn instead
import { MessageBubble } from './MessageBubble';
// @deprecated — use ChatTurn instead
import { AgentStepsBubble } from './AgentStepsBubble';
import { ChatTurn } from './ChatTurn';
import { AgentChainConnector } from './AgentChainConnector';
import { AgentChainDivider } from './AgentChainDivider';
import { groupMessagesIntoTurns } from '../../../../utils/groupMessagesIntoTurns';
import type { Turn } from '../../../../utils/groupMessagesIntoTurns';
import type { ChatMessage, ChatPartner } from '../../types';
import type { CheckboxClickInfo, CheckboxUser } from '@/shared/components/MarkdownPreview';
import { useHideSystemEvents } from '../../hooks/useHideSystemEvents';
import { useAIChat } from '../../../../context/AIChatContext';

// --- Message grouping logic ---

// @deprecated — use Turn from groupMessagesIntoTurns instead
interface MessageGroup {
  type: 'single' | 'agent_steps';
  messages: ChatMessage[];
}

// @deprecated — use groupMessagesIntoTurns instead
function groupMessages(messages: ChatMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let currentAgentSteps: ChatMessage[] = [];

  const flushAgentSteps = () => {
    if (currentAgentSteps.length > 0) {
      groups.push({ type: 'agent_steps', messages: [...currentAgentSteps] });
      currentAgentSteps = [];
    }
  };

  for (const msg of messages) {
    const ct = msg.contentType;

    // User messages always break the group
    if (msg.role === 'user') {
      flushAgentSteps();
      groups.push({ type: 'single', messages: [msg] });
      continue;
    }

    // Agent step types: thinking, tool_call, tool_result
    if (ct === 'thinking' || ct === 'tool_call' || ct === 'tool_result') {
      currentAgentSteps.push(msg);
      continue;
    }

    // 'text' from assistant after tool steps -> attach to agent_steps group as the final response
    if (msg.role === 'assistant' && ct === 'text' && currentAgentSteps.length > 0) {
      currentAgentSteps.push(msg);
      flushAgentSteps();
      continue;
    }

    // Regular message (old conversations without contentType, or plain assistant text)
    flushAgentSteps();
    groups.push({ type: 'single', messages: [msg] });
  }

  flushAgentSteps();
  return groups;
}

// ---------------------------------------------------------------------------
// TurnListRenderer — handles agent chain grouping and connector rendering
// ---------------------------------------------------------------------------

interface TurnListRendererProps {
  displayMessages: ChatMessage[];
  messageReactions: Record<number, Record<string, { user_id: number; user_name: string }[]>>;
  isAgentProcessing: boolean;
  currentUserId?: number;
  markdownEnabled: boolean;
  quickEmojis: string[];
  handleReaction: (messageId: number, emoji: string) => void;
  handleCopyMessage: (message: ChatMessage) => void;
  handleForwardMessage: (message: ChatMessage) => void;
  handleDeleteMessage: (messageId: number) => void;
  onCheckboxClick?: (info: CheckboxClickInfo) => void;
  currentUser?: CheckboxUser;
  onMentionClick?: (token: string) => void;
  messagesEndRef: React.RefObject<HTMLDivElement>;
}

/**
 * Finds the next turn index in `turns` that has the same agentChainId,
 * starting from index `fromIndex + 1`.
 */
function findNextChainTurnId(turns: Turn[], fromIndex: number): string | undefined {
  const chainId = turns[fromIndex].agentChainId;
  if (!chainId) return undefined;
  for (let i = fromIndex + 1; i < turns.length; i++) {
    if (turns[i].agentChainId === chainId) {
      return turns[i].id;
    }
  }
  return undefined;
}

const TurnListRenderer: React.FC<TurnListRendererProps> = ({
  displayMessages,
  messageReactions,
  isAgentProcessing,
  currentUserId,
  markdownEnabled,
  quickEmojis,
  handleReaction,
  handleCopyMessage,
  handleForwardMessage,
  handleDeleteMessage,
  onCheckboxClick,
  currentUser,
  onMentionClick,
  messagesEndRef,
}) => {
  const { selectConversation } = useAIChat();
  const handleNavigateToConversation = React.useCallback(
    (conversationId: number) => {
      void selectConversation(conversationId);
    },
    [selectConversation]
  );

  // ADR-0031 P2: per-conversation toggle to hide row_mutation system pills.
  // conversationId is derived from the first message — all messages in a chat
  // share the same conversation_id.
  const conversationId = displayMessages[0]?.conversation_id ?? null;
  const [hideSystemEvents] = useHideSystemEvents(conversationId);

  const filteredMessages = useMemo(
    () =>
      hideSystemEvents
        ? displayMessages.filter(m => !(m.role === 'system' && m.contentType === 'row_mutation'))
        : displayMessages,
    [displayMessages, hideSystemEvents]
  );

  const turns = useMemo(
    () => groupMessagesIntoTurns(filteredMessages, messageReactions, isAgentProcessing, currentUserId),
    [filteredMessages, messageReactions, isAgentProcessing, currentUserId]
  );

  // Detect which chains are actually multi-segment (need visual treatment)
  const multiSegmentChains = useMemo(() => {
    const chainCounts = new Map<string, number>();
    for (const turn of turns) {
      if (turn.agentChainId) {
        chainCounts.set(turn.agentChainId, (chainCounts.get(turn.agentChainId) || 0) + 1);
      }
    }
    const result = new Set<string>();
    for (const [chainId, count] of chainCounts) {
      if (count >= 2) result.add(chainId);
    }
    return result;
  }, [turns]);

  const elements: React.ReactNode[] = [];

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const isMultiSegment = turn.agentChainId ? multiSegmentChains.has(turn.agentChainId) : false;
    const showConnector = isMultiSegment && turn.turnType === 'agent';

    // If the previous turn had hasMoreSegments and the current turn is NOT from that same chain,
    // render a divider for the interrupted chain
    if (i > 0) {
      const prevTurn = turns[i - 1];
      if (
        prevTurn.hasMoreSegments &&
        prevTurn.agentChainId &&
        prevTurn.agentChainId !== turn.agentChainId
      ) {
        // Check if this is the last non-chain turn before the chain resumes
        // Only show divider right after the chain-owning turn (not after every intervening turn)
        elements.push(
          <AgentChainDivider
            key={`divider-${prevTurn.id}`}
            agentName={prevTurn.senderName}
            agentIcon={prevTurn.agentIcon}
            agentColor={prevTurn.agentColor}
            nextTurnId={prevTurn.agentChainId}
          />
        );
      }
    }

    if (showConnector) {
      elements.push(
        <div key={turn.id} className="relative min-w-0" style={{ paddingLeft: '20px' }}>
          <AgentChainConnector
            color={turn.agentColor}
            hasMoreSegments={turn.hasMoreSegments}
            isContinuation={turn.isContinuation}
          />
          <ChatTurn
            messages={turn.messages}
            turnType={turn.turnType}
            senderName={turn.senderName}
            senderAvatar={turn.senderAvatar}
            markdownEnabled={markdownEnabled}
            isProcessing={turn.isProcessing}
            currentUserId={currentUserId}
            reactions={turn.reactions}
            quickEmojis={quickEmojis}
            onReact={handleReaction}
            onCopy={handleCopyMessage}
            onForward={handleForwardMessage}
            onDelete={handleDeleteMessage}
            onCheckboxClick={onCheckboxClick}
            currentUser={currentUser}
            onMentionClick={onMentionClick}
            isFirstInGroup={turn.isFirstInGroup}
            isLastInGroup={turn.isLastInGroup}
            agentColor={turn.agentColor}
            agentIcon={turn.agentIcon}
            agentInvocationMode={turn.agentInvocationMode}
            agentChainId={turn.agentChainId}
            isContinuation={turn.isContinuation}
            hasMoreSegments={turn.hasMoreSegments}
            invokedAgents={turn.invokedAgents}
            onNavigateToConversation={handleNavigateToConversation}
            isSystemEvent={turn.isSystemEvent}
          />
        </div>
      );
    } else {
      elements.push(
        <ChatTurn
          key={turn.id}
          messages={turn.messages}
          turnType={turn.turnType}
          senderName={turn.senderName}
          senderAvatar={turn.senderAvatar}
          markdownEnabled={markdownEnabled}
          isProcessing={turn.isProcessing}
          currentUserId={currentUserId}
          reactions={turn.reactions}
          quickEmojis={quickEmojis}
          onReact={handleReaction}
          onCopy={handleCopyMessage}
          onForward={handleForwardMessage}
          onDelete={handleDeleteMessage}
          onCheckboxClick={onCheckboxClick}
          currentUser={currentUser}
          onMentionClick={onMentionClick}
          isFirstInGroup={turn.isFirstInGroup}
          isLastInGroup={turn.isLastInGroup}
          agentColor={turn.agentColor}
          agentIcon={turn.agentIcon}
          agentInvocationMode={turn.agentInvocationMode}
          agentChainId={turn.agentChainId}
          isContinuation={turn.isContinuation}
          hasMoreSegments={turn.hasMoreSegments}
          invokedAgents={turn.invokedAgents}
          onNavigateToConversation={handleNavigateToConversation}
          isSystemEvent={turn.isSystemEvent}
        />
      );
    }
  }

  return (
    <div className="space-y-4">
      {elements}
      <div ref={messagesEndRef} />
    </div>
  );
};

// ---------------------------------------------------------------------------

interface ChatMessagesProps {
  chatMode: 'ai' | 'people';
  chatPartner: ChatPartner | null;
  displayMessages: ChatMessage[];
  currentUserId?: number;
  markdownEnabled: boolean;
  messageReactions: Record<number, Record<string, { user_id: number; user_name: string }[]>>;
  quickEmojis: string[];
  dragOver: boolean;
  error: string | null;
  localError: string | null;
  attachments: Array<{ name: string; type: string; size?: number }>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  setActivePanel: (panel: string) => void;
  setDragOver: (dragOver: boolean) => void;
  handleDrop: (event: React.DragEvent) => void;
  handleReaction: (messageId: number, emoji: string) => void;
  handleCopyMessage: (message: ChatMessage) => void;
  handleForwardMessage: (message: ChatMessage) => void;
  handleDeleteMessage: (messageId: number) => void;
  setAttachments: React.Dispatch<React.SetStateAction<Array<{ name: string; type: string; size?: number }>>>;
  /** Fired when a checkbox in a markdown message is clicked */
  onCheckboxClick?: (info: CheckboxClickInfo) => void;
  /** Current user info for checkbox attribution */
  currentUser?: CheckboxUser;
  /** Show processing indicator for active agent work */
  isAgentProcessing?: boolean;
  /** Callback when a @mention or /command is clicked in message text */
  onMentionClick?: (token: string) => void;
}

export const ChatMessages: React.FC<ChatMessagesProps> = ({
  chatMode,
  chatPartner,
  displayMessages,
  currentUserId,
  markdownEnabled,
  messageReactions,
  quickEmojis,
  dragOver,
  error,
  localError,
  attachments,
  messagesEndRef,
  setActivePanel,
  setDragOver,
  handleDrop,
  handleReaction,
  handleCopyMessage,
  handleForwardMessage,
  handleDeleteMessage,
  setAttachments,
  onCheckboxClick,
  currentUser,
  isAgentProcessing = false,
  onMentionClick
}) => {
  return (
    <>
      {/* Messages Area */}
      <div
        className={cn(
          'flex-1 overflow-y-auto px-4 py-4',
          displayMessages.length === 0 && 'flex items-center justify-center',
          dragOver && 'bg-[var(--color-primary-500)]/5 ring-2 ring-inset ring-[var(--color-primary-500)]/50'
        )}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {/* Show contact picker when in people mode without selected user/group */}
        {chatMode === 'people' && (!chatPartner || chatPartner.type === 'agent') ? (
          <div className="text-center px-6">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500/20 to-green-500/20 flex items-center justify-center mb-4 mx-auto">
              <Users className="w-10 h-10 text-blue-400" />
            </div>
            <h3 className="font-medium text-[var(--text-primary)] mb-2">
              Выберите собеседника
            </h3>
            <p className="text-sm text-[var(--text-tertiary)] mb-4">
              Выберите контакт из списка для начала разговора
            </p>
            <button
              onClick={() => setActivePanel('contacts')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors"
            >
              <Users className="w-4 h-4" />
              Открыть контакты
            </button>
          </div>
        ) : displayMessages.length === 0 ? (
          <div className="text-center px-6">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500/20 to-primary-500/20 flex items-center justify-center mb-4 mx-auto">
              {chatPartner?.type === 'agent' ? (
                <Bot className="w-8 h-8 text-[var(--color-primary-500)]" />
              ) : chatPartner?.type === 'user' ? (
                <User className="w-8 h-8 text-blue-400" />
              ) : chatPartner?.type === 'group' ? (
                <Users className="w-8 h-8 text-green-400" />
              ) : (
                <MessageSquare className="w-8 h-8 text-[var(--text-tertiary)]" />
              )}
            </div>
            <h3 className="font-medium text-[var(--text-primary)] mb-2">
              Начните разговор
            </h3>
            <p className="text-sm text-[var(--text-tertiary)]">
              {chatPartner
                ? `Чат с ${chatPartner.name}`
                : 'Выберите собеседника из контактов или AI агентов'}
            </p>
          </div>
        ) : (
          <TurnListRenderer
            displayMessages={displayMessages}
            messageReactions={messageReactions}
            isAgentProcessing={isAgentProcessing}
            currentUserId={currentUserId}
            markdownEnabled={markdownEnabled}
            quickEmojis={quickEmojis}
            handleReaction={handleReaction}
            handleCopyMessage={handleCopyMessage}
            handleForwardMessage={handleForwardMessage}
            handleDeleteMessage={handleDeleteMessage}
            onCheckboxClick={onCheckboxClick}
            currentUser={currentUser}
            onMentionClick={onMentionClick}
            messagesEndRef={messagesEndRef}
          />
        )}
      </div>

      {/* Error */}
      {(error || localError) && (
        <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/30">
          <div className="flex items-center gap-2 text-sm text-red-400">
            <AlertCircle className="w-4 h-4" />
            <span>{error || localError}</span>
          </div>
        </div>
      )}

      {/* Attachments Preview */}
      {attachments.length > 0 && (
        <div className="px-3 py-2 border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)]">
          <div className="flex flex-wrap gap-2">
            {attachments.map((file, index) => (
              <div
                key={index}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--bg-tertiary)] text-xs"
              >
                {getFileIcon(file.type)}
                <span className="max-w-[100px] truncate text-[var(--text-primary)]">{file.name}</span>
                <button
                  onClick={() => setAttachments(prev => prev.filter((_, i) => i !== index))}
                  className="text-[var(--text-tertiary)] hover:text-red-400 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
};