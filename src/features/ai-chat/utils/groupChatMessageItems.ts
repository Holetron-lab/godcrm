/**
 * groupChatMessageItems.ts
 * ADR-092: Unified Turn Grouping for ChatConversationView (Telegram-style chat)
 *
 * Groups a flat ChatMessageItem[] array into ChatMessageItemTurn[] for rendering:
 * - Consecutive user messages from same sender → single human turn
 * - Agent thinking + tool_call + tool_result + final text → single agent turn
 * - Date separators preserved as separate items
 */

import type { ChatMessageItem } from '../components/ChatConversationView';

// ---------------------------------------------------------------------------
// Turn — the unit rendered by ChatConversationView
// ---------------------------------------------------------------------------

export interface ChatMessageItemTurn {
  /** Stable key for React */
  id: string;
  /** 'human' for user messages, 'agent' for assistant/tool/thinking groups */
  turnType: 'human' | 'agent';
  /** Whether this is the current user's message */
  isOwn: boolean;
  /** Sender info (from first message in group) */
  sender?: ChatMessageItem['sender'];
  /** Grouped messages — 1 for simple, N for agent steps */
  messages: ChatMessageItem[];
  /** Whether this is the first message in a consecutive group from same sender */
  isFirstInGroup: boolean;
  /** Whether this is the last message in a consecutive group from same sender */
  isLastInGroup: boolean;
  /** Whether agent is still processing */
  isProcessing: boolean;
}

/**
 * Groups flat ChatMessageItem[] into ChatMessageItemTurn[] suitable for
 * the Telegram-style ChatConversationView rendering.
 *
 * Agent messages with contentType (thinking, tool_call, tool_result)
 * are grouped together into a single agent turn with the final text.
 * Consecutive user messages from the same sender are grouped into a
 * single human turn.
 */
export function groupChatMessageItems(
  messages: ChatMessageItem[],
  opts: {
    chatType: 'agent' | 'direct' | 'group' | 'task';
    currentUserId?: number;
    isAgentProcessing?: boolean;
  },
): ChatMessageItemTurn[] {
  const { chatType, currentUserId, isAgentProcessing = false } = opts;
  const turns: ChatMessageItemTurn[] = [];

  let currentAgentMessages: ChatMessageItem[] = [];
  let currentAgentSenderId: number | string | undefined;
  let currentHumanMessages: ChatMessageItem[] = [];
  let currentHumanSenderId: number | string | undefined;
  /** Buffer for consecutive standalone agent text messages (no tool steps) */
  let currentAgentTextMessages: ChatMessageItem[] = [];
  let currentAgentTextSenderId: number | string | undefined;
  let turnCounter = 0;

  const isOwnMessage = (msg: ChatMessageItem): boolean => {
    if (chatType === 'agent') {
      return msg.role === 'user';
    }
    return !!(currentUserId && msg.sender?.id === currentUserId);
  };

  /** Flush accumulated agent steps into a turn */
  const flushAgentSteps = (processing = false) => {
    if (currentAgentMessages.length === 0) return;

    const firstMsg = currentAgentMessages[0];
    turns.push({
      id: `aturn_${firstMsg.id || turnCounter}`,
      turnType: 'agent',
      isOwn: false,
      sender: firstMsg.sender,
      messages: [...currentAgentMessages],
      isFirstInGroup: true,
      isLastInGroup: true,
      isProcessing: processing,
    });

    currentAgentMessages = [];
    currentAgentSenderId = undefined;
    turnCounter++;
  };

  /** Flush accumulated consecutive standalone agent text messages into a single turn */
  const flushAgentTextMessages = () => {
    if (currentAgentTextMessages.length === 0) return;

    const firstMsg = currentAgentTextMessages[0];
    turns.push({
      id: `aturn_${firstMsg.id || turnCounter}`,
      turnType: 'agent',
      isOwn: false,
      sender: firstMsg.sender,
      messages: [...currentAgentTextMessages],
      isFirstInGroup: true,
      isLastInGroup: true,
      isProcessing: false,
    });

    currentAgentTextMessages = [];
    currentAgentTextSenderId = undefined;
    turnCounter++;
  };

  /** Flush accumulated consecutive human messages into a single turn */
  const flushHumanMessages = () => {
    if (currentHumanMessages.length === 0) return;

    const firstMsg = currentHumanMessages[0];
    turns.push({
      id: `hturn_${firstMsg.id || turnCounter}`,
      turnType: 'human',
      isOwn: isOwnMessage(firstMsg),
      sender: firstMsg.sender,
      messages: [...currentHumanMessages],
      isFirstInGroup: true,
      isLastInGroup: true,
      isProcessing: false,
    });

    currentHumanMessages = [];
    currentHumanSenderId = undefined;
    turnCounter++;
  };

  for (const msg of messages) {
    const ct = msg.contentType;

    // ── User messages: group consecutive from same sender ──
    if (msg.role === 'user') {
      flushAgentSteps();
      flushAgentTextMessages();

      const senderId = msg.sender?.id ?? '__me__';
      const isSameSender =
        currentHumanMessages.length > 0 &&
        (senderId === currentHumanSenderId ||
          senderId === '__me__' ||
          currentHumanSenderId === '__me__');

      if (isSameSender) {
        currentHumanMessages.push(msg);
        if (currentHumanSenderId === '__me__' && senderId !== '__me__') {
          currentHumanSenderId = senderId;
        }
        continue;
      }

      // Different sender or first message — flush previous
      flushHumanMessages();
      currentHumanSenderId = senderId;
      currentHumanMessages.push(msg);
      continue;
    }

    // ── Any non-user message flushes human batch ──
    flushHumanMessages();

    // Agent step types: thinking, tool_call, tool_result
    if (ct === 'thinking' || ct === 'tool_call' || ct === 'tool_result') {
      flushAgentTextMessages(); // steps start a new agent turn
      // Different agent sender → flush previous agent steps first
      const agentSenderId = msg.sender?.id ?? '__agent__';
      if (currentAgentMessages.length > 0 && agentSenderId !== currentAgentSenderId && currentAgentSenderId !== '__agent__' && agentSenderId !== '__agent__') {
        flushAgentSteps();
      }
      currentAgentSenderId = agentSenderId;
      currentAgentMessages.push(msg);
      continue;
    }

    // 'text' from assistant after tool steps → attach to agent steps as final response
    if (msg.role === 'assistant' && ct === 'text' && currentAgentMessages.length > 0) {
      currentAgentMessages.push(msg);
      flushAgentSteps();
      continue;
    }

    // Regular message (no contentType, or plain assistant text without prior steps)
    flushAgentSteps();

    // Check if it's an agent-type message
    const isAgent = msg.role === 'assistant' || msg.role === 'tool' || msg.role === 'system';

    if (isAgent) {
      // Standalone agent text — buffer for merging consecutive same-sender agent messages
      const agentSenderId = msg.sender?.id ?? '__agent__';
      const isSameAgentSender =
        currentAgentTextMessages.length === 0 ||
        agentSenderId === currentAgentTextSenderId ||
        agentSenderId === '__agent__' ||
        currentAgentTextSenderId === '__agent__';

      if (!isSameAgentSender) {
        flushAgentTextMessages();
      }
      currentAgentTextSenderId = agentSenderId;
      currentAgentTextMessages.push(msg);
    } else {
      // Standalone human message
      flushAgentTextMessages();
      turns.push({
        id: `hturn_${msg.id || turnCounter}`,
        turnType: 'human',
        isOwn: isOwnMessage(msg),
        sender: msg.sender,
        messages: [msg],
        isFirstInGroup: true,
        isLastInGroup: true,
        isProcessing: false,
      });
      turnCounter++;
    }
  }

  // Flush remaining
  flushHumanMessages();
  flushAgentTextMessages();
  flushAgentSteps(isAgentProcessing);

  return turns;
}
