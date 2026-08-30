import { useState, useRef, useEffect, useCallback } from 'react';
import { logger } from '@/shared/utils/logger';
import {
  Bot,
  Trash2,
  MessageSquare,
  Plus,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { useCurrentSpace } from '@/features/spaces/store/spacesStore';
import type { PresetWidgetProps } from '../../../types/widget.types';
import type { CheckboxClickInfo } from '@/shared/components/MarkdownPreview';
import { useAuthStore } from '@/features/auth/store/authStore';

import type { AIAgent, ChatMessage, AIModel, AIOperator, Conversation } from './types';
import { MessageBubble, getFileIcon, formatFileSize } from './MessageBubble';
import { WidgetSettingsPanel } from './WidgetSettingsPanel';
import { HistorySidebar } from './HistorySidebar';
import { ApiKeyDialog } from './ApiKeyDialog';
import { ChatHeader } from './ChatHeader';
import { ChatInput } from './ChatInput';

export function AIAgentsWidget({ widget, data }: PresetWidgetProps) {
  const authUser = useAuthStore((s) => s.user);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [currentAgent, setCurrentAgent] = useState<AIAgent | null>(null);
  const [showAgentSelector, setShowAgentSelector] = useState(false);
  const [showOperatorSelector, setShowOperatorSelector] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showConversations, setShowConversations] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentMode, setAgentMode] = useState(true);
  const [markdownEnabled, setMarkdownEnabled] = useState(false);
  const [selectedOperatorId, setSelectedOperatorId] = useState<number | null>(null);
  const [selectedModelApiId, setSelectedModelApiId] = useState<string | null>(null);
  const [expandedConversation, setExpandedConversation] = useState<number | null>(null);

  // API Key setup dialog state
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [setupOperatorId, setSetupOperatorId] = useState<number | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);

  // Setup mode state
  const [isCreatingTables, setIsCreatingTables] = useState(false);

  // Resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const minSidebarWidth = 200;
  const maxSidebarWidth = 500;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const currentConversationIdRef = useRef<number | null>(null);
  const isSavingRef = useRef(false);
  // Background poller for the agent's reply — the mini-widget has no push/stream,
  // so after a send we must poll the /chat message store to read the reply back.
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Get current space for filtering agents
  const currentSpace = useCurrentSpace();
  const queryClient = useQueryClient();

  // Determine widget width for responsive layout
  const [widgetWidth, setWidgetWidth] = useState(0);
  const showHistorySidebar = widgetWidth > 800 && !sidebarCollapsed;

  // Resize observer
  useEffect(() => {
    const updateWidth = () => {
      if (widgetRef.current) {
        setWidgetWidth(widgetRef.current.offsetWidth);
      }
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    if (widgetRef.current) {
      observer.observe(widgetRef.current);
    }
    return () => observer.disconnect();
  }, []);

  // Handle sidebar resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !widgetRef.current) return;
      const widgetRect = widgetRef.current.getBoundingClientRect();
      const newWidth = widgetRect.right - e.clientX;
      if (newWidth < 50) {
        setSidebarCollapsed(true);
        setIsResizing(false);
      } else if (newWidth >= minSidebarWidth && newWidth <= maxSidebarWidth) {
        setSidebarWidth(newWidth);
        setSidebarCollapsed(false);
      }
    };
    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  // Keep conversation ref in sync
  useEffect(() => {
    currentConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  // Stop any in-flight reply poller (on unmount, new chat, or conversation switch)
  const stopReplyPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);
  useEffect(() => stopReplyPolling, [stopReplyPolling]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load agents for current space
  const { data: agents = [] } = useQuery({
    queryKey: ['ai-agents-widget', currentSpace?.id],
    queryFn: async () => {
      if (!currentSpace?.id) {
        const response = await apiClient.get<{ success: boolean; data: { agents: AIAgent[] } }>('/ai/agents');
        return response.success && response.data?.agents ? response.data.agents.filter(a => a.is_active) : [];
      }
      const response = await apiClient.get<{ success: boolean; data: { agents: AIAgent[] } }>(`/ai/agents/${currentSpace.id}`);
      return response.success && response.data?.agents ? response.data.agents.filter(a => a.is_active) : [];
    }
  });

  // Load conversations
  const { data: conversations = [], isLoading: isLoadingConversations, refetch: refetchConversations } = useQuery({
    queryKey: ['ai-conversations-widget', currentSpace?.id],
    queryFn: async () => {
      const params = currentSpace?.id ? `?spaceId=${currentSpace.id}` : '';
      const response = await apiClient.get<{ success: boolean; data: { conversations: Conversation[] } }>(
        `/ai/conversations${params}`
      );
      return response.success && response.data?.conversations ? response.data.conversations : [];
    }
  });

  // Create agent name lookup map & enrich conversations
  const agentNameMap = new Map<number, string>();
  agents.forEach(agent => agentNameMap.set(agent.id, agent.name));
  const enrichedConversations = conversations.map(conv => ({
    ...conv,
    agentName: conv.agentName || (conv.agent_id ? agentNameMap.get(conv.agent_id) : undefined) || undefined
  }));

  // Load all operators (providers)
  const { data: operators = [] } = useQuery({
    queryKey: ['ai-operators-widget', currentSpace?.id],
    queryFn: async () => {
      const params = currentSpace?.id ? `?spaceId=${currentSpace.id}` : '';
      const response = await apiClient.get<{ success: boolean; data: { providers: AIOperator[] } }>(
        `/ai/providers${params}`
      );
      let providers = response.success && response.data?.providers ? response.data.providers : [];
      if (providers.length === 0 && currentSpace?.id) {
        const fallbackResponse = await apiClient.get<{ success: boolean; data: { providers: AIOperator[] } }>('/ai/providers');
        providers = fallbackResponse.success && fallbackResponse.data?.providers ? fallbackResponse.data.providers : [];
      }
      return providers;
    }
  });

  // Load models for selected operator
  const { data: providerModels = [] } = useQuery({
    queryKey: ['ai-models-widget', selectedOperatorId, currentSpace?.id],
    queryFn: async () => {
      const spaceParam = currentSpace?.id ? `spaceId=${currentSpace.id}` : '';
      if (!selectedOperatorId) {
        const params = spaceParam ? `?${spaceParam}` : '';
        const response = await apiClient.get<{ success: boolean; data: { models: AIModel[] } }>(`/ai/models${params}`);
        return response.success && response.data?.models ? response.data.models : [];
      }
      const params = spaceParam ? `?${spaceParam}` : '';
      const response = await apiClient.get<{ success: boolean; data: { models: AIModel[] } }>(`/ai/providers/${selectedOperatorId}/models${params}`);
      return response.success && response.data?.models ? response.data.models : [];
    }
  });

  const selectedOperator = operators.find(op => op.id === selectedOperatorId);
  const agentOperatorId = currentAgent?.provider_id || currentAgent?.operator_id;
  const isOperatorMismatch = selectedOperatorId != null && agentOperatorId != null &&
    Number(selectedOperatorId) !== Number(agentOperatorId);

  // Auto-select first agent
  useEffect(() => {
    if (agents.length > 0 && !currentAgent) setCurrentAgent(agents[0]);
  }, [agents, currentAgent]);

  // Set default operator from agent when agent changes
  useEffect(() => {
    if (currentAgent) {
      const opId = currentAgent.provider_id || currentAgent.operator_id;
      if (opId) setSelectedOperatorId(Number(opId));
      if (currentAgent.model) setSelectedModelApiId(currentAgent.model);
    }
  }, [currentAgent]);

  // Reset selected model when operator changes (but not on initial load)
  const prevOperatorIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (prevOperatorIdRef.current !== null && prevOperatorIdRef.current !== selectedOperatorId) {
      setSelectedModelApiId(null);
    }
    prevOperatorIdRef.current = selectedOperatorId;
  }, [selectedOperatorId]);

  const selectedModel = providerModels.find(m =>
    m.model_id === selectedModelApiId || String(m.id) === selectedModelApiId
  );

  const getModelDisplayName = () => {
    if (selectedModel?.name) return selectedModel.name;
    const agentModel = providerModels.find(m =>
      m.model_id === currentAgent?.model || String(m.id) === currentAgent?.model || m.name === currentAgent?.model
    );
    if (agentModel?.name) return agentModel.name;
    if (currentAgent?.model_name) return currentAgent.model_name;
    return currentAgent?.model || 'Model';
  };

  const handleCheckboxClick = useCallback((info: CheckboxClickInfo) => {
    const prefix = info.heading ? `[${info.heading}] ` : '';
    const status = info.checked ? '[x]' : '[ ]';
    const userTag = info.user ? ` — ${info.user.name} (${info.user.id})` : '';
    const text = `${prefix}${status} ${info.lineText}${userTag}`;
    setInputValue(prev => prev ? `${prev}\n${text}` : text);
  }, []);

  // Poll the /chat message store for the agent's reply after a send.
  // Personas write their answer straight to `messages`; this mini-widget has no
  // websocket/stream, so without polling the placeholder bubble hangs on
  // "Waiting for response..." forever even though the reply is already in the DB
  // (ADR-190, conv 3542/3543). We read back the SAME store we POST to.
  const REPLY_POLL_INTERVAL_MS = 2500;
  const REPLY_POLL_TIMEOUT_MS = 3 * 60 * 1000;
  const beginReplyPolling = (convId: number, afterMessageId: number, placeholderId: string) => {
    stopReplyPolling();
    const startedAt = Date.now();
    const ownId = authUser ? Number(authUser.id) : null;
    let cursor = afterMessageId;
    let boundFirst = false;

    const tick = async () => {
      // Abandon if the user switched conversations / started a new chat
      if (currentConversationIdRef.current !== convId) { stopReplyPolling(); return; }
      try {
        const resp = await apiClient.get<{
          success: boolean;
          data: {
            messages: Array<{
              id: number; content: string; content_type?: string; contentType?: string;
              sender_id?: number; sender_type?: string; senderType?: string; sender_user_type?: string;
              sender_name?: string; created_at?: string; timestamp?: string;
            }>;
            is_processing?: boolean;
          };
        }>(`/chat/conversations/${convId}/messages?after=${cursor}&content_types=text`);

        const rows = (resp.success && resp.data?.messages) || [];
        const replies = rows.filter(m => {
          const ct = m.contentType || m.content_type || 'text';
          const senderId = m.sender_id != null ? Number(m.sender_id) : null;
          const notOwn = ownId == null || senderId == null || senderId !== ownId;
          const hasContent = typeof m.content === 'string' && m.content.trim().length > 0;
          return ct === 'text' && notOwn && hasContent;
        });

        if (rows.length > 0) {
          cursor = Math.max(cursor, ...rows.map(m => Number(m.id) || cursor));
        }

        if (replies.length > 0) {
          setMessages(prev => {
            let next = prev;
            replies.forEach((r, i) => {
              const ts = r.created_at || r.timestamp;
              const mapped: ChatMessage = {
                id: `reply_${r.id}`,
                role: 'assistant',
                content: r.content,
                agentName: r.sender_name || currentAgent?.name,
                timestamp: ts ? new Date(ts) : new Date(),
                isStreaming: false,
              };
              if (!boundFirst && i === 0) {
                next = next.map(msg => (msg.id === placeholderId ? { ...mapped, id: placeholderId } : msg));
              } else {
                next = [...next, mapped];
              }
            });
            return next;
          });
          boundFirst = true;
        }

        const stillProcessing = resp.data?.is_processing === true;
        if (boundFirst && !stillProcessing) { stopReplyPolling(); return; }

        if (Date.now() - startedAt > REPLY_POLL_TIMEOUT_MS) {
          stopReplyPolling();
          if (!boundFirst) {
            setMessages(prev => prev.map(msg =>
              msg.id === placeholderId
                ? { ...msg, content: '', isStreaming: false, error: 'Агент пока не ответил. Откройте полный чат, чтобы увидеть ответ.' }
                : msg
            ));
          }
        }
      } catch (err) {
        logger.error('Reply polling failed:', err);
      }
    };

    pollTimerRef.current = setInterval(tick, REPLY_POLL_INTERVAL_MS);
    void tick(); // fire immediately so fast replies show without waiting a full interval
  };

  // Send message function
  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmedInput = inputValue.trim();
    if (!trimmedInput && attachments.length === 0) return;
    if (!currentAgent) return;

    setIsLoading(true);
    setError(null);

    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: trimmedInput,
      timestamp: new Date(),
      attachments: attachments.map((f, idx) => ({ id: `att_${idx}`, name: f.name, type: f.type, size: f.size }))
    };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setAttachments([]);

    const assistantMsgId = `assistant_${Date.now()}`;
    setMessages(prev => [...prev, {
      id: assistantMsgId, role: 'assistant', content: '',
      agentId: currentAgent.id, agentName: currentAgent.name, timestamp: new Date(), isStreaming: true
    }]);

    try {
      let convId = currentConversationIdRef.current;
      if (!convId) {
        const createResp = await apiClient.post<{ success: boolean; data: { id: number } }>('/chat/conversations', {
          title: trimmedInput.substring(0, 50) || 'New chat', type: 'chat', space_id: currentSpace?.id
        });
        if (createResp.success && createResp.data) {
          convId = createResp.data.id;
          currentConversationIdRef.current = convId;
          setSelectedConversationId(convId);
        }
      }
      if (!convId) throw new Error('Failed to create or find conversation');

      // Explicitly invoke the selected agent. Personas (e.g. sixty-*) run with
      // response_mode='mention_only', so the backend dispatcher only fires on a
      // <<@slug>> token. Without it the message is stored but no agent is ever
      // summoned — the bubble hangs on "Waiting for response..." forever
      // (conv 3542, ADR-190). Slug is derived the same way as agentToSlug():
      // agent name → lowercase kebab, matching the users.handle the resolver
      // looks up. Skip injection if the user already typed an explicit mention.
      const agentSlug = currentAgent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const alreadyMentions = /<<[@/][^>]+>>/.test(trimmedInput);
      const outgoingContent = alreadyMentions ? trimmedInput : `<<@${agentSlug}>> ${trimmedInput}`;

      const response = await apiClient.post<{ success: boolean; data: { id: number; content: string; sender_id: number } }>(
        `/chat/conversations/${convId}/messages`,
        { content: outgoingContent, content_type: 'text', agent_mode: agentMode ? 'agent' : 'ask' }
      );

      if (response.success) {
        setMessages(prev => prev.map(msg =>
          msg.id === assistantMsgId ? { ...msg, content: 'Waiting for response...', isStreaming: true } : msg
        ));
        refetchConversations();
        // Read the agent's reply back from the same store — the widget has no
        // stream, so poll from just after the user message we just created.
        const userMsgId = Number(response.data?.id);
        if (Number.isFinite(userMsgId)) {
          beginReplyPolling(convId, userMsgId, assistantMsgId);
        }
      } else {
        throw new Error('Failed to send message');
      }
    } catch (err) {
      setMessages(prev => prev.map(msg =>
        msg.id === assistantMsgId
          ? { ...msg, content: '', error: err instanceof Error ? err.message : 'Failed to send message', isStreaming: false }
          : msg
      ));
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setIsLoading(false);
    }
  };

  // Save conversation
  const saveConversation = async (messagesToSave: ChatMessage[]) => {
    if (!currentAgent || isSavingRef.current) return;
    isSavingRef.current = true;
    const cleanMessages = messagesToSave.map(m => ({
      id: m.id, role: m.role, content: m.content, agentId: m.agentId, agentName: m.agentName,
      timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp
    }));

    try {
      const convId = currentConversationIdRef.current;
      if (convId) {
        await apiClient.put(`/ai/conversations/${convId}`, { messages: cleanMessages, agentId: currentAgent.id, agentName: currentAgent.name });
      } else {
        const title = messagesToSave[0]?.content?.substring(0, 50) || 'Новый чат';
        const response = await apiClient.post<{ success: boolean; data: { conversation: { id: number } } }>(
          '/ai/conversations', { title, agentId: currentAgent.id, agentName: currentAgent.name, spaceId: currentSpace?.id }
        );
        if (response.success && response.data?.conversation) {
          const newId = response.data.conversation.id;
          currentConversationIdRef.current = newId;
          setSelectedConversationId(newId);
          await apiClient.put(`/ai/conversations/${newId}`, { messages: cleanMessages });
        }
      }
      refetchConversations();
    } catch (err) {
      logger.error('Failed to save conversation:', err);
    } finally {
      isSavingRef.current = false;
    }
  };

  // Save API key for operator
  const handleSaveApiKey = async () => {
    if (!setupOperatorId || !apiKeyInput.trim()) return;
    setIsSavingApiKey(true);
    try {
      const operator = operators.find(op => op.id === setupOperatorId);
      if (!operator) throw new Error('Operator not found');
      const response = await apiClient.put<{ success: boolean }>(`/ai/providers/${setupOperatorId}`, { api_key: apiKeyInput.trim() });
      if (response.success) {
        setSelectedOperatorId(setupOperatorId);
        queryClient.invalidateQueries({ queryKey: ['ai-operators-widget'] });
        queryClient.invalidateQueries({ queryKey: ['ai-models-widget'] });
        setShowApiKeyDialog(false);
        setApiKeyInput('');
        setSetupOperatorId(null);
      } else {
        throw new Error('Failed to save API key');
      }
    } catch (err) {
      logger.error('Failed to save API key:', err);
      setError(err instanceof Error ? err.message : 'Ошибка сохранения API ключа');
    } finally {
      setIsSavingApiKey(false);
    }
  };

  // Create AI tables
  const handleCreateTables = async () => {
    if (!currentSpace?.id) { setError('Нет выбранного пространства'); return; }
    setIsCreatingTables(true);
    try {
      const response = await apiClient.post<{ success: boolean; data?: { tables?: { agents: number; operators: number } } }>('/ai/setup-tables', { spaceId: currentSpace.id });
      if (response.success) {
        queryClient.invalidateQueries({ queryKey: ['ai-operators-widget'] });
        queryClient.invalidateQueries({ queryKey: ['ai-agents-widget'] });
        setTimeout(() => setShowApiKeyDialog(true), 500);
      } else {
        throw new Error('Failed to create tables');
      }
    } catch (err) {
      logger.error('Failed to create tables:', err);
      setError(err instanceof Error ? err.message : 'Ошибка создания таблиц');
    } finally {
      setIsCreatingTables(false);
    }
  };

  // Select conversation — read history from the /chat message store, the SAME
  // store messages are written to (POST /chat/conversations/:id/messages) and
  // polled from. The old path read /ai/conversations/:id and expected a
  // `data.conversation` wrapper the endpoint no longer returns, so old chats
  // always opened empty (ADR-190).
  const handleSelectConversation = async (id: number) => {
    stopReplyPolling();
    try {
      const response = await apiClient.get<{
        success: boolean;
        data: {
          messages: Array<{
            id: number; content: string; content_type?: string; contentType?: string;
            sender_id?: number; sender_type?: string; senderType?: string; sender_user_type?: string;
            sender_name?: string; created_at?: string; timestamp?: string;
          }>;
        };
      }>(`/chat/conversations/${id}/messages?content_types=text&limit=200`);
      if (response.success && response.data) {
        setSelectedConversationId(id);
        currentConversationIdRef.current = id;
        const ownId = authUser ? Number(authUser.id) : null;
        const restoredMessages: ChatMessage[] = (response.data.messages || [])
          .filter(m => typeof m.content === 'string' && m.content.trim().length > 0)
          .map((m, idx) => {
            const senderId = m.sender_id != null ? Number(m.sender_id) : null;
            const st = m.senderType || m.sender_type || m.sender_user_type;
            const isUser = ownId != null && senderId != null ? senderId === ownId : st === 'human';
            // Strip the leading <<@slug>> we inject on send so restored user
            // messages read like what the user typed.
            const content = isUser ? m.content.replace(/^\s*<<[@/][^>]+>>\s*/, '') : m.content;
            const ts = m.created_at || m.timestamp;
            return {
              id: m.id != null ? `msg_${m.id}` : `restored_${idx}_${Date.now()}`,
              role: isUser ? 'user' : 'assistant',
              content,
              agentName: isUser ? undefined : (m.sender_name || undefined),
              timestamp: ts ? new Date(ts) : new Date(),
            };
          });
        setMessages(restoredMessages);
        // Restore the agent from the conversation list metadata if available.
        const conv = conversations.find(c => c.id === id);
        if (conv?.agent_id) {
          const agent = agents.find(a => a.id === conv.agent_id);
          if (agent) setCurrentAgent(agent);
        }
        setShowConversations(false);
        setExpandedConversation(null);
      }
    } catch (err) {
      logger.error('Failed to load conversation:', err);
    }
  };

  const handleNewConversation = () => {
    stopReplyPolling();
    setMessages([]);
    setSelectedConversationId(null);
    currentConversationIdRef.current = null;
    setError(null);
    setShowConversations(false);
  };

  const handleDeleteConversation = async (id: number) => {
    try {
      await apiClient.delete(`/ai/conversations/${id}`);
      if (selectedConversationId === id) { setSelectedConversationId(null); setMessages([]); }
      refetchConversations();
    } catch (err) {
      logger.error('Failed to delete conversation:', err);
    }
  };

  const handleExpandSidebar = () => { setSidebarCollapsed(false); setSidebarWidth(280); };

  const needsSetup = operators.length === 0 && agents.length === 0;

  if (needsSetup) {
    return (
      <div ref={widgetRef} className="w-full h-full flex items-center justify-center bg-[var(--bg-primary)]">
        <div className="flex flex-col items-center text-center p-8 space-y-6 max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
            <Bot className="w-8 h-8 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">AI Агенты не настроены</h3>
            <p className="text-sm text-[var(--text-tertiary)]">
              Для работы с AI агентами нужно создать системные таблицы в проекте "System Data".
              После создания вы сможете настроить API ключи для провайдеров.
            </p>
          </div>
          {error && (
            <div className="w-full bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-500">{error}</div>
          )}
          <button
            onClick={handleCreateTables}
            disabled={isCreatingTables || !currentSpace?.id}
            className="flex items-center gap-2 px-6 py-3 bg-[var(--color-primary-500)] text-white rounded-lg hover:bg-[var(--color-primary-600)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {isCreatingTables ? (
              <><Loader2 className="w-5 h-5 animate-spin" /><span>Создание таблиц...</span></>
            ) : (
              <><Plus className="w-5 h-5" /><span>Создать таблицы в System Data</span></>
            )}
          </button>
          {!currentSpace?.id && (
            <p className="text-xs text-[var(--text-tertiary)]">Выберите пространство для создания таблиц</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={widgetRef} className="w-full h-full flex bg-[var(--bg-primary)] relative">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <ChatHeader
          currentAgent={currentAgent}
          agents={agents}
          showAgentSelector={showAgentSelector}
          onToggleAgentSelector={() => { setShowAgentSelector(!showAgentSelector); setShowModelSelector(false); }}
          onSelectAgent={(agent) => { setCurrentAgent(agent); setShowAgentSelector(false); }}
          operators={operators}
          selectedOperatorId={selectedOperatorId}
          selectedOperator={selectedOperator}
          showOperatorSelector={showOperatorSelector}
          onToggleOperatorSelector={() => { setShowOperatorSelector(!showOperatorSelector); setShowModelSelector(false); setShowAgentSelector(false); }}
          onSelectOperator={(id) => { setSelectedOperatorId(id); setShowOperatorSelector(false); }}
          isOperatorMismatch={isOperatorMismatch}
          agentOperatorId={agentOperatorId}
          providerModels={providerModels}
          selectedModelApiId={selectedModelApiId}
          selectedModel={selectedModel}
          showModelSelector={showModelSelector}
          onToggleModelSelector={() => { setShowModelSelector(!showModelSelector); setShowOperatorSelector(false); setShowAgentSelector(false); }}
          onSelectModel={(modelId) => { setSelectedModelApiId(modelId); setShowModelSelector(false); }}
          getModelDisplayName={getModelDisplayName}
          showSettings={showSettings}
          onToggleSettings={() => setShowSettings(!showSettings)}
          onNewConversation={handleNewConversation}
          sidebarCollapsed={sidebarCollapsed}
          widgetWidth={widgetWidth}
          showConversations={showConversations}
          onToggleConversations={() => setShowConversations(!showConversations)}
          onExpandSidebar={handleExpandSidebar}
        />

        {/* Conversations Dropdown (mobile) */}
        {widgetWidth <= 500 && showConversations && (
          <div className="border-b border-[var(--border-secondary)] bg-[var(--bg-secondary)] max-h-64 overflow-y-auto">
            <div className="p-2">
              <div className="text-xs font-medium text-[var(--text-tertiary)] px-2 py-1 mb-1">История чатов</div>
              {isLoadingConversations ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
                </div>
              ) : enrichedConversations.length === 0 ? (
                <div className="text-sm text-[var(--text-tertiary)] text-center py-4">Нет сохранённых чатов</div>
              ) : (
                <div className="space-y-1">
                  {enrichedConversations.map((conv) => (
                    <div
                      key={conv.id}
                      className={cn(
                        "flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors group",
                        selectedConversationId === conv.id
                          ? "bg-[var(--color-primary-50)] text-[var(--color-primary-600)]"
                          : "hover:bg-[var(--bg-tertiary)]"
                      )}
                      onClick={() => handleSelectConversation(conv.id)}
                    >
                      <MessageSquare className="w-4 h-4 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{conv.title}</div>
                        <div className="text-xs text-[var(--text-tertiary)] truncate">
                          {conv.agentName} · {conv.messagesCount} сообщ.
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conv.id); }}
                        className="p-1 rounded opacity-0 group-hover:opacity-100 text-[var(--text-tertiary)] hover:text-[var(--color-error)] hover:bg-[var(--bg-primary)] transition-all"
                        title="Удалить"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Settings Panel */}
        {showSettings && (
          <WidgetSettingsPanel
            operators={operators}
            selectedOperatorId={selectedOperatorId}
            onOperatorChange={setSelectedOperatorId}
            providerModels={providerModels}
            selectedModelApiId={selectedModelApiId}
            setSelectedModelApiId={setSelectedModelApiId}
            isLoadingModels={false}
            onClose={() => setShowSettings(false)}
          />
        )}

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center px-6">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500/20 to-primary-500/20 flex items-center justify-center mb-4 mx-auto">
                  <Bot className="w-8 h-8 text-[var(--color-primary-500)]" />
                </div>
                <h3 className="font-medium text-[var(--text-primary)] mb-2">Start a conversation</h3>
                <p className="text-sm text-[var(--text-tertiary)]">
                  {currentAgent
                    ? `Chat with ${currentAgent.name} - ${currentAgent.description || 'Ready to assist you'}`
                    : 'Select an agent to begin'}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  getFileIcon={getFileIcon}
                  formatFileSize={formatFileSize}
                  markdownEnabled={markdownEnabled}
                  onCheckboxClick={handleCheckboxClick}
                  currentUser={authUser ? { name: authUser.name, id: Number(authUser.id) } : undefined}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}

          {error && !isLoading && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-error)]/10 text-[var(--color-error)] text-sm mt-4">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <ChatInput
          currentAgent={currentAgent}
          inputValue={inputValue}
          onInputChange={setInputValue}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          isLoading={isLoading}
          agentMode={agentMode}
          onToggleAgentMode={() => setAgentMode(!agentMode)}
          markdownEnabled={markdownEnabled}
          onToggleMarkdown={() => setMarkdownEnabled(prev => !prev)}
          onSendMessage={handleSendMessage}
        />
      </div>

      {/* Resizable History Sidebar (desktop) */}
      {showHistorySidebar && (
        <HistorySidebar
          sidebarWidth={sidebarWidth}
          isResizing={isResizing}
          onMouseDown={handleMouseDown}
          onCollapse={() => setSidebarCollapsed(true)}
          isLoadingConversations={isLoadingConversations}
          enrichedConversations={enrichedConversations}
          selectedConversationId={selectedConversationId}
          expandedConversation={expandedConversation}
          onExpandConversation={setExpandedConversation}
          onSelectConversation={handleSelectConversation}
          onDeleteConversation={handleDeleteConversation}
        />
      )}

      {/* API Key Setup Dialog */}
      {showApiKeyDialog && (
        <ApiKeyDialog
          operators={operators}
          setupOperatorId={setupOperatorId}
          onSetupOperatorId={setSetupOperatorId}
          apiKeyInput={apiKeyInput}
          onApiKeyInputChange={setApiKeyInput}
          isSavingApiKey={isSavingApiKey}
          onSave={handleSaveApiKey}
          onClose={() => { setShowApiKeyDialog(false); setApiKeyInput(''); setSetupOperatorId(null); }}
        />
      )}
    </div>
  );
}
