export interface AIAgent {
  id: number;
  name: string;
  description: string;
  model: string;
  model_name?: string;
  model_id?: number;
  system_prompt: string;
  provider: string;
  provider_name?: string;
  provider_id?: number;
  operator_id?: number;
  icon?: string;
  color?: string;
  is_active: boolean;
  api_key_id?: string | number;
  tools?: string[];
  tags?: string[];
  space_id?: number;
  space_name?: string;
  status?: string;
  response_mode?: 'always' | 'topic_only' | 'mention_only';
}

export type MessageContentType = 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'tool_approval' | 'plan';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  agentId?: number;
  agentName?: string;
  timestamp: Date;
  attachments?: ChatAttachment[];
  isStreaming?: boolean;
  error?: string;
  // Agent mode extras
  toolResults?: ToolResult[];
  iterations?: number;
  // Step message fields (message-per-tool-call architecture)
  contentType?: MessageContentType;
  senderType?: 'human' | 'agent' | 'system';
  parentId?: number;
  // User chat extras (ADR-024)
  sender_id?: number;
  conversation_id?: number;
  // Sender info from backend (users JOIN)
  sender_name?: string;
  sender_avatar?: string;
  sender_user_type?: 'human' | 'agent' | 'bot' | 'service' | string;
  // Message state
  is_deleted?: boolean;
  deleted_at?: string;
  is_edited?: boolean;
  // Lazy loading: count of hidden tool/thinking steps before this message
  _tool_steps_before?: number;
  _tool_steps_after?: number;
  // Message metadata (from backend - agent info, sender info, etc.)
  metadata?: {
    agent_name?: string;
    agent_row_id?: number;
    // Tool approval metadata (ADR-078)
    approval_status?: 'pending' | 'approved' | 'rejected' | 'timeout';
    timeout_seconds?: number;
    approved_by?: string;
    approved_at?: string;
    [key: string]: unknown;
  };
}

export interface ToolResult {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface ChatAttachment {
  id: string;
  name: string;
  type: string;  // 'file' | 'row_reference' | MIME type
  size: number;
  url?: string;
  preview?: string;
  // Ticket #77794: Row reference attachment (any table row attached to message)
  rowReference?: {
    table_id: number;
    row_id: number;
    table_name: string;
    table_icon?: string;
    row_title?: string;
  };
}

export interface ChatSession {
  id: string;
  agentId: number;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AIChatState {
  isOpen: boolean;
  currentAgent: AIAgent | null;
  agents: AIAgent[];
  messages: ChatMessage[];
  isLoading: boolean;
  isLoadingAgents: boolean;
  isStreaming: boolean;
  error: string | null;
}

export interface SendMessagePayload {
  message: string;
  agentId: number;
  attachments?: File[];
}
