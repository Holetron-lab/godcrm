/**
 * AIChatPanel.types.ts
 * Local types used by AIChatPanel and its extracted sub-components.
 * For shared types, see AIChatPanel/types/index.ts
 */

// Inbox conversation type (local to AIChatPanel render functions)
export interface InboxConversation {
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
}

export interface FilesSourceConfig {
  tableId: number;
  tableName: string;
  tableIcon?: string;
  projectId?: number;
}

export interface AIChatPanelProps {
  className?: string;
}

export type PanelTab = 'none' | 'contacts' | 'ai-agents' | 'tasks' | 'settings' | 'inbox';

// API response wrapper type
export interface ApiResponse<T> {
  success: boolean;
  data: T;
}
