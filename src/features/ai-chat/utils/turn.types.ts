import type { ChatMessage } from '../types';

// ---------------------------------------------------------------------------
// Turn — the unit rendered by <ChatTurn />
// ---------------------------------------------------------------------------

export interface Turn {
  /** Stable key for React — uses first message id or a generated index-based id */
  id: string;
  /** 'human' for user messages, 'agent' for assistant/tool/thinking groups */
  turnType: 'human' | 'agent';
  /** Display name for the turn header */
  senderName: string;
  /** One message for human turns; potentially many for agent turns (steps + final text) */
  messages: ChatMessage[];
  /** Latest plan shown on this agent’s newest turn; null hides historical plans. */
  planMessage?: ChatMessage | null;
  /** Reactions keyed by message id */
  reactions: Record<string, { user_id: number; user_name: string }[]>;
  /** Whether this turn is still being processed (streaming / agent working) */
  isProcessing: boolean;
  /** First turn in a consecutive group from the same sender type — show header */
  isFirstInGroup: boolean;
  /** Last turn in a consecutive group from the same sender type — show footer/border */
  isLastInGroup: boolean;
  /** Chain identifier for grouping concurrent agent work (e.g. "agent_Developer_42") */
  agentChainId?: string;
  /** Agent color from agent table (hex or CSS color) */
  agentColor?: string;
  /** Agent icon emoji */
  agentIcon?: string;
  /** Agent invocation mode — ⚡ for `command`, 🤖 otherwise (ADR-0057) */
  agentInvocationMode?: 'mention' | 'command' | 'both' | null;
  /** True if this agent turn is a continuation of a chain interrupted by other turns */
  isContinuation?: boolean;
  /** True if another segment of this agent chain exists later in the conversation */
  hasMoreSegments?: boolean;
  /** Agent slugs invoked in reasoning (<<@slug>> detected in thinking blocks) */
  invokedAgents?: string[];
  /** ISO timestamp of the last message in this turn — used for stale detection on processing bubbles */
  lastMessageAt?: string;
  /** True if the same agent (by senderName) has ANY processing turn in the chat */
  isAgentActiveInChat?: boolean;
  /** Sender avatar URL (from message sender_avatar field) */
  senderAvatar?: string;
  /** ADR-0031: turn is a row_mutation event emitted by the system on behalf of
   *  an actor. The header still shows the actor's avatar + name (so it reads
   *  like the actor's message), but the role badge is replaced with a "system"
   *  badge to clarify the message was authored by the service, not typed. */
  isSystemEvent?: boolean;
}
