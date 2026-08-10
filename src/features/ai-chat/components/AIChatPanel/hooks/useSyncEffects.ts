/**
 * useSyncEffects — Lifecycle effects for syncing state between AIChatPanel sub-systems.
 * Extracted from AIChatPanel.tsx (various useEffect blocks: lines 1194-1480, 539-548, 613-639).
 */
import { useEffect, useRef } from 'react';
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
  setIsAgentProcessing: (processing: boolean) => void;
  dismissProcessing: () => void;
  aiBackendProcessingAgentName: string | null | undefined;
  setProcessingAgentName: (name: string) => void;
  // Mark as read on load
  userConversationId: number | null;
  userConversationData: { id?: number; participants?: unknown[]; bound_table_id?: number | null; bound_row_id?: number | null } | null | undefined;
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
  // Conversation data
  aiConversationData: { id?: number; sub_agents?: Array<number | { row_id?: number; id?: number }>; participants?: Array<{ user_id: number; name: string; user_type?: string }>; bound_table_id?: number | null; bound_row_id?: number | null } | null | undefined;
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
    aiBackendProcessing, isAgentProcessing, setIsAgentProcessing, dismissProcessing,
    aiBackendProcessingAgentName, setProcessingAgentName,
    userConversationId, userConversationData, markAsRead, refetchUnread,
    isOpen, agents, defaultAgentId, selectAgent, loadAgents, loadConversations,
    isMobile, chatPartner, setChatPartner, setUserConversationId,
    pendingTaskChat, clearPendingTaskChat, setChatMode, setBoundRows, setShowBoundRowsBar, setActivePanel,
    aiConversationData, currentConversationId,
    setChatParticipants, userParticipantsCount, aiParticipantsCount,
    processingStartedAt, setProcessingElapsed,
  } = params;

  // Processing timer moved into <ProcessingStatusBar/> — running it here used
  // to setState every second on the panel root, which remounted ChatTurn DOM
  // and killed selection/table-scroll. The bar owns its own tick now.
  void processingStartedAt; void setProcessingElapsed;

  // Sync chat settings when agent changes
  useEffect(() => {
    if (currentAgent) {
      setChatOperatorId(currentAgent.provider_id || currentAgent.operator_id || null);
      setChatModelId(currentAgent.model || '');
      setChatSystemPrompt(currentAgent.system_prompt || '');
    }
  }, [currentAgent]);

  // Sync backend processing state — bidirectional
  // When backend says processing=true (from polling) but context doesn't know yet → activate fast polling
  // When backend says processing=false but context still thinks processing → dismiss
  useEffect(() => {
    if (aiBackendProcessing === true && !isAgentProcessing) {
      logger.info('[SyncEffects] Backend processing detected via polling — activating context processing state');
      setIsAgentProcessing(true);
    } else if (aiBackendProcessing === false && isAgentProcessing) {
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

  // Sync boundRows from active conversation's server-side binding on conv switch.
  // Why: boundRows lives in chat-panel local state; some switch paths (contacts
  // "open chat", tasks open-existing) don't clear it, so a row attached in chat A
  // would leak into chat B. Ref-guard ensures we only sync once per conv switch,
  // so local "+"-binds within the same chat aren't clobbered by polling refetches.
  const syncedConvIdRef = useRef<number | null>(null);
  useEffect(() => {
    const isAgent = chatPartner?.type === 'agent';
    const activeConvId = isAgent ? currentConversationId : userConversationId;
    if (!activeConvId) return;
    const conv = isAgent ? aiConversationData : userConversationData;
    if (!conv) return;
    if (conv.id != null && conv.id !== activeConvId) return; // stale data from prev conv
    if (syncedConvIdRef.current === activeConvId) return;
    syncedConvIdRef.current = activeConvId;
    if (conv.bound_table_id && conv.bound_row_id) {
      setBoundRows([{ table_id: conv.bound_table_id, table_name: '', row_id: conv.bound_row_id, row_title: `#${conv.bound_row_id}` }]);
      setShowBoundRowsBar(true);
    } else {
      setBoundRows([]);
      setShowBoundRowsBar(false);
    }
  }, [chatPartner?.type, currentConversationId, userConversationId, aiConversationData, userConversationData]);

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

  // Focus input when opening
  // (Handled in main component since it needs inputRef)
}
