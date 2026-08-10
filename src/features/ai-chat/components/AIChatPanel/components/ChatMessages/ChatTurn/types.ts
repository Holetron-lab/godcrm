import type { CheckboxClickInfo, CheckboxUser } from '@/shared/components/MarkdownPreview';
import type { ChatMessage } from '../../../types';
import type { ApprovalStatus } from '../ToolApprovalBubble';
import type { PlanTask } from '../PlanWidget';

// ---------------------------------------------------------------------------
// Shared types & helpers (reused from MessageBubble + AgentStepsBubble)
// ---------------------------------------------------------------------------

export interface MessageReaction {
  emoji: string;
  users: { user_id: number; user_name: string }[];
  hasMyReaction: boolean;
}

export interface ToolStep {
  kind: 'tool';
  toolName: string;
  args?: Record<string, unknown>;
  result?: unknown;
  success: boolean;
  /** ID of the tool_result message (for L4 full content fetch) */
  resultMessageId?: number;
  /** Whether the result is truncated (L3 preview mode) */
  _truncated?: boolean;
  /** Full length of original content before truncation */
  _full_length?: number;
}

export interface ThinkingStep {
  kind: 'thinking';
  content: string;
}

export interface ToolApprovalStep {
  kind: 'tool_approval';
  toolName: string;
  args: Record<string, unknown>;
  messageId: number;
  approvalStatus: ApprovalStatus;
  timeoutSeconds: number;
  approvedBy?: string;
  approvedAt?: string;
}

export interface PlanStep {
  kind: 'plan';
  tasks: PlanTask[];
}

export type Step = ToolStep | ThinkingStep | ToolApprovalStep | PlanStep;

// ---------------------------------------------------------------------------
// Section types — a thinking block or a group of consecutive tool calls
// ---------------------------------------------------------------------------

export interface ThinkingSection {
  kind: 'thinking';
  content: string;
}

export interface ToolGroupSection {
  kind: 'tool_group';
  tools: ToolStep[];
}

export interface ToolApprovalSection {
  kind: 'tool_approval';
  step: ToolApprovalStep;
}

export interface PlanSection {
  kind: 'plan';
  tasks: PlanTask[];
}

export type Section = ThinkingSection | ToolGroupSection | ToolApprovalSection | PlanSection;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ChatTurnProps {
  messages: ChatMessage[];                // 1 message for human, N for agent steps
  turnType: 'human' | 'agent';           // Determines badge and avatar
  senderName: string;                     // Display name
  markdownEnabled?: boolean;
  isProcessing?: boolean;
  currentUserId?: number;
  reactions?: Record<string, { user_id: number; user_name: string }[]>;
  quickEmojis?: string[];
  onReact?: (messageId: number, emoji: string) => void;
  onCopy?: (message: ChatMessage) => void;
  onForward?: (message: ChatMessage) => void;
  /** ADR-0031 WP-24: open move-message modal for this message. Only invoked when isChatOwner is true. */
  onMove?: (message: ChatMessage) => void;
  /** ADR-0031 WP-24: current user owns this conversation (current_user.id === conversation.created_by). Drives «Перенести» visibility. */
  isChatOwner?: boolean;
  /** ADR-0068 WP-E: pin a message in this conversation. Visibility gated by `canPin`. */
  onPin?: (messageId: number) => void;
  /** ADR-0068 WP-E: unpin a currently-pinned message. */
  onUnpin?: (messageId: number) => void;
  /** ADR-0068 WP-E: true when current user is allowed to pin in this chat
   *  (group/agent → any participant; DM → owner only). When false, both
   *  pin/unpin entries are hidden from the turn footer. */
  canPin?: boolean;
  onDelete?: (messageId: number) => void;
  onCheckboxClick?: (info: CheckboxClickInfo) => void;
  currentUser?: CheckboxUser;
  onOpenTerminal?: (sessionId?: number) => void;
  /** Callback when a @mention or /command is clicked in message text */
  onMentionClick?: (token: string) => void;
  /** First turn in a consecutive group from same sender type — show header */
  isFirstInGroup?: boolean;
  /** Last turn in a consecutive group from same sender type — show footer timestamp */
  isLastInGroup?: boolean;
  /** Conversation ID for tool approval API calls (Ticket #74078) */
  conversationId?: number;
  /** Called after a tool approval is granted */
  onToolApprove?: (messageId: number, alwaysAllow?: boolean) => void;
  /** Called after a tool approval is denied */
  onToolReject?: (messageId: number) => void;
  /** Agent chain color for visual connector (hex or CSS color) */
  agentColor?: string;
  /** Agent icon emoji */
  agentIcon?: string;
  /** Agent invocation mode — controls role-badge icon: ⚡ for `command`, 🤖 otherwise (ADR-0057) */
  agentInvocationMode?: 'mention' | 'command' | 'both' | null;
  /** Agent chain ID for data attribute used by scroll-to-continue */
  agentChainId?: string;
  /** Whether this turn is a continuation of an interrupted agent chain */
  isContinuation?: boolean;
  /** Whether this agent turn has more segments later (was interrupted) */
  hasMoreSegments?: boolean;
  /** Agent slugs invoked in reasoning (<<@slug>> in thinking blocks) — shows invocation banner */
  invokedAgents?: string[];
  /** Callback to continue/re-invoke agent from this turn */
  onContinueAgent?: () => void;
  /** Callback to stop the running agent */
  onStopAgent?: () => void;
  /** L2: fetch thinking/reasoning steps */
  fetchThinkingSteps?: (afterId: number, beforeId: number) => Promise<ChatMessage[]>;
  /** L3: fetch tool calls with truncated results */
  fetchToolStepsPreview?: (afterId: number, beforeId: number) => Promise<ChatMessage[]>;
  /** L4: fetch full content of single message */
  fetchFullMessage?: (messageId: number) => Promise<{ id: number; content: string; content_type: string } | null>;
  /** Legacy: fetch all hidden steps at once */
  fetchToolSteps?: (afterId: number, beforeId: number) => Promise<ChatMessage[]>;
  /** Whether this turn is selected for forwarding (orange highlight) */
  isForwarded?: boolean;
  /** Whether this turn is queued for move (cyan highlight) */
  isMoved?: boolean;
  /** True if this agent is active (processing) anywhere in the chat */
  isAgentActiveInChat?: boolean;
  /** Callback when agent name is clicked in header */
  onAgentNameClick?: () => void;
  /** Sender avatar URL for human turns */
  senderAvatar?: string;
  /** ADR-0031 §Z / WP-24: navigate to a different conversation when ChatLinkCard is clicked */
  onNavigateToConversation?: (conversationId: number, messageId?: number) => void;
  /** ADR-0031: row_mutation event emitted by the service on the actor's
   *  behalf — header swaps role badge for a "system" badge. */
  isSystemEvent?: boolean;
}

export interface TurnHeaderProps {
  turnType: 'human' | 'agent';
  senderName: string;
  timestamp: string;
  /** End timestamp for time range display (e.g. "10:30 – 10:45") */
  timestampEnd?: string;
  /** Agent work span in ms (first→last message in bubble) — shown next to the
   *  time range so users see the real duration even when start/end share a minute. */
  durationMs?: number;
  isProcessing?: boolean;
  /** Agent color for the dot indicator */
  agentColor?: string;
  /** Agent icon emoji */
  agentIcon?: string;
  /** Agent invocation mode — controls role-badge icon: ⚡ for `command`, 🤖 otherwise (ADR-0057) */
  agentInvocationMode?: 'mention' | 'command' | 'both' | null;
  /** Total token count from metadata */
  tokenCount?: number;
  /** Agent row ID (shown on hover) */
  agentRowId?: number;
  /** Job DB ID / worker ID (shown on hover) */
  jobDbId?: number;
  /** True if this agent is active (processing) anywhere in the chat */
  isAgentActiveInChat?: boolean;
  /** Callback when agent name is clicked */
  onAgentNameClick?: () => void;
  /** Sender avatar URL for human turns */
  senderAvatar?: string;
  /** ADR-0031 (broadened): message emitted by the service on behalf of an
   *  actor (row_mutation, call summary, future notifications). Replaces the
   *  human/bot role badge with a "system" badge AND adds a microchip overlay
   *  in the bottom-right corner of the avatar. */
  isSystemEvent?: boolean;
}

export interface ToolGroupAccordionProps {
  tools: ToolStep[];
  terminalSessionId?: number;
  onOpenTerminal?: (sessionId?: number) => void;
  /** L4: fetch full content of a single message */
  fetchFullMessage?: (messageId: number) => Promise<{ id: number; content: string; content_type: string } | null>;
  /** Start with tools list expanded (skip the "Used N tools" toggle) */
  startExpanded?: boolean;
}

export interface ThinkingBlockProps {
  content: string;
  markdownEnabled?: boolean;
}

export interface ToolStepsAccordionProps {
  steps: Step[];
  totalToolCount: number;
  terminalSessionId?: number;
  onOpenTerminal?: (sessionId?: number) => void;
  markdownEnabled?: boolean;
  conversationId?: number;
  onToolApprove?: (messageId: number, alwaysAllow?: boolean) => void;
  onToolReject?: (messageId: number) => void;
  /** L4: fetch full content of a single message (for expanding truncated tool results) */
  fetchFullMessage?: (messageId: number) => Promise<{ id: number; content: string; content_type: string } | null>;
  /** Start with tool groups expanded (pass through to ToolGroupAccordion) */
  startExpanded?: boolean;
}

/** A chronological group of hidden steps (thinking or tools) between visible messages */
export interface StepGroup {
  type: 'thinking' | 'tools';
  count: number;
  first_id: number;
  last_id: number;
  /** Preview text for thinking groups (first ~150 chars) */
  preview?: string;
}

export interface TurnBodyProps {
  messages: ChatMessage[];
  turnType: 'human' | 'agent';
  markdownEnabled: boolean;
  isProcessing: boolean;
  /** Whether this agent turn was interrupted (has more segments later) */
  hasMoreSegments?: boolean;
  /** Agent slugs invoked in reasoning (<<@slug>> in thinking blocks) — shows invocation banner */
  invokedAgents?: string[];
  onCheckboxClick?: (info: CheckboxClickInfo) => void;
  currentUser?: CheckboxUser;
  onOpenTerminal?: (sessionId?: number) => void;
  onMentionClick?: (token: string) => void;
  onForward?: (message: ChatMessage) => void;
  conversationId?: number;
  onToolApprove?: (messageId: number, alwaysAllow?: boolean) => void;
  onToolReject?: (messageId: number) => void;
  /** L2: fetch thinking/reasoning steps */
  fetchThinkingSteps?: (afterId: number, beforeId: number) => Promise<ChatMessage[]>;
  /** L3: fetch tool calls with truncated results */
  fetchToolStepsPreview?: (afterId: number, beforeId: number) => Promise<ChatMessage[]>;
  /** L4: fetch full content of single message */
  fetchFullMessage?: (messageId: number) => Promise<{ id: number; content: string; content_type: string } | null>;
  /** Legacy: fetch all hidden steps at once */
  fetchToolSteps?: (afterId: number, beforeId: number) => Promise<ChatMessage[]>;
  /** Callback to continue/re-invoke agent from this turn */
  onContinueAgent?: () => void;
  /** ADR-0031 P5: navigate to a different conversation and scroll to a moved message */
  onNavigateToConversation?: (conversationId: number, messageId?: number) => void;
}

export interface TurnFooterProps {
  reactableMessageId: number | null;
  reactionList: MessageReaction[];
  quickEmojis: string[];
  onReact?: (messageId: number, emoji: string) => void;
  onCopy?: (message: ChatMessage) => void;
  onForward?: (message: ChatMessage) => void;
  /** ADR-0031 WP-24: open move-message modal */
  onMove?: (message: ChatMessage) => void;
  /** ADR-0031 WP-24: visibility gate for «Перенести» button */
  isChatOwner?: boolean;
  /** ADR-0068 WP-E — pin/unpin handlers (visibility gated by `canPin`). */
  onPin?: (messageId: number) => void;
  onUnpin?: (messageId: number) => void;
  canPin?: boolean;
  onDelete?: (messageId: number) => void;
  primaryMessage: ChatMessage | null;
  allMessages?: ChatMessage[];
  turnType: 'human' | 'agent';
  currentUserId?: number;
  onContinueAgent?: () => void;
  onStopAgent?: () => void;
  isProcessing?: boolean;
  /** Agent turn stopped without final text response */
  isIncomplete?: boolean;
  /** Agent row ID (for tooltip) */
  agentRowId?: number;
  /** Job DB ID (for tooltip) */
  jobDbId?: number;
}
