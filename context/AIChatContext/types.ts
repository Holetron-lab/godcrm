import type { ReactNode } from 'react';
import type { AIAgent, ChatMessage, ChatAttachment, AIChatState } from '../../types';

export interface Conversation {
  id: number;
  title: string;
  agent_id?: number;
  agent_table_id?: number;
  lab_id?: string;
  agentName?: string;
  agentIcon?: string;
  spaceId?: number;
  messagesCount: number;
  lastMessage?: string;
  createdAt: string;
  updatedAt: string;
  sub_agents?: Array<{ row_id: number; name: string; icon?: string | null; response_mode?: string }>;
  bound_table_id?: number | null;
  bound_row_id?: number | null;
}

export interface Mention {
  id: number;
  name: string;
  type: 'human' | 'agent' | 'bot' | 'service';
}

// Pending task chat - for opening ticket chats from external components
export interface PendingTaskChat {
  conversationId: number;
  tableId: number;
  rowId: number;
  rowTitle?: string;
  // Multi-conversation support: when a row has multiple bound conversations
  multi?: boolean;
  conversations?: Array<{
    id: number;
    title: string | null;
    type: string;
    created_at: string;
    updated_at: string;
    messages_count: number;
  }>;
}

export interface AIChatContextValue extends AIChatState {
  // Chat panel controls
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;

  // Agent controls
  selectAgent: (agent: AIAgent) => void;
  loadAgents: () => Promise<void>;

  // ADR-093: Unified single sendMessage() path via POST /chat/conversations/:id/messages
  // No more /ai/run or /ai/chat — backend handles agent execution asynchronously
  // Ticket #77794: Added rowAttachments param for attaching table rows to messages
  sendMessage: (content: string, attachments?: File[], modelId?: number, mentions?: Mention[], agentMode?: boolean, systemPromptPrefix?: string, subAgentRowIds?: number[], rowAttachments?: Array<{ id: string; name: string; type: string; size: number; rowReference: { table_id: number; row_id: number; table_name: string; table_icon?: string; row_title?: string } }>) => Promise<void>;
  clearMessages: () => void;

  // Agent mode toggle
  agentMode: boolean;
  setAgentMode: (mode: boolean) => void;

  // Agent processing state - true while backend is executing agent (messages arrive via polling)
  isAgentProcessing: boolean;
  processingAgentName: string | null; // Name of the agent currently processing (from backend)
  processingStartedAt: number | null; // Ticket #36708: timestamp when processing began (for elapsed time display)
  setProcessingAgentName: (name: string | null) => void;
  dismissProcessing: () => void;
  resetProcessing: () => Promise<void>; // Ticket #36708: force-clear stuck processing state (calls backend)
  stopAgent: () => Promise<void>; // Stop the running agent (kills worker process)

  // Pagination for AI conversations
  hasMoreAIMessages: boolean;
  isFetchingOlderAIMessages: boolean;
  fetchOlderAIMessages: () => Promise<void>;

  // Conversation controls
  conversations: Conversation[];
  currentConversationId: number | null;
  loadConversations: () => Promise<void>;
  selectConversation: (id: number) => Promise<{ title?: string | null; bound_table_id?: number | null; bound_row_id?: number | null } | void>;
  createNewConversation: () => Promise<void>;
  deleteConversation: (id: number) => Promise<void>;
  renameConversation: (id: number, title: string) => Promise<void>;
  isLoadingConversations: boolean;

  // History agent filter — null means show all agents
  historyAgentFilter: number | null;
  setHistoryAgentFilter: (agentId: number | null) => void;

  // ADR-043: Labs integration
  labId: string | null;
  setLabId: (labId: string | null) => void;

  // Space context - exposed for components that need current space ID
  spaceId: number | undefined;

  // ADR-069: Open task/ticket chat from external components (e.g., Documents widget)
  pendingTaskChat: PendingTaskChat | null;
  openTaskChat: (chat: PendingTaskChat) => void;
  clearPendingTaskChat: () => void;

  // Multi-conversation row filter — when a row has multiple bound conversations
  rowFilter: { tableId: number; rowId: number; rowTitle: string; conversations: PendingTaskChat['conversations'] } | null;
  clearRowFilter: () => void;
}

export interface AIChatProviderProps {
  children: ReactNode;
  spaceId?: number;
}

// Re-export types from parent for convenience
export type { AIAgent, ChatMessage, ChatAttachment, AIChatState };
