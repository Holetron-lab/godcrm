/**
 * useSyncEffects — Lifecycle effects for syncing state between AIChatPanel sub-systems.
 * Extracted from AIChatPanel.tsx (various useEffect blocks: lines 1194-1480, 539-548, 613-639).
 */
import { useEffect } from 'react';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import { useAuthStore } from '@/features/auth/store/authStore';
import type { AIAgent } from '../../../types';

interface UseSyncEffectsParams {
  // Agent sync
  currentAgent: AIAgent | null;
  setChatOperatorId: (id: number | null) => void;
  setChatModelId: (id: string) => void;
  setChatSystemPrompt: (prompt: string) => void;
  // Backend processing sync
  aiBackendProcessing: boolean | undefined;
  isAgentProcessing: boolean;
  dismissProcessing: () => void;
  aiBackendProcessingAgentName: string | null | undefined;
  setProcessingAgentName: (name: string) => void;
  // Mark as read on load
  userConversationId: number | null;
  userConversationData: { participants?: unknown[] } | null | undefined;
  markAsRead: () => void;
  refetchUnread: () => void;
  // Default agent auto-select
  isOpen: boolean;
  agents: AIAgent[];
  defaultAgentId: number | null;
  selectAgent: (agent: AIAgent) => void;
  // Load on open
  loadAgents: () => void;
  loadConversations: () => void;
  // Mobile scroll lock
  isMobile: boolean;
  // Chat partner sync
  chatPartner: { type: string; id: number; name: string; icon?: string } | null;
  setChatPartner: (partner: { type: string; id: number; name: string; icon?: string }) => void;
  setUserConversationId: (id: number | null) => void;
  // Pending task chat
  pendingTaskChat: { tableId: number; rowId: number; rowTitle?: string; conversationId: number; multi?: boolean; conversations?: Array<{ id: number }> } | null;
  clearPendingTaskChat: () => void;
  setChatMode: (mode: string) => void;
  setBoundRows: (rows: Array<{ table_id: number; table_name: string; row_id: number; row_title: string }>) => void;
  setShowBoundRowsBar: (show: boolean) => void;
  setActivePanel: (panel: string) => void;
  // Sub-agents
  aiConversationData: { id?: number; sub_agents?: Array<number | { row_id?: number; id?: number }>; participants?: Array<{ user_id: number; name: string; user_type?: string }> } | null | undefined;
  setSubAgents: (agents: number[]) => void;
  subAgents: number[];
  currentConversationId: number | null;
  // Participants restore
  setChatParticipants: (participants: Array<{ id: number; name: string; type: 'user' | 'agent' }>) => void;
  userParticipantsCount: number;
  aiParticipantsCount: number;
  // Processing timer
  processingStartedAt: number | null;
  setProcessingElapsed: (elapsed: number) => void;
}

export function useSyncEffects(params: UseSyncEffectsParams) {
  const {
    currentAgent, setChatOperatorId, setChatModelId, setChatSystemPrompt,
    aiBackendProcessing, isAgentProcessing, dismissProcessing,
    aiBackendProcessingAgentName, setProcessingAgentName,
    userConversationId, userConversationData, markAsRead, refetchUnread,
    isOpen, agents, defaultAgentId, selectAgent, loadAgents, loadConversations,
    isMobile, chatPartner, setChatPartner, setUserConversationId,
    pendingTaskChat, clearPendingTaskChat, setChatMode, setBoundRows, setShowBoundRowsBar, setActivePanel,
    aiConversationData, setSubAgents, subAgents, currentConversationId,
    setChatParticipants, userParticipantsCount, aiParticipantsCount,
    processingStartedAt, setProcessingElapsed,
  } = params;

  // Processing timer
  useEffect(() => {
    if (!isAgentProcessing || !processingStartedAt) {
      setProcessingElapsed(0);
      return;
    }
    setProcessingElapsed(Math.floor((Date.now() - processingStartedAt) / 1000));
    const timer = setInterval(() => {
      setProcessingElapsed(Math.floor((Date.now() - processingStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isAgentProcessing, processingStartedAt]);

  // Sync chat settings when agent changes
  useEffect(() => {
    if (currentAgent) {
      setChatOperatorId(currentAgent.provider_id || currentAgent.operator_id || null);
      setChatModelId(currentAgent.model || '');
      setChatSystemPrompt(currentAgent.system_prompt || '');
    }
  }, [currentAgent]);

  // Sync backend processing state
  useEffect(() => {
    if (aiBackendProcessing === false && isAgentProcessing) {
      dismissProcessing();
    }
  }, [aiBackendProcessing]);

  useEffect(() => {
    if (aiBackendProcessingAgentName != null) {
      setProcessingAgentName(aiBackendProcessingAgentName);
    }
  }, [aiBackendProcessingAgentName]);

  // Mark as read when conversation loads
  useEffect(() => {
    if (userConversationId && userConversationData) {
      markAsRead();
      refetchUnread();
    }
  }, [userConversationId, userConversationData]);

  // Auto-select default agent when chat opens
  useEffect(() => {
    if (!isOpen || agents.length === 0) return;
    if (defaultAgentId) {
      if (!currentAgent || currentAgent.id !== defaultAgentId) {
        const defaultAgent = agents.find(a => a.id === defaultAgentId);
        if (defaultAgent) selectAgent(defaultAgent);
      }
    }
  }, [isOpen, defaultAgentId, agents, currentAgent, selectAgent]);

  // Load agents and conversations when opened
  useEffect(() => {
    if (isOpen) { loadAgents(); loadConversations(); }
  }, [isOpen, loadAgents, loadConversations]);

  // Mobile: lock body scroll
  useEffect(() => {
    if (!isMobile) return;
    if (isOpen) { document.body.classList.add('chat-open'); }
    else { document.body.classList.remove('chat-open'); }
    return () => { document.body.classList.remove('chat-open'); };
  }, [isOpen, isMobile]);

  // Sync chatPartner with currentAgent
  useEffect(() => {
    if (currentAgent && (!chatPartner || chatPartner.type === 'agent')) {
      const isNewAgent = !chatPartner || chatPartner.id !== currentAgent.id;
      setChatPartner({
        type: 'agent',
        id: currentAgent.id,
        name: isNewAgent ? currentAgent.name : (chatPartner?.name || currentAgent.name),
        icon: currentAgent.icon
      });
    }
  }, [currentAgent]);

  // Reset user conversation when switching to agent
  useEffect(() => {
    if (chatPartner?.type === 'agent') setUserConversationId(null);
  }, [chatPartner?.type]);

  // Handle pending task chat from external components
  useEffect(() => {
    if (pendingTaskChat) {
      setChatMode('people');
      setBoundRows([{ table_id: pendingTaskChat.tableId, table_name: '', row_id: pendingTaskChat.rowId, row_title: pendingTaskChat.rowTitle || `#${pendingTaskChat.rowId}` }]);
      setShowBoundRowsBar(true);
      setUserConversationId(pendingTaskChat.conversationId);
      setChatPartner({ type: 'group', id: pendingTaskChat.conversationId, name: pendingTaskChat.rowTitle || `Тикет #${pendingTaskChat.rowId}` });
      if (pendingTaskChat.multi && pendingTaskChat.conversations && pendingTaskChat.conversations.length > 1) {
        setActivePanel('inbox');
      }
      clearPendingTaskChat();
    }
  }, [pendingTaskChat, clearPendingTaskChat]);

  // Load sub_agents from conversation data
  useEffect(() => {
    if (aiConversationData?.sub_agents && Array.isArray(aiConversationData.sub_agents)) {
      const raw = aiConversationData.sub_agents as Array<number | { row_id?: number; id?: number }>;
      const loaded = raw.map(item => typeof item === 'number' ? item : (item?.row_id ?? item?.id ?? null)).filter((id): id is number => typeof id === 'number');
      setSubAgents(loaded);
    }
  }, [aiConversationData?.id]);

  // Restore chatParticipants from conversation data
  useEffect(() => {
    const convData = userConversationData || aiConversationData;
    if (!convData?.participants || !Array.isArray(convData.participants)) return;
    const currentUserId = useAuthStore.getState().user?.id;
    const otherParticipants = (convData.participants as Array<{ user_id: number; name: string; user_type?: string }>)
      .filter(p => currentUserId && p.user_id !== Number(currentUserId))
      .map(p => ({ id: p.user_id, name: p.name, type: (p.user_type === 'agent' ? 'agent' : 'user') as 'user' | 'agent' }));
    if (otherParticipants.length > 0) setChatParticipants(otherParticipants);
  }, [userConversationData?.id, aiConversationData?.id, userParticipantsCount, aiParticipantsCount]);

  // Auto-save sub_agents
  useEffect(() => {
    if (!currentConversationId || subAgents.length === 0) return;
    const timer = setTimeout(() => {
      apiClient.put(`/chat/conversations/${currentConversationId}/sub-agents`, { sub_agents: subAgents }).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [subAgents, currentConversationId]);

  // Focus input when opening
  // (Handled in main component since it needs inputRef)
}
