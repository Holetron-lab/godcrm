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
  space_id?: number;
  tools?: string[];
  status?: string;
}

// Tool result from AI agent execution
export interface ToolResult {
  tool: string;
  result: unknown;
  args?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentId?: number;
  agentName?: string;
  timestamp: Date | string;
  isStreaming?: boolean;
  error?: string;
  toolResults?: ToolResult[];
  iterations?: number;
  attachments?: ChatAttachment[];
}

export interface ChatAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  preview?: string;
}

export interface Conversation {
  id: number;
  title: string;
  agent_id?: number;
  agent_table_id?: number;
  lab_id?: string;
  agentName?: string;
  messagesCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AIModel {
  id: number;
  name: string;
  model_id: string;
  provider_id?: number;
  operator_id?: number;
}

export interface AIOperator {
  id: number;
  name: string;
  provider?: string;
  type?: string;
  api_key?: string;
  is_active?: boolean;
}
