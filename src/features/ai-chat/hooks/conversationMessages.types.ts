/**
 * Shared types and constants for conversation messages hooks
 * Extracted from useConversationMessages.ts for file size compliance
 */

import { ChatMessage } from '../types';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp?: string;
}

export interface ConversationResponse {
  id: number;
  type: string;
  title: string | null;
  /** ADR-0031 WP-24: user id who created the conversation — required for move-message ownership gate */
  created_by?: number | null;
  messages: ChatMessage[];
  hasMore?: boolean;
  nextCursor?: number;
  sub_agents?: Array<{ row_id: number; name: string; icon?: string | null; response_mode?: string }>;
  participants?: Array<{ user_id: number; name: string; email?: string; avatar_url?: string; role?: string; user_type?: string; joined_at?: string }>;
  bound_table_id?: number | null;
  bound_row_id?: number | null;
}

export interface SendMessageParams {
  content: string;
  contentType?: 'text' | 'markdown' | 'code';
  mentions?: Array<{ user_id: number; offset?: number; length?: number }>;
  parentId?: number;
  agentMode?: 'ask' | 'agent';
  attachments?: Array<{ name: string; type: string; size: number; url?: string; rowReference?: { table_id: number; row_id: number; table_name: string; table_icon?: string; row_title?: string } }>;
  /** Override conversationId (for newly created conversations where closure hasn't updated yet) */
  overrideConversationId?: number;
  /** ADR-0068 WP-C: structured reply-to. Server validates fragment/range against
   *  source content fetched by message_id — sender/content not trusted from client. */
  replyTo?: { message_id: number; fragment?: string; range?: [number, number] };
}

/**
 * ADR-078: Adaptive polling intervals based on chat activity state
 */
export const POLL_INTERVALS = {
  AGENT_PROCESSING: 1000,  // Agent is thinking → fast polling (1s)
  ACTIVE_CHAT: 3000,       // User recently sent message (< 30s ago)
  IDLE_CHAT: 8000,         // No activity for 30s+
  BACKGROUND: 15000,       // Chat panel minimized/hidden
} as const;

/** ADR-078: Chat activity state for adaptive polling */
export type ChatActivityState = 'agent_processing' | 'active' | 'idle' | 'background';

export interface UseConversationMessagesOptions {
  pageSize?: number;
  enabled?: boolean;
  /** Polling interval in ms for fetching new messages from other users.
   *  If set, uses fixed interval. If not set but adaptivePolling is true, uses adaptive. */
  pollingInterval?: number;
  /** ADR-078: Enable adaptive polling based on chat activity */
  adaptivePolling?: boolean;
  /** ADR-078: Current chat activity state (drives adaptive interval) */
  chatActivityState?: ChatActivityState;
  /** Current user ID — used to set sender_id on optimistic messages for correct grouping */
  currentUserId?: number;
}
