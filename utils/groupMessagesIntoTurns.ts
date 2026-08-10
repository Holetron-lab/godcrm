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
  /** True if this agent turn is a continuation of a chain interrupted by other turns */
  isContinuation?: boolean;
  /** True if another segment of this agent chain exists later in the conversation */
  hasMoreSegments?: boolean;
}

/**
 * Groups a flat list of ChatMessages into Turn objects suitable for rendering
 * with `<ChatTurn />`.
 *
 * Consecutive human messages from the same sender are grouped into a single
 * turn — so the header (avatar + name) appears only once for a batch.
 * Agent messages (thinking, tool_call, tool_result, and the final assistant
 * text) are grouped together into a single agent turn.
 */
export function groupMessagesIntoTurns(
  messages: ChatMessage[],
  messageReactions: Record<number, Record<string, { user_id: number; user_name: string }[]>>,
  isAgentProcessing: boolean,
  currentUserId?: number,
): Turn[] {
  const turns: Turn[] = [];
  let currentAgentMessages: ChatMessage[] = [];
  let currentHumanMessages: ChatMessage[] = [];
  let currentHumanSenderId: number | string | undefined = undefined;
  /** Buffer for consecutive standalone agent text messages (no tool steps) */
  let currentAgentTextMessages: ChatMessage[] = [];
  let turnCounter = 0;

  /** Flush accumulated agent steps into a turn. */
  const flushAgentSteps = (processing: boolean = false) => {
    if (currentAgentMessages.length === 0) return;

    const firstMsg = currentAgentMessages[0];
    const primaryMsg =
      currentAgentMessages.find(
        (m) => (m.contentType === 'text' || !m.contentType) && m.role === 'assistant',
      ) || currentAgentMessages[currentAgentMessages.length - 1];

    // Gather reactions for every message in the agent turn
    const reactions: Turn['reactions'] = {};
    for (const m of currentAgentMessages) {
      if (m.id) {
        const msgReactions = messageReactions[Number(m.id)];
        if (msgReactions) {
          Object.assign(reactions, msgReactions);
        }
      }
    }

    const agentName = firstMsg.agentName || firstMsg.metadata?.agent_name || firstMsg.sender_name || 'AI';
    const agentRowId = firstMsg.metadata?.agent_row_id || firstMsg.agentId;
    const chainId = agentRowId ? `agent_${agentName}_${agentRowId}` : `agent_${agentName}`;

    turns.push({
      id: firstMsg.id ? `turn_agent_${firstMsg.id}` : `turn_agent_idx_${turnCounter}`,
      turnType: 'agent',
      senderName: agentName,
      messages: [...currentAgentMessages],
      reactions,
      isProcessing: processing,
      isFirstInGroup: true,  // computed in post-processing pass
      isLastInGroup: true,   // computed in post-processing pass
      agentChainId: chainId,
      agentColor: (firstMsg.metadata?.agent_color as string) || undefined,
      agentIcon: (firstMsg.metadata?.agent_icon as string) || firstMsg.agentName ? undefined : undefined,
    });

    currentAgentMessages = [];
    turnCounter++;
  };

  /** Flush accumulated consecutive human messages into a single turn. */
  const flushHumanMessages = () => {
    if (currentHumanMessages.length === 0) return;

    const reactions: Turn['reactions'] = {};
    for (const m of currentHumanMessages) {
      if (m.id) {
        const msgReactions = messageReactions[Number(m.id)];
        if (msgReactions) {
          // Key reactions by message id so each sub-message keeps its own
          for (const [emoji, users] of Object.entries(msgReactions)) {
            const key = `${emoji}_${m.id}`;
            reactions[key] = users;
          }
        }
      }
    }

    const firstMsg = currentHumanMessages[0];
    // Determine sender name: agent → agentName, self → 'You', other user → sender_name
    let humanSenderName = 'You';
    if (firstMsg.senderType === 'agent') {
      humanSenderName = firstMsg.agentName || firstMsg.metadata?.agent_name || 'AI';
    } else if (firstMsg.sender_name) {
      // Use backend-provided sender name (from users JOIN)
      const isMe = currentUserId != null && firstMsg.sender_id != null && Number(firstMsg.sender_id) === Number(currentUserId);
      humanSenderName = isMe ? 'You' : firstMsg.sender_name;
    }
    turns.push({
      id: firstMsg.id ? `turn_human_${firstMsg.id}` : `turn_human_idx_${turnCounter}`,
      turnType: 'human',
      senderName: humanSenderName,
      messages: [...currentHumanMessages],
      reactions,
      isProcessing: false,
      isFirstInGroup: true,  // computed in post-processing pass
      isLastInGroup: true,   // computed in post-processing pass
    });

    currentHumanMessages = [];
    currentHumanSenderId = undefined;
    turnCounter++;
  };

  /** Flush accumulated consecutive standalone agent text messages into a single turn. */
  const flushAgentTextMessages = () => {
    if (currentAgentTextMessages.length === 0) return;

    const firstMsg = currentAgentTextMessages[0];
    const reactions: Turn['reactions'] = {};
    for (const m of currentAgentTextMessages) {
      if (m.id) {
        const msgReactions = messageReactions[Number(m.id)];
        if (msgReactions) {
          Object.assign(reactions, msgReactions);
        }
      }
    }

    const agentName = firstMsg.agentName || firstMsg.metadata?.agent_name || firstMsg.sender_name || 'AI';
    const agentRowId = firstMsg.metadata?.agent_row_id || firstMsg.agentId;
    const chainId = agentRowId ? `agent_${agentName}_${agentRowId}` : `agent_${agentName}`;

    turns.push({
      id: firstMsg.id ? `turn_agent_${firstMsg.id}` : `turn_agent_idx_${turnCounter}`,
      turnType: 'agent',
      senderName: agentName,
      messages: [...currentAgentTextMessages],
      reactions,
      isProcessing: false,
      isFirstInGroup: true,  // computed in post-processing pass
      isLastInGroup: true,   // computed in post-processing pass
      agentChainId: chainId,
      agentColor: (firstMsg.metadata?.agent_color as string) || undefined,
      agentIcon: (firstMsg.metadata?.agent_icon as string) || undefined,
    });

    currentAgentTextMessages = [];
    turnCounter++;
  };

  for (const msg of messages) {
    const ct = msg.contentType;

    // ── User messages: group consecutive from same sender ──
    if (msg.role === 'user') {
      flushAgentSteps();
      flushAgentTextMessages();

      // Normalize sender_id for comparison:
      // - numeric sender_id → use the number
      // - undefined/null (optimistic messages before server response) → '__me__'
      // Two messages are from the "same sender" when:
      //   1. Both have the same numeric sender_id, OR
      //   2. At least one is '__me__' (optimistic) — treat as same sender since
      //      the current user is the only one who can send optimistic messages.
      const senderId = msg.sender_id != null ? Number(msg.sender_id) : '__me__';
      const isSameSender =
        currentHumanMessages.length > 0 &&
        (senderId === currentHumanSenderId ||
          senderId === '__me__' ||
          currentHumanSenderId === '__me__');

      if (isSameSender) {
        currentHumanMessages.push(msg);
        // Upgrade the tracked sender id from '__me__' to a real id when available
        if (currentHumanSenderId === '__me__' && senderId !== '__me__') {
          currentHumanSenderId = senderId;
        }
        continue;
      }

      // Different sender (or first human message) — flush previous batch first
      flushHumanMessages();
      currentHumanSenderId = senderId;
      currentHumanMessages.push(msg);
      continue;
    }

    // ── Any non-user message flushes the human batch ──
    flushHumanMessages();

    // Agent step types: thinking, tool_call, tool_result, tool_approval, plan (ADR-113)
    if (ct === 'thinking' || ct === 'tool_call' || ct === 'tool_result' || ct === 'tool_approval' || ct === 'plan') {
      flushAgentTextMessages(); // steps start a new agent turn
      // If the steps buffer already has messages from a DIFFERENT agent, flush them first
      // so each agent gets its own turn (fixes Ticket #42123 multi-agent grouping bug).
      if (currentAgentMessages.length > 0) {
        const bufFirst = currentAgentMessages[0];
        const bufName = bufFirst.agentName || bufFirst.metadata?.agent_name || bufFirst.sender_name || 'AI';
        const newName = msg.agentName || msg.metadata?.agent_name || msg.sender_name || 'AI';
        if (bufName !== newName) {
          flushAgentSteps();
        }
      }
      currentAgentMessages.push(msg);
      continue;
    }

    // 'text' from assistant after tool steps -> attach to agent_steps group as the final response
    if (msg.role === 'assistant' && ct === 'text' && currentAgentMessages.length > 0) {
      currentAgentMessages.push(msg);
      flushAgentSteps();
      continue;
    }

    // Regular message (old conversations without contentType, or plain assistant text)
    flushAgentSteps();

    // Determine turn type based on role
    const isAgent = msg.role === 'assistant' || msg.role === 'tool' || msg.role === 'system';

    if (isAgent) {
      // Standalone agent text — buffer for merging consecutive agent messages.
      // If the incoming message is from a different agent than what is already
      // buffered, flush the existing buffer first so each agent gets its own turn.
      if (currentAgentTextMessages.length > 0) {
        const bufFirst = currentAgentTextMessages[0];
        const bufName = bufFirst.agentName || bufFirst.metadata?.agent_name || bufFirst.sender_name || 'AI';
        const newName = msg.agentName || msg.metadata?.agent_name || msg.sender_name || 'AI';
        if (bufName !== newName) {
          flushAgentTextMessages();
        }
      }
      currentAgentTextMessages.push(msg);
    } else {
      flushAgentTextMessages();
      const reactions: Turn['reactions'] = {};
      if (msg.id) {
        const msgReactions = messageReactions[Number(msg.id)];
        if (msgReactions) {
          Object.assign(reactions, msgReactions);
        }
      }

      // Determine sender name for standalone human message
      const isMe = currentUserId != null && msg.sender_id != null && Number(msg.sender_id) === Number(currentUserId);
      const standaloneHumanName = msg.sender_name && !isMe ? msg.sender_name : 'You';

      turns.push({
        id: msg.id ? `turn_human_${msg.id}` : `turn_idx_${turnCounter}`,
        turnType: 'human',
        senderName: standaloneHumanName,
        messages: [msg],
        reactions,
        isProcessing: false,
        isFirstInGroup: true,  // computed in post-processing pass
        isLastInGroup: true,   // computed in post-processing pass
      });
      turnCounter++;
    }
  }

  // Flush remaining batches
  flushHumanMessages();
  flushAgentTextMessages();
  flushAgentSteps(isAgentProcessing);

  // Post-process: if the agent is still processing and the last turn is an
  // agent turn with only tool steps (no final text response), mark it as processing.
  // This fixes the race condition where tool_call/tool_result messages arrive
  // in a separate polling cycle before the final text response.
  if (isAgentProcessing && turns.length > 0) {
    const lastTurn = turns[turns.length - 1];
    if (lastTurn.turnType === 'agent') {
      const hasFinalText = lastTurn.messages.some(
        (m) => (m.contentType === 'text' || !m.contentType) && m.role === 'assistant',
      );
      if (!hasFinalText) {
        lastTurn.isProcessing = true;
      }
    }
  }

  // Post-process: compute isFirstInGroup / isLastInGroup for consecutive turns
  // from the same sender type (human/agent). This lets <ChatTurn/> render
  // grouped bubbles with proper rounded corners and header visibility.
  // Agent turns that contain a final 'text' response break the chain — each
  // completed response (tool steps + text answer) becomes its own visual block.
  for (let i = 0; i < turns.length; i++) {
    const prev = i > 0 ? turns[i - 1] : null;
    const next = i < turns.length - 1 ? turns[i + 1] : null;

    // Check if previous agent turn has a final text response (= completed answer).
    // If so, the current turn should start a new visual group.
    const prevHasFinalText =
      prev != null &&
      prev.turnType === 'agent' &&
      prev.messages.some(
        (m) => (m.contentType === 'text' || !m.contentType) && m.role === 'assistant',
      );

    // Check if current agent turn has a final text response.
    // If so, the next turn should start a new visual group.
    const currentHasFinalText =
      turns[i].turnType === 'agent' &&
      turns[i].messages.some(
        (m) => (m.contentType === 'text' || !m.contentType) && m.role === 'assistant',
      );

    const sameSenderAsPrev =
      prev != null &&
      prev.turnType === turns[i].turnType &&
      prev.senderName === turns[i].senderName &&
      !prevHasFinalText; // break chain after completed text response

    const sameSenderAsNext =
      next != null &&
      next.turnType === turns[i].turnType &&
      next.senderName === turns[i].senderName &&
      !currentHasFinalText; // break chain after completed text response

    turns[i].isFirstInGroup = !sameSenderAsPrev;
    turns[i].isLastInGroup = !sameSenderAsNext;
  }

  // Post-process: compute agent chain continuations for concurrent multi-agent display.
  // When the same agent has multiple turns separated by turns from other agents/humans,
  // mark them so the rendering layer can draw visual connectors between segments.
  const agentChainMap = new Map<string, number[]>(); // chainId -> turn indices
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].agentChainId) {
      const indices = agentChainMap.get(turns[i].agentChainId!) || [];
      indices.push(i);
      agentChainMap.set(turns[i].agentChainId!, indices);
    }
  }
  for (const [, indices] of agentChainMap) {
    // Only mark chains that are actually interrupted (more than one segment)
    if (indices.length < 2) continue;
    for (let j = 0; j < indices.length; j++) {
      if (j < indices.length - 1) {
        turns[indices[j]].hasMoreSegments = true;
      }
      if (j > 0) {
        turns[indices[j]].isContinuation = true;
      }
    }
  }

  return turns;
}
