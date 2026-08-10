// Thin re-export shim — real implementation lives in ./ai-agents/.
// Split from the original 1795-line monolith (see ADR on widget refactors).
export { AIAgentsWidget } from './ai-agents';
export type {
  AIAgent,
  AIModel,
  AIOperator,
  ChatMessage,
  ChatAttachment,
  Conversation,
  ToolResult,
} from './ai-agents';
