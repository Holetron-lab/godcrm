/**
 * AIChatPanel.types.ts
 * Local types used by AIChatPanel and its extracted sub-components.
 * For shared types, see AIChatPanel/types/index.ts
 */

// Inbox conversation type (local to AIChatPanel render functions)
export interface InboxConversation {
  settings?: { description?: string; icon?: string } | string | null;
  id: number;
  title: string | null;
  type: string;
  agent_id?: number;
  agent_name?: string | null;
  agent_icon?: string | null;
  unread_count: number;
  updated_at: string;
  participants: Array<{
    user_id: number;
    name: string;
    email?: string;
    avatar_url?: string;
    user_type?: string;
  }>;
  sub_agents?: Array<{ row_id: number; name: string; icon?: string | null; response_mode?: string }>;
  // Ticket #81438: Enriched bound row fields from backend
  bound_table_id?: number | null;
  bound_row_id?: number | null;
  bound_row_title?: string | null;
  bound_table_name?: string | null;
  bound_table_icon?: string | null;
}

export interface TasksSourceConfig {
  tableId: number;
  tableName: string;
  tableIcon?: string;
  displayColumn?: string;
  descriptionColumn?: string;
  statusColumn?: string;
  priorityColumn?: string;
  statusDictTableId?: number;
  priorityDictTableId?: number;
  preset?: string;
}

export interface FilesSourceConfig {
  tableId: number;
  tableName: string;
  tableIcon?: string;
  projectId?: number;
}

export interface AIChatPanelProps {
  className?: string;
  /**
   * ADR-176 (embed split): fill the host frame instead of using a fixed panel
   * width. Forces the panel's own glue logic on (panelWidth tracks the resizable
   * iframe width, two-column desktop layout above 600px) and hides the in-panel
   * width handle — the split shell's divider is the resize affordance. Default off.
   */
  fillContainer?: boolean;
}

export type PanelTab = 'none' | 'contacts' | 'ai-agents' | 'tasks' | 'documents' | 'settings' | 'inbox';

// API response wrapper type
export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

// Paginated conversations response from backend
export interface PaginatedConversationsResponse {
  conversations: InboxConversation[];
  total_count: number;
  has_more: boolean;
  limit: number;
  offset: number;
}
