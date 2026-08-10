/**
 * TelegramChatLayout Component
 * ADR-024: Telegram-like Chat Architecture
 * 
 * Main container that combines:
 * - ChatListView (left panel)
 * - ChatConversationView (right panel)
 * - Settings modal
 * - Row binding modal
 * 
 * Responsive: mobile shows one panel at a time
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X,
  Settings,
  Link2,
  Users,
  Edit3,
  Trash2,
  Bot,
  Loader2
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { apiClient } from '@/shared/utils/apiClient';
import { useCurrentSpace } from '@/features/spaces/store/spacesStore';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useAIChat } from '../context/AIChatContext';
import { useConversationMessages, type ChatActivityState } from '../hooks/useConversationMessages';
import { ChatListView, ChatPreview } from './ChatListView';
import { ChatConversationView, ChatMessageItem, ChatInfo } from './ChatConversationView';
import { ParticipantSelector, Participant } from './ParticipantSelector';
import { NewChatDialog, SelectedParticipant } from './NewChatDialog';
import { RowBinding, BoundRow } from './RowBinding';
import { MentionUser } from './MentionInput';

export interface TelegramChatLayoutProps {
  className?: string;
}

export function TelegramChatLayout({ className }: TelegramChatLayoutProps) {
  const {
    isOpen,
    closeChat,
    currentAgent,
    agents,
    messages,
    isLoading,
    isStreaming,
    selectAgent,
    sendMessage,
    clearMessages,
    loadAgents,
    conversations,
    currentConversationId,
    loadConversations,
    selectConversation,
    createNewConversation,
    deleteConversation,
    isLoadingConversations,
    agentMode,
    setAgentMode,
    hasMoreAIMessages,
    isFetchingOlderAIMessages,
    fetchOlderAIMessages,
    processingAgentName,
    isAgentProcessing,
  } = useAIChat();

  const currentSpace = useCurrentSpace();
  const authUser = useAuthStore(s => s.user);
  const queryClient = useQueryClient();

  // ADR-103: Adaptive polling state — track last user activity to transition active -> idle
  // Starts at 1.5s when agent is processing, 3s when user recently sent a message,
  // slows to 8s after 30s of inactivity.
  const lastActivityRef = useRef<number>(Date.now());
  const [isRecentlyActive, setIsRecentlyActive] = useState(false);

  // Mark activity on conversation selection or message send
  const markActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    setIsRecentlyActive(true);
  }, []);

  // Timer to transition from 'active' to 'idle' after 30s of inactivity
  useEffect(() => {
    if (!isRecentlyActive) return;
    const timer = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= 30_000) {
        setIsRecentlyActive(false);
      }
    }, 5_000); // Check every 5s
    return () => clearInterval(timer);
  }, [isRecentlyActive]);

  // Mark activity when conversation changes (user selected a chat)
  useEffect(() => {
    if (currentConversationId) {
      markActivity();
    }
  }, [currentConversationId, markActivity]);

  // Compute adaptive polling state:
  // - agent_processing (1.5s): backend agent is actively working
  // - active (3s): user recently interacted (< 30s ago)
  // - idle (8s): no recent activity
  const chatActivityState: ChatActivityState = useMemo(() => {
    if (isAgentProcessing || isStreaming) return 'agent_processing';
    if (isRecentlyActive) return 'active';
    return 'idle';
  }, [isAgentProcessing, isStreaming, isRecentlyActive]);

  // ADR-103: Use useConversationMessages for real-time polling (replaces stale AIChatContext.messages)
  const {
    messages: polledMessages,
    isLoading: isPolledLoading,
    isProcessing: isPolledProcessing,
    processingAgentName: polledProcessingAgentName,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useConversationMessages(currentConversationId, {
    adaptivePolling: true,
    chatActivityState,
    currentUserId: authUser?.id ? Number(authUser.id) : undefined,
  });

  // Use polled messages when available, fallback to context messages (for optimistic updates)
  const effectiveMessages = polledMessages.length > 0 ? polledMessages : messages;

  // Default agent selection (mirrors AIChatPanel.tsx logic)
  const [defaultAgentId, setDefaultAgentId] = useState<number | null>(null);
  const defaultAgentAppliedRef = useRef(false);

  // Step 1: Read default agent from space settings
  useEffect(() => {
    if (currentSpace?.settings && typeof currentSpace.settings === 'object') {
      const spaceSettings = currentSpace.settings as Record<string, unknown>;
      if (spaceSettings.default_agent_id) {
        setDefaultAgentId(Number(spaceSettings.default_agent_id));
      } else {
        setDefaultAgentId(null);
      }
    } else {
      setDefaultAgentId(null);
    }
    // Reset applied flag when space changes so default re-applies
    defaultAgentAppliedRef.current = false;
  }, [currentSpace?.id, currentSpace?.settings]);

  // Step 2: Auto-select default agent when chat opens
  // Note: loadAgents() may auto-select the FIRST agent before this effect runs,
  // so we can't rely on !currentAgent. Instead we use a ref to apply once per session.
  useEffect(() => {
    if (isOpen && defaultAgentId && agents.length > 0 && !defaultAgentAppliedRef.current) {
      const defaultAgent = agents.find(a => a.id === defaultAgentId);
      if (defaultAgent) {
        defaultAgentAppliedRef.current = true;
        // Only switch if no agent selected OR the wrong agent was auto-selected
        if (!currentAgent || currentAgent.id !== defaultAgentId) {
          selectAgent(defaultAgent);
        }
      }
    }
  }, [isOpen, defaultAgentId, agents, currentAgent, selectAgent]);

  // UI State
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showBindingModal, setShowBindingModal] = useState(false);
  const [showNewChatModal, setShowNewChatModal] = useState(false);

  // Chat state
  const [chatTitle, setChatTitle] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [boundRows, setBoundRows] = useState<BoundRow[]>([]);

  // Pending sub-agents selected from NewChatDialog (cleared after first message sent)
  const [pendingSubAgentIds, setPendingSubAgentIds] = useState<number[]>([]);

  // Convert conversations to ChatPreview format
  const chatPreviews: ChatPreview[] = useMemo(() => {
    return conversations.map(conv => ({
      id: conv.id,
      title: conv.title || 'Новый чат',
      type: 'agent' as const,
      icon: agents.find(a => a.id === conv.agent_id)?.icon,
      lastMessage: conv.lastMessage ? {
        content: conv.lastMessage,
        sender: 'AI',
        time: conv.updatedAt ? new Date(conv.updatedAt) : new Date(),
        isRead: true,
        isOwn: false
      } : undefined,
      unreadCount: 0,
      isPinned: false,
      isMuted: false,
      participantsCount: 2
    }));
  }, [conversations, agents]);

  // Current chat info
  // ADR-103: status reflects both SSE streaming AND backend polling processing state
  const isAgentTyping = isStreaming || isPolledProcessing || isAgentProcessing;
  const currentChatInfo: ChatInfo | null = useMemo(() => {
    if (!currentConversationId) return null;
    const conv = conversations.find(c => c.id === currentConversationId);
    if (!conv) return null;

    const agent = agents.find(a => a.id === conv.agent_id);
    return {
      id: conv.id,
      title: conv.title || agent?.name || 'Чат',
      type: 'agent',
      icon: agent?.icon,
      status: isAgentTyping ? 'typing' : 'online',
      agentModel: agent?.model
    };
  }, [currentConversationId, conversations, agents, isAgentTyping]);

  // Convert messages to ChatMessageItem format (preserving contentType for agent step grouping)
  // ADR-103: Uses effectiveMessages (from useConversationMessages polling) instead of stale context messages
  const chatMessages: ChatMessageItem[] = useMemo(() => {
    return effectiveMessages.map((msg, index) => {
      // Determine sender info from backend data or fallback to currentAgent
      const isAgentMessage = msg.role === 'assistant' || msg.role === 'tool';
      const isUserMessage = msg.role === 'user';

      let sender: ChatMessageItem['sender'] | undefined;

      if (msg.sender_id && msg.sender_name) {
        // Backend provided sender info via users JOIN — use it for all messages
        sender = {
          id: msg.sender_id,
          name: msg.sender_name,
          avatar: msg.sender_avatar || undefined,
          type: (msg.sender_user_type === 'agent' || msg.senderType === 'agent') ? 'agent' : 'user',
        };
      } else if (isAgentMessage && currentAgent) {
        // Fallback for agent messages without sender_id
        sender = {
          id: currentAgent.id,
          name: msg.agentName || currentAgent.name,
          avatar: undefined,
          type: 'agent' as const,
        };
      } else if (isUserMessage && msg.sender_id) {
        // User message with sender_id but no name (shouldn't happen after backend fix)
        sender = {
          id: msg.sender_id,
          name: msg.sender_name || 'User',
          avatar: msg.sender_avatar || undefined,
          type: 'user' as const,
        };
      }

      return {
        id: msg.id || `msg-${index}`,
        content: msg.content,
        role: msg.role as 'user' | 'assistant' | 'system' | 'tool',
        sender,
        timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
        isRead: true,
        attachments: msg.attachments?.map(att => ({
          id: att.id,
          name: att.name,
          type: att.type,
          url: att.url,
          size: att.size
        })),
        // Preserve agent step metadata for turn grouping (ADR-092)
        contentType: msg.contentType,
        toolResults: msg.toolResults?.map(tr => ({
          tool: tr.tool,
          args: tr.args,
          result: tr.result
        })),
        iterations: msg.iterations,
        agentName: msg.agentName || msg.sender_name || currentAgent?.name,
        is_deleted: msg.is_deleted,
      };
    });
  }, [effectiveMessages, currentAgent]);

  // Build mention users
  // ADR-069: @ shows humans + bots, / shows agents
  const mentionUsers: MentionUser[] = useMemo(() => {
    return agents.map(agent => ({
      id: agent.id,
      name: agent.name,
      icon: agent.icon,
      type: 'agent' as const
    }));
  }, [agents]);

  const mentionAgents: MentionUser[] = useMemo(() => {
    return agents.map(agent => ({
      id: agent.id,
      name: agent.name,
      icon: agent.icon,
      type: 'agent' as const
    }));
  }, [agents]);

  // Load conversations on mount
  useEffect(() => {
    if (isOpen) {
      loadConversations();
      loadAgents();
    }
  }, [isOpen, loadConversations, loadAgents]);

  // Update mobile view when selecting chat
  useEffect(() => {
    if (currentConversationId) {
      setMobileView('chat');
    }
  }, [currentConversationId]);

  // Handlers
  const handleSelectChat = async (chatId: number) => {
    await selectConversation(chatId);
  };

  const handleCreateChat = () => {
    setShowNewChatModal(true);
  };

  // ADR-024: Unified New Chat — agents are just participants
  const handleStartChat = useCallback((selectedParticipants: SelectedParticipant[]) => {
    const agentParticipants = selectedParticipants.filter(p => p.type === 'agent');

    // Map selected agent participants back to AIAgent objects (by name match)
    const selectedAgents = agentParticipants
      .map(p => agents.find(a => a.name.toLowerCase() === p.name.toLowerCase()))
      .filter((a): a is (typeof agents)[0] => a !== undefined);

    // Select first agent as primary conversation partner
    if (selectedAgents.length > 0) {
      selectAgent(selectedAgents[0]);
    }

    // Store all selected agent IDs for multi-agent support
    const subAgentIds = selectedAgents.map(a => a.id);
    setPendingSubAgentIds(subAgentIds);

    // Clear conversation state (conversation created on first message)
    createNewConversation();
    setShowNewChatModal(false);
  }, [agents, selectAgent, createNewConversation]);

  const handleSendMessage = async (content: string, attachments?: File[], mentions?: MentionUser[]) => {
    // ADR-103: Mark activity so polling speeds up (active -> 3s, then agent_processing -> 1.5s)
    markActivity();

    // ADR-024: Convert MentionUser[] to format expected by sendMessage
    const formattedMentions = mentions?.map(m => ({
      id: m.id,
      name: m.name,
      type: m.type
    }));

    // Pass pending sub-agent IDs (from NewChatDialog selection) on first message
    const subAgentIds = pendingSubAgentIds.length > 0 ? pendingSubAgentIds : undefined;
    await sendMessage(content, attachments, undefined, formattedMentions, undefined, undefined, subAgentIds);

    // Clear pending sub-agents after first message (conversation is now created)
    if (pendingSubAgentIds.length > 0) {
      setPendingSubAgentIds([]);
    }
  };

  const handleBack = () => {
    setMobileView('list');
  };

  const handleDeleteChat = (chatId: number) => {
    deleteConversation(chatId);
  };

  if (!isOpen) return null;

  return (
    <div className={cn(
      'fixed inset-y-0 right-0 z-40 flex bg-[var(--bg-primary)] border-l border-[var(--border-primary)] shadow-xl overscroll-contain',
      'w-full sm:w-[420px] md:w-[800px] lg:w-[900px]',
      className
    )} style={{ overscrollBehavior: 'contain', touchAction: 'pan-y' }}>
      {/* Left Panel: Chat List */}
      <div className={cn(
        'flex-shrink-0 w-full sm:w-[320px] border-r border-[var(--border-primary)] relative',
        mobileView === 'chat' && 'hidden sm:block'
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
          <h2 className="font-semibold text-[var(--text-primary)]">Чаты</h2>
          <button
            onClick={closeChat}
            className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <ChatListView
          chats={chatPreviews}
          selectedChatId={currentConversationId}
          onSelectChat={handleSelectChat}
          onCreateChat={handleCreateChat}
          onDeleteChat={handleDeleteChat}
          isLoading={isLoadingConversations}
        />
      </div>

      {/* Right Panel: Active Chat */}
      <div className={cn(
        'flex-1 min-w-0',
        mobileView === 'list' && 'hidden sm:block'
      )}>
        <ChatConversationView
          chat={currentChatInfo}
          messages={chatMessages}
          isLoading={isPolledLoading || isLoading}
          isTyping={isStreaming || isPolledProcessing}
          typingAgentName={polledProcessingAgentName || processingAgentName}
          onSendMessage={handleSendMessage}
          onBack={handleBack}
          onOpenSettings={() => setShowSettingsModal(true)}
          mentionUsers={mentionUsers}
          mentionAgents={mentionAgents}
          currentUserId={authUser?.id ? Number(authUser.id) : undefined}
          hasMoreMessages={hasNextPage || hasMoreAIMessages}
          onLoadMoreMessages={hasNextPage ? (async () => { await fetchNextPage(); }) : fetchOlderAIMessages}
          isLoadingMore={isFetchingNextPage || isFetchingOlderAIMessages}
        />
      </div>

      {/* New Chat Dialog — ADR-024: unified participant picker (agents + humans) */}
      <NewChatDialog
        isOpen={showNewChatModal}
        agents={agents}
        spaceId={currentSpace?.id}
        onStartChat={handleStartChat}
        onClose={() => setShowNewChatModal(false)}
      />

      {/* Settings Modal */}
      {showSettingsModal && currentChatInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--bg-primary)] rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)] flex-shrink-0">
              <h3 className="font-semibold text-[var(--text-primary)]">Настройки чата</h3>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {/* Chat Avatar & Title */}
              <div className="flex flex-col items-center">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center text-white text-3xl mb-3">
                  {currentChatInfo.icon || <Bot className="w-10 h-10" />}
                </div>
                <input
                  type="text"
                  value={chatTitle || currentChatInfo.title}
                  onChange={(e) => setChatTitle(e.target.value)}
                  className="text-center text-lg font-semibold bg-transparent border-b border-transparent hover:border-[var(--border-primary)] focus:border-[var(--color-primary-500)] focus:outline-none px-2 py-1 text-[var(--text-primary)]"
                  placeholder="Название чата"
                />
                <span className="text-xs text-[var(--text-tertiary)] mt-1">
                  {currentChatInfo.agentModel || currentChatInfo.type}
                </span>
              </div>

              {/* Bindings Section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-2">
                    <Link2 className="w-4 h-4" />
                    Привязки к записям
                  </label>
                  <button
                    onClick={() => setShowBindingModal(true)}
                    className="text-xs text-[var(--color-primary-500)] hover:underline"
                  >
                    Добавить
                  </button>
                </div>
                
                {boundRows.length === 0 ? (
                  <p className="text-xs text-[var(--text-tertiary)] italic py-2">
                    Нет привязок. Привяжите чат к задаче, проекту или любой записи.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {boundRows.map((row, idx) => (
                      <div 
                        key={`${row.table_id}-${row.row_id}-${idx}`}
                        className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-tertiary)] rounded-lg"
                      >
                        <Link2 className="w-4 h-4 text-[var(--text-tertiary)]" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-[var(--text-primary)] truncate">
                            {row.row_title || `#${row.row_id}`}
                          </div>
                          <div className="text-xs text-[var(--text-tertiary)]">
                            {row.table_name}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setBoundRows(prev => prev.filter(
                              r => !(r.table_id === row.table_id && r.row_id === row.row_id)
                            ));
                          }}
                          className="p-1 rounded text-[var(--text-tertiary)] hover:text-red-500"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Participants Section */}
              <div>
                <label className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4" />
                  Участники
                </label>
                <ParticipantSelector
                  participants={participants}
                  onSelect={(p) => {
                    if (!participants.some(sp => sp.type === p.type && sp.id === p.id)) {
                      setParticipants([...participants, p]);
                    }
                  }}
                  onMultiSelect={setParticipants}
                  multiSelect={true}
                  placeholder="Добавить участника..."
                />
              </div>

              {/* Danger Zone */}
              <div className="pt-4 border-t border-[var(--border-primary)]">
                <button
                  onClick={() => {
                    if (currentConversationId) {
                      deleteConversation(currentConversationId);
                      setShowSettingsModal(false);
                    }
                  }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Удалить чат
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Row Binding Modal */}
      {showBindingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--bg-primary)] rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)] flex-shrink-0">
              <h3 className="font-semibold text-[var(--text-primary)]">Привязать к записи</h3>
              <button
                onClick={() => setShowBindingModal(false)}
                className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4">
              <RowBinding
                spaceId={currentSpace?.id}
                boundRows={boundRows}
                maxBindings={10}
                compact={false}
                onBind={(tableId, rowId, meta) => {
                  setBoundRows(prev => [...prev, {
                    table_id: tableId,
                    row_id: rowId,
                    table_name: meta?.tableName,
                    row_title: meta?.rowTitle
                  }]);
                }}
                onUnbind={(tableId, rowId) => {
                  setBoundRows(prev => prev.filter(
                    r => !(r.table_id === tableId && r.row_id === rowId)
                  ));
                }}
              />
            </div>

            <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border-primary)] flex-shrink-0">
              <button
                onClick={() => setShowBindingModal(false)}
                className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg"
              >
                Отмена
              </button>
              <button
                onClick={() => setShowBindingModal(false)}
                className="px-4 py-2 text-sm bg-[var(--color-primary-500)] text-white rounded-lg hover:bg-[var(--color-primary-600)]"
              >
                Готово
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
