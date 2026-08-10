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
  /** Agent chain ID for data attribute used by scroll-to-continue */
  agentChainId?: string;
  /** Whether this turn is a continuation of an interrupted agent chain */
  isContinuation?: boolean;
  /** Callback to continue/re-invoke agent from this turn */
  onContinueAgent?: () => void;
  /** Lazy loading: fetch hidden tool steps between two message IDs */
  fetchToolSteps?: (afterId: number, beforeId: number) => Promise<ChatMessage[]>;
}

export interface TurnHeaderProps {
  turnType: 'human' | 'agent';
  senderName: string;
  timestamp: string;
  /** End timestamp for time range display (e.g. "10:30 – 10:45") */
  timestampEnd?: string;
  isProcessing?: boolean;
  /** Agent color for the dot indicator */
  agentColor?: string;
  /** Agent icon emoji */
  agentIcon?: string;
  /** Total token count from metadata */
  tokenCount?: number;
}

export interface ToolGroupAccordionProps {
  tools: ToolStep[];
  terminalSessionId?: number;
  onOpenTerminal?: (sessionId?: number) => void;
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
}

export interface TurnBodyProps {
  messages: ChatMessage[];
  turnType: 'human' | 'agent';
  markdownEnabled: boolean;
  isProcessing: boolean;
  onCheckboxClick?: (info: CheckboxClickInfo) => void;
  currentUser?: CheckboxUser;
  onOpenTerminal?: (sessionId?: number) => void;
  onMentionClick?: (token: string) => void;
  conversationId?: number;
  onToolApprove?: (messageId: number, alwaysAllow?: boolean) => void;
  onToolReject?: (messageId: number) => void;
  /** Lazy loading: fetch hidden tool steps between two message IDs */
  fetchToolSteps?: (afterId: number, beforeId: number) => Promise<ChatMessage[]>;
}

export interface TurnFooterProps {
  reactableMessageId: number | null;
  reactionList: MessageReaction[];
  quickEmojis: string[];
  onReact?: (messageId: number, emoji: string) => void;
  onCopy?: (message: ChatMessage) => void;
  onForward?: (message: ChatMessage) => void;
  onDelete?: (messageId: number) => void;
  primaryMessage: ChatMessage | null;
  turnType: 'human' | 'agent';
  currentUserId?: number;
  onContinueAgent?: () => void;
}
