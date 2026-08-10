/**
 * ChatPanel - Reusable chat component for any table row
 * Uses useRowChat hook for API integration
 *
 * ADR-092: Now uses turn-based grouping — agent tool steps, thinking, and
 * final responses are grouped into a single "agent turn" bubble with
 * collapsible reasoning chain, matching the legacy AI chat experience.
 *
 * ADR-093: Supports @mentions and /commands for agent invocation in any chat.
 *
 * @see ADR-069-MODULE-INTEGRATION.md
 * @see ADR-092-UNIFIED-TURN-GROUPING-ALL-CHATS.md
 *
 * @usage
 * <ChatPanel tableId={1708} rowId={42} title="Обсуждение тикета" />
 */
import React, { useState, useEffect, useRef, useMemo, useCallback, KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRowChat, type ChatMessage as RowChatMessage } from '@/shared/hooks/useRowChat';
import { Loader2, MessageSquare, X, Bot, Send } from 'lucide-react';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useCurrentSpace } from '@/features/spaces/store/spacesStore';
import { groupChatMessageItems, type ChatMessageItemTurn } from '@/features/ai-chat/utils/groupChatMessageItems';
import { AgentTurnBubble } from '@/features/ai-chat/components/AgentTurnBubble';
import { MentionInput, type MentionUser } from '@/features/ai-chat/components/MentionInput';
import { filterInvokableAgents } from '@/features/ai-chat/utils/agentVisibility';
import type { ChatMessageItem } from '@/features/ai-chat/components/ChatConversationView';

export interface ChatPanelProps {
  tableId: number;
  rowId: number;
  title?: string;
  className?: string;
  onClose?: () => void;
  showHeader?: boolean;
  autoScroll?: boolean;
  /** Optional spaceId override (otherwise uses current space) */
  spaceId?: number;
}

/**
 * Convert useRowChat messages to ChatMessageItem format for grouping.
 * Maps content_type → contentType, sender_type → role, etc.
 */
function toMessageItems(messages: RowChatMessage[]): ChatMessageItem[] {
  return messages.map((msg) => {
    const isAgent = msg.sender_type === 'agent' || msg.role === 'assistant' || msg.user?.user_type === 'agent';
    const contentType = msg.content_type as ChatMessageItem['contentType'];

    return {
      id: msg.id,
      content: msg.content || '',
      role: (msg.role as ChatMessageItem['role']) || (isAgent ? 'assistant' : 'user'),
      sender: msg.user
        ? {
            id: msg.user.id,
            name: msg.user.name,
            avatar: msg.user.avatar,
            type: isAgent ? 'agent' as const : 'user' as const,
          }
        : undefined,
      timestamp: new Date(msg.created_at),
      contentType: contentType && ['text', 'thinking', 'tool_call', 'tool_result'].includes(contentType)
        ? contentType
        : undefined,
      toolResults: msg.tool_results,
    };
  });
}

export function ChatPanel({
  tableId,
  rowId,
  title = 'Чат',
  className = '',
  onClose,
  showHeader = true,
  autoScroll = true,
  spaceId: spaceIdProp,
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const authUser = useAuthStore((s) => s.user);
  const currentSpace = useCurrentSpace();
  const effectiveSpaceId = spaceIdProp || currentSpace?.id;

  const [inputValue, setInputValue] = useState('');
  const [mentionedUsers, setMentionedUsers] = useState<MentionUser[]>([]);

  const {
    conversationId,
    messages,
    sendMessage,
    isSending,
    isLoading,
    error,
  } = useRowChat({
    tableId,
    rowId,
    autoCreate: true,
  });

  // ADR-093: Fetch agents for /commands and @mentions
  const { data: agentsData } = useQuery({
    queryKey: ['ai-agents-for-chat-panel', effectiveSpaceId],
    queryFn: async () => {
      const response = await apiClient.get<{
        success: boolean;
        data: { agents: Array<{ id: number; name: string; icon?: string; status?: string; description?: string; visibility?: string | null }> };
      }>(`/ai/agents/${effectiveSpaceId}`);
      return response;
    },
    enabled: !!effectiveSpaceId,
    staleTime: 60000,
  });

  // ADR-0079 §2: filter locked Tier-B bindings out of the invocation picker.
  const availableAgents: MentionUser[] = useMemo(() => {
    const agents = agentsData?.data?.agents || [];
    return filterInvokableAgents(agents)
      .filter(a => a.status !== 'inactive' && a.name)
      .map(a => ({
        id: a.id,
        name: a.name,
        icon: a.icon,
        email: a.description,
        type: 'agent' as const,
      }));
  }, [agentsData]);

  // Convert messages to ChatMessageItem format and group into turns
  const turns = useMemo(() => {
    const items = toMessageItems(messages);
    return groupChatMessageItems(items, {
      chatType: 'task',
      currentUserId: authUser ? Number(authUser.id) : undefined,
      isAgentProcessing: isSending,
    });
  }, [messages, authUser, isSending]);

  // Stable currentUser identity so memoized turn rows don't re-render on every
  // keystroke in the input (a fresh object literal here would defeat React.memo).
  const currentUser = useMemo(
    () => (authUser ? { name: authUser.name, id: Number(authUser.id) } : undefined),
    [authUser]
  );

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll]);

  // Log errors
  useEffect(() => {
    if (error) {
      logger.error('ChatPanel error', { error, tableId, rowId });
    }
  }, [error, tableId, rowId]);

  const handleSendMessage = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || isSending) return;
    sendMessage(trimmed);
    setInputValue('');
    setMentionedUsers([]);
  }, [inputValue, isSending, sendMessage]);

  const handleMention = useCallback((user: MentionUser) => {
    setMentionedUsers(prev => {
      if (prev.some(u => u.id === user.id && u.type === user.type)) return prev;
      return [...prev, user];
    });
  }, []);

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center py-8 ${className}`}>
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-tertiary)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex flex-col items-center justify-center py-8 ${className}`}>
        <p className="text-sm text-red-500 mb-2">Ошибка загрузки чата</p>
        <p className="text-xs text-[var(--text-tertiary)]">{error.message}</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full bg-[var(--bg-primary)] ${className}`}>
      {/* Header */}
      {showHeader && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-[var(--text-secondary)]" />
            <h3 className="font-medium text-[var(--text-primary)]">{title}</h3>
            {conversationId && (
              <span className="text-xs text-[var(--text-tertiary)]">
                #{conversationId}
              </span>
            )}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <X className="w-4 h-4 text-[var(--text-tertiary)]" />
            </button>
          )}
        </div>
      )}

      {/* Messages — grouped into turns */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {turns.length > 0 ? (
          <>
            {turns.map((turn) => (
              <ChatTurnRenderer
                key={turn.id}
                turn={turn}
                currentUser={currentUser}
              />
            ))}
            <div ref={messagesEndRef} />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-tertiary)]">
            <MessageSquare className="w-10 h-10 mb-2 opacity-50" />
            <p className="text-sm">Нет сообщений</p>
            <p className="text-xs mt-1">@ или / для вызова агента</p>
          </div>
        )}
      </div>

      {/* ADR-093: Input with @mentions and /commands support */}
      <div className="flex gap-2 px-4 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <MentionInput
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSendMessage}
          onMention={handleMention}
          availableUsers={availableAgents}
          availableAgents={availableAgents}
          placeholder="Сообщение... (@ или / для агента)"
          disabled={isSending || !conversationId}
          className="flex-1"
        />
        <button
          onClick={handleSendMessage}
          disabled={!inputValue.trim() || isSending || !conversationId}
          className="px-3 py-1.5 rounded-lg bg-[var(--color-primary-500)] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--color-primary-600)] transition-colors flex-shrink-0 self-end"
        >
          {isSending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatTurnRenderer — renders one turn (human or agent) in the regular chat
// ---------------------------------------------------------------------------

interface ChatTurnRendererProps {
  turn: ChatMessageItemTurn;
  currentUser?: { name: string; id: number };
}

const ChatTurnRenderer = React.memo(function ChatTurnRenderer({ turn, currentUser }: ChatTurnRendererProps) {
  const isOwn = turn.isOwn;
  const senderName = turn.sender?.name || (isOwn ? 'You' : 'Agent');

  // --- Agent turn with steps → render as AgentTurnBubble (reasoning chain) ---
  if (turn.turnType === 'agent') {
    const hasSteps = turn.messages.some(
      (m) =>
        m.contentType === 'thinking' ||
        m.contentType === 'tool_call' ||
        m.contentType === 'tool_result' ||
        (m.toolResults && m.toolResults.length > 0)
    );

    if (hasSteps) {
      return (
        <div className="flex gap-2 flex-row">
          {/* Agent avatar */}
          <div className="flex-shrink-0 w-8 self-end">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center text-white">
              {turn.sender?.avatar ? (
                <img src={turn.sender.avatar} className="w-full h-full rounded-full object-cover" />
              ) : (
                <Bot className="w-4 h-4" />
              )}
            </div>
          </div>

          {/* Agent turn bubble with reasoning chain */}
          <div className="flex flex-col gap-0.5 max-w-[85%]">
            {/* Sender name */}
            <span className="text-xs font-medium text-[var(--text-secondary)] ml-1">
              {senderName}
            </span>
            <AgentTurnBubble
              messages={turn.messages}
              isProcessing={turn.isProcessing}
              currentUser={currentUser}
            />
            {/* Timestamp */}
            <span className="text-[10px] text-[var(--text-tertiary)] ml-1">
              {formatTime(turn.messages[turn.messages.length - 1]?.timestamp)}
            </span>
          </div>
        </div>
      );
    }

    // Simple agent text (no tool steps) — render as left-aligned bubble
    return (
      <div className="flex gap-2 flex-row">
        <div className="flex-shrink-0 w-8 self-end">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center text-white">
            {turn.sender?.avatar ? (
              <img src={turn.sender.avatar} className="w-full h-full rounded-full object-cover" />
            ) : (
              <Bot className="w-4 h-4" />
            )}
          </div>
        </div>
        <div className="flex flex-col gap-0.5 max-w-[75%]">
          <span className="text-xs font-medium text-[var(--text-secondary)] ml-1">
            {senderName}
          </span>
          <div className="bg-[var(--bg-secondary)] text-[var(--text-primary)] rounded-2xl rounded-bl-md shadow-sm px-3 py-2">
            <div className="space-y-1">
              {turn.messages.map((msg) => (
                <p key={msg.id} className="text-sm break-words whitespace-pre-wrap">
                  {msg.content}
                </p>
              ))}
            </div>
          </div>
          <span className="text-[10px] text-[var(--text-tertiary)] ml-1">
            {formatTime(turn.messages[turn.messages.length - 1]?.timestamp)}
          </span>
        </div>
      </div>
    );
  }

  // --- Human turn → right-aligned bubble ---
  return (
    <div className="flex gap-2 flex-row-reverse">
      <div className="flex flex-col gap-0.5 max-w-[75%] items-end">
        <div className="bg-[var(--color-primary-500)] text-white rounded-2xl rounded-br-md px-3 py-2">
          <div className="space-y-1">
            {turn.messages.map((msg) => (
              <p key={msg.id} className="text-sm break-words whitespace-pre-wrap">
                {msg.content}
              </p>
            ))}
          </div>
        </div>
        <span className="text-[10px] text-[var(--text-tertiary)] mr-1">
          {formatTime(turn.messages[turn.messages.length - 1]?.timestamp)}
        </span>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function formatTime(date?: Date): string {
  if (!date) return '';
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
