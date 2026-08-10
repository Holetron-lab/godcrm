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
  /** ADR-0057: how this agent can be invoked from chat.
   *  - `mention`  → only `<<@slug>>` triggers the agent
   *  - `command`  → only `<</slug>>` triggers (ephemeral, no chat participant)
   *  - `both`     → either form works (default for migrated agents)
   *  Backend dispatcher gating is a follow-up; this field is persisted today
   *  via `PUT /ai/agents/:id` and shown in the edit modal. */
  invocation_mode?: 'mention' | 'command' | 'both';
  /** ADR-0057 quick-command payload. Stored as JSON array on the agent row;
   *  `<</slug/N>>` resolves to `main_instructions[N]`. Each item is either a
   *  plain string or `{ label?, content }`. */
  main_instructions?: string | Array<string | { label?: string; content: string }> | null;
  /** Universal-table id of the row this agent was loaded from — used to open
   *  the kanban-style RowViewerModal from the agents panel. */
  table_id?: number;
  /** ADR-0079 §2: per-space binding visibility tier. Absent on legacy rows.
   *  - `default`  → Tier-A, always visible in pickers
   *  - `unlocked` → Tier-B that was unlocked (promo or Settings → Add Agent)
   *  - `locked`   → Tier-B not yet unlocked; hidden from invocation pickers */
  visibility?: 'default' | 'unlocked' | 'locked' | null;
}

export type QuickCommandItem = { label?: string; content: string };

// ADR-0031 WP-20+21 (T-141238): 'widget_embed' is the chat content_type used when
// an agent (or user) embeds a live mini-widget (list/kanban/table) of CRM rows
// directly in chat. Backend whitelist mirrors this list; see
// backend/routes/v3/chat/messageController.js ALLOWED_POST_CONTENT_TYPES.
// ADR-0059 §4.8: 'call' is emitted by backend `/call/transcribe` after a
// voice call ends — system message with diarized dialogue in metadata.
export type MessageContentType = 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'tool_approval' | 'plan' | 'agent_status' | 'row_mutation' | 'moved' | 'widget_embed' | 'call';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  agentId?: number;
  agentName?: string;
  agent_color?: string;
  agent_icon?: string;
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
  // ADR-0068 WP-E — `null` (or absent) = not pinned; ISO timestamp = pinned.
  pinned_at?: string | null;
  // Progressive lazy loading: separate counts for thinking vs tool steps
  _thinking_steps_before?: number;
  _thinking_steps_after?: number;
  _tool_steps_before?: number;
  _tool_steps_after?: number;
  // Hidden step ID range boundaries (for accurate lazy-load fetch range)
  _hidden_thinking_min_id?: number;
  _hidden_thinking_max_id?: number;
  _hidden_tool_min_id?: number;
  _hidden_tool_max_id?: number;
  // L3: truncated tool_result content
  _truncated?: boolean;
  _full_length?: number;
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

// ADR-0031 WP-20+21 (T-141238): widget_embed attachment payload — agent or user
// embeds a live mini-widget (list/kanban/table) of CRM rows in a chat message.
// `filter` accepts either {column,value} (single-column shape per task brief) or
// a Record<string, unknown> column→value map (matches backend system-prompt docs
// and the send_chat_message tool definition). The chat embedded widget renderer
// normalizes both shapes.
export interface WidgetEmbedConfig {
  table_id: number;
  view: 'list' | 'kanban' | 'table';
  filter?: { column: string; value: unknown } | Record<string, unknown>;
  columns?: string[];
  limit?: number;
  // Optional kanban-specific: column to group by (lanes). Defaults to a
  // best-effort pick (status / state / phase) when omitted.
  group_by?: string;
}

export interface ChatAttachment {
  id: string;
  name: string;
  type: string;  // 'file' | 'row_reference' | 'widget_embed' | MIME type
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
  // ADR-0031 WP-20+21 (T-141238): present when type === 'widget_embed'.
  widgetEmbed?: WidgetEmbedConfig;
}

// ADR-0031 WP-20+21 (T-141238): narrowed alias for chat attachments that carry
// a live widget embed. Used by ChatEmbeddedWidget for type-safe rendering.
export type WidgetEmbedAttachment = ChatAttachment & {
  type: 'widget_embed';
  widgetEmbed: WidgetEmbedConfig;
};

// Type-guard: returns true when an attachment carries a usable widget embed.
export function isWidgetEmbedAttachment(att: ChatAttachment): att is WidgetEmbedAttachment {
  return att?.type === 'widget_embed' && !!att.widgetEmbed && typeof att.widgetEmbed.table_id === 'number';
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
