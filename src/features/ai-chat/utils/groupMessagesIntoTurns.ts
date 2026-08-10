import type { ChatMessage } from '../types';

// ---------------------------------------------------------------------------
// Agent invocation detection in thinking blocks
// ---------------------------------------------------------------------------
const INVOCATION_PATTERN = /<<@([a-z0-9_-]+)>>/gi;

/** Check if a thinking message contains agent invocation tokens.
 *  Ignores matches inside backtick-delimited code spans/blocks to avoid
 *  false positives when reasoning merely discusses the <<@slug>> syntax.
 */
function detectInvocations(content: string | undefined | null): string[] {
  if (!content) return [];
  // Strip inline code (`...`) and fenced code blocks (```...```) before matching
  const stripped = content
    .replace(/```[\s\S]*?```/g, '')   // fenced code blocks
    .replace(/`[^`]+`/g, '');          // inline code spans
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  INVOCATION_PATTERN.lastIndex = 0;
  while ((m = INVOCATION_PATTERN.exec(stripped)) !== null) {
    matches.push(m[1].toLowerCase());
  }
  return matches;
}

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
  if (!messages || !Array.isArray(messages)) return [];
  const turns: Turn[] = [];
  let currentHumanMessages: ChatMessage[] = [];
  let currentHumanSenderId: number | string | undefined = undefined;
  let turnCounter = 0;

  // ── Multi-agent buffering ──
  // Instead of a single agent buffer that flushes on agent switch (creating
  // many tiny 1-step turns when agents interleave), we maintain per-agent
  // buffers keyed by chainId. This groups each agent's work into one cohesive
  // turn even when two agents work concurrently and their messages interleave.
  const agentStepBuffers = new Map<string, ChatMessage[]>(); // chainId → step messages
  const agentTextBuffers = new Map<string, ChatMessage[]>(); // chainId → standalone text messages

  // ADR-0031 (broadened): ANY message authored by the service on behalf of a
  // human actor — row_mutation status changes, call summaries, future
  // notifications — should render with the actor's avatar/name but with a
  // microchip badge so the reader knows it was emitted by the system, not
  // typed via the frontend. Trigger: `role === 'system'` AND an identifiable
  // actor (sender_id or metadata.actor.id). Truly anonymous system errors
  // (no actor) fall through to the regular agent path and are NOT marked
  // system-event here.
  const isSystemEventMessage = (m: ChatMessage): boolean => {
    if (m.role !== 'system') return false;
    const meta = m.metadata as { actor?: { id?: number | string } } | undefined;
    return meta?.actor?.id != null || m.sender_id != null;
  };

  // Stable actor identity for grouping: prefer numeric actor.id, then
  // sender_id, finally fall back to actor.name / sender_name. Two consecutive
  // events from the same actor coalesce into one turn (one header).
  const systemEventActorKey = (m: ChatMessage): string => {
    const meta = m.metadata as { actor?: { id?: number | string; name?: string } } | undefined;
    const actor = meta?.actor;
    if (actor?.id != null) return `id_${actor.id}`;
    if (m.sender_id != null) return `id_${m.sender_id}`;
    if (actor?.name) return `name_${actor.name}`;
    if (m.sender_name) return `name_${m.sender_name}`;
    return 'unknown';
  };

  /** Derive chainId from a message (agent name + row id).
   *  ADR-0057-A WP-A — per-agent optimistic placeholders carry only
   *  `metadata.agent_slug` (no resolved row_id / display name yet). Fall back
   *  to the slug so two concurrent placeholders don't both collapse into the
   *  generic `agent_AI` chain. */
  const getChainId = (m: ChatMessage): string => {
    if (isSystemEventMessage(m)) return `system_event_${systemEventActorKey(m)}`;
    const slug = m.metadata?.agent_slug as string | undefined;
    const name = m.agentName || (m as any).agent_name || m.metadata?.agent_name || m.sender_name;
    const rowId = m.metadata?.agent_row_id || m.agentId;
    if (rowId) return `agent_${name || slug || 'AI'}_${rowId}`;
    if (name) return `agent_${name}`;
    if (slug) return `agent_slug_${slug}`;
    return `agent_AI`;
  };

  /** Build a Turn from a list of agent messages. */
  const buildAgentTurn = (msgs: ChatMessage[], processing: boolean): Turn => {
    const firstMsg = msgs[0];
    const reactions: Turn['reactions'] = {};
    for (const m of msgs) {
      if (m.id) {
        const msgReactions = messageReactions[Number(m.id)];
        if (msgReactions) Object.assign(reactions, msgReactions);
      }
    }
    // ADR-0031: row_mutation events are authored by the service on behalf of
    // an actor. Render them as a human-typed turn — actor's name + avatar in
    // the header — and let TurnHeader replace the role badge with a "system"
    // badge to attribute the emit to the service.
    const isSystemEventTurn = msgs.length > 0 && msgs.every(isSystemEventMessage);
    if (isSystemEventTurn) {
      const meta = firstMsg.metadata as { actor?: { id?: number | string; name?: string } } | undefined;
      const actor = meta?.actor;
      const actorName =
        actor?.name ||
        firstMsg.sender_name ||
        'system';
      const turn: Turn = {
        id: firstMsg.id ? `turn_sysev_${firstMsg.id}` : `turn_sysev_idx_${turnCounter}`,
        turnType: 'human',
        senderName: actorName,
        senderAvatar: firstMsg.sender_avatar || undefined,
        messages: [...msgs],
        reactions,
        isProcessing: false,
        isFirstInGroup: true,
        isLastInGroup: true,
        agentChainId: `system_event_${systemEventActorKey(firstMsg)}`,
        isSystemEvent: true,
      };
      turnCounter++;
      return turn;
    }

    // ADR-0057-A WP-A — per-agent placeholders may only carry
    // `metadata.agent_slug` until the real status row arrives. Surface a
    // title-cased slug as the display name so the bubble header reads e.g.
    // "Developer Ralph" instead of "AI".
    const slug = firstMsg.metadata?.agent_slug as string | undefined;
    const slugDisplay = slug
      ? slug.split('-').filter(Boolean).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
      : undefined;
    const agentName =
      firstMsg.agentName ||
      (firstMsg as any).agent_name ||
      firstMsg.metadata?.agent_name ||
      firstMsg.sender_name ||
      slugDisplay ||
      'AI';
    const agentRowId = firstMsg.metadata?.agent_row_id || firstMsg.agentId;
    const chainId = agentRowId
      ? `agent_${agentName}_${agentRowId}`
      : (slug && !firstMsg.sender_name && !firstMsg.agentName && !firstMsg.metadata?.agent_name && !(firstMsg as any).agent_name)
        ? `agent_slug_${slug}`
        : `agent_${agentName}`;

    let turnAgentColor: string | undefined;
    let turnAgentIcon: string | undefined;
    let turnAgentInvocationMode: 'mention' | 'command' | 'both' | null | undefined;
    for (const m of msgs) {
      if (!turnAgentIcon) {
        const icon = m.agent_icon || (m.metadata?.agent_icon as string) || undefined;
        // Guard against NaN or non-string values from DB
        turnAgentIcon = (typeof icon === 'string' && icon !== 'NaN') ? icon : undefined;
      }
      if (!turnAgentColor) turnAgentColor = m.agent_color || (m.metadata?.agent_color as string) || undefined;
      if (turnAgentInvocationMode === undefined) {
        const raw = (m.metadata?.agent_invocation_mode as string) || undefined;
        if (raw === 'mention' || raw === 'command' || raw === 'both') {
          turnAgentInvocationMode = raw;
        }
      }
      if (turnAgentIcon && turnAgentColor && turnAgentInvocationMode !== undefined) break;
    }

    const turn: Turn = {
      id: firstMsg.id ? `turn_agent_${firstMsg.id}` : `turn_agent_idx_${turnCounter}`,
      turnType: 'agent',
      senderName: agentName,
      messages: [...msgs],
      reactions,
      isProcessing: processing,
      isFirstInGroup: true,
      isLastInGroup: true,
      agentChainId: chainId,
      agentColor: turnAgentColor,
      agentIcon: turnAgentIcon,
      agentInvocationMode: turnAgentInvocationMode,
    };
    turnCounter++;
    return turn;
  };

  /** Flush a specific agent's step buffer into a turn. */
  const flushAgentStepBuffer = (chainId: string, processing: boolean = false) => {
    const buf = agentStepBuffers.get(chainId);
    if (!buf || buf.length === 0) return;
    turns.push(buildAgentTurn(buf, processing));
    agentStepBuffers.delete(chainId);
  };

  /** Flush ALL agent step buffers (ordered by Map insertion = first message order). */
  const flushAllAgentStepBuffers = (processing: boolean = false) => {
    Array.from(agentStepBuffers.keys()).forEach(chainId => {
      flushAgentStepBuffer(chainId, processing);
    });
  };

  /** Flush a specific agent's text buffer into a turn. */
  const flushAgentTextBuffer = (chainId: string) => {
    const buf = agentTextBuffers.get(chainId);
    if (!buf || buf.length === 0) return;
    turns.push(buildAgentTurn(buf, false));
    agentTextBuffers.delete(chainId);
  };

  /** Flush ALL agent text buffers. */
  const flushAllAgentTextBuffers = () => {
    Array.from(agentTextBuffers.keys()).forEach(chainId => {
      flushAgentTextBuffer(chainId);
    });
  };

  /** Flush accumulated consecutive human messages into a single turn. */
  const flushHumanMessages = () => {
    if (currentHumanMessages.length === 0) return;

    const reactions: Turn['reactions'] = {};
    for (const m of currentHumanMessages) {
      if (m.id) {
        const msgReactions = messageReactions[Number(m.id)];
        if (msgReactions) {
          for (const [emoji, users] of Object.entries(msgReactions)) {
            const key = `${emoji}_${m.id}`;
            reactions[key] = users;
          }
        }
      }
    }

    const firstMsg = currentHumanMessages[0];
    let humanSenderName = 'You';
    if (firstMsg.senderType === 'agent') {
      humanSenderName = firstMsg.agentName || firstMsg.metadata?.agent_name || 'AI';
    } else if (firstMsg.sender_name) {
      const isMe = currentUserId != null && firstMsg.sender_id != null && Number(firstMsg.sender_id) === Number(currentUserId);
      humanSenderName = isMe ? 'You' : firstMsg.sender_name;
    }

    // Strip _step_groups_after from human messages — those belong to agent turns, not human.
    // We'll create a synthetic agent turn for them below.
    const lastHumanMsg = currentHumanMessages[currentHumanMessages.length - 1];
    const orphanedStepGroupsAfter = (lastHumanMsg as any)?._step_groups_after;
    const orphanedTotalHiddenAfter = (lastHumanMsg as any)?._total_hidden_after;
    // Also check _step_groups_before on the FIRST human message
    const orphanedStepGroupsBefore = (firstMsg as any)?._step_groups_before;
    const orphanedTotalHiddenBefore = (firstMsg as any)?._total_hidden_before;

    // Create clean copies without step group annotations
    const cleanMessages = currentHumanMessages.map(m => {
      const hasAnnotations = (m as any)._step_groups_after || (m as any)._step_groups_before;
      if (!hasAnnotations) return m;
      const clean = { ...m };
      delete (clean as any)._step_groups_after;
      delete (clean as any)._total_hidden_after;
      delete (clean as any)._step_groups_before;
      delete (clean as any)._total_hidden_before;
      return clean;
    });

    // If there are orphaned step groups BEFORE the user message, create a synthetic agent turn first
    if (orphanedStepGroupsBefore && orphanedStepGroupsBefore.length > 0) {
      // Extract agent info from step groups (first group with agent_name wins)
      const agentInfo = orphanedStepGroupsBefore.find((g: Record<string, unknown>) => g.agent_name);
      const syntheticMsg: ChatMessage = {
        id: `synthetic_agent_before_${firstMsg.id || turnCounter}`,
        role: 'assistant',
        content: '',
        contentType: 'agent_status',
        senderType: 'agent',
        timestamp: firstMsg.timestamp,
        metadata: {
          placeholder: true, synthetic: true,
          ...(agentInfo ? { agent_name: agentInfo.agent_name, agent_icon: agentInfo.agent_icon, agent_color: agentInfo.agent_color } : {}),
        },
        _step_groups_before: orphanedStepGroupsBefore,
        _total_hidden_before: orphanedTotalHiddenBefore || 0,
      } as any;
      turns.push(buildAgentTurn([syntheticMsg], false));
    }

    turns.push({
      id: firstMsg.id ? `turn_human_${firstMsg.id}` : `turn_human_idx_${turnCounter}`,
      turnType: 'human',
      senderName: humanSenderName,
      senderAvatar: firstMsg.sender_avatar || undefined,
      messages: [...cleanMessages],
      reactions,
      isProcessing: false,
      isFirstInGroup: true,
      isLastInGroup: true,
    });
    turnCounter++;

    // If there are orphaned step groups AFTER the user message, create a synthetic agent turn
    if (orphanedStepGroupsAfter && orphanedStepGroupsAfter.length > 0) {
      // Extract agent info from step groups (first group with agent_name wins)
      const agentInfoAfter = orphanedStepGroupsAfter.find((g: Record<string, unknown>) => g.agent_name);
      const syntheticMsg: ChatMessage = {
        id: `synthetic_agent_after_${lastHumanMsg.id || turnCounter}`,
        role: 'assistant',
        content: '',
        contentType: 'agent_status',
        senderType: 'agent',
        timestamp: lastHumanMsg.timestamp,
        metadata: {
          placeholder: true, synthetic: true,
          ...(agentInfoAfter ? { agent_name: agentInfoAfter.agent_name, agent_icon: agentInfoAfter.agent_icon, agent_color: agentInfoAfter.agent_color } : {}),
        },
        _step_groups_after: orphanedStepGroupsAfter,
        _total_hidden_after: orphanedTotalHiddenAfter || 0,
      } as any;
      turns.push(buildAgentTurn([syntheticMsg], false));
    }

    currentHumanMessages = [];
    currentHumanSenderId = undefined;
  };

  // ── Pre-process: strip stale step group annotations ──
  // When the cache contains BOTH annotated messages (from initial lazy load)
  // AND actual step messages (from incremental polling), the annotations are stale.
  // Without this, flushHumanMessages creates a synthetic agent turn from _step_groups_after,
  // and then the real step messages create ANOTHER agent turn → duplicate bubble.
  const STEP_TYPES = new Set(['thinking', 'tool_call', 'tool_result', 'tool_approval', 'plan', 'agent_status']);
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    // Strip _step_groups_after when real agent messages follow
    if ((m as any)._step_groups_after) {
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[j].role === 'user') break;
        const nextCt = messages[j].contentType;
        if (STEP_TYPES.has(nextCt || '') ||
            (messages[j].role === 'assistant' && (nextCt === 'text' || !nextCt))) {
          delete (m as any)._step_groups_after;
          delete (m as any)._total_hidden_after;
          break;
        }
      }
    }
    // Strip _step_groups_before when real agent messages precede
    if ((m as any)._step_groups_before && i > 0) {
      for (let j = i - 1; j >= 0; j--) {
        if (messages[j].role === 'user') break;
        const prevCt = messages[j].contentType;
        if (STEP_TYPES.has(prevCt || '')) {
          delete (m as any)._step_groups_before;
          delete (m as any)._total_hidden_before;
          break;
        }
      }
    }
  }

  for (const msg of messages) {
    const ct = msg.contentType;

    // ── User messages: group consecutive from same sender ──
    if (msg.role === 'user') {
      // User message flushes ALL agent buffers — agents are done before user speaks
      flushAllAgentStepBuffers();
      flushAllAgentTextBuffers();

      const senderId = msg.sender_id != null ? Number(msg.sender_id) : '__me__';
      const isSameSender =
        currentHumanMessages.length > 0 &&
        (senderId === currentHumanSenderId ||
          senderId === '__me__' ||
          currentHumanSenderId === '__me__');

      if (isSameSender) {
        const prevMsg = currentHumanMessages[currentHumanMessages.length - 1];
        const prevHasStepsAfter = prevMsg && (prevMsg as any)._step_groups_after;
        const currentHasStepsBefore = (msg as any)._step_groups_before;
        if (prevHasStepsAfter || currentHasStepsBefore) {
          flushHumanMessages();
          currentHumanSenderId = senderId;
          currentHumanMessages.push(msg);
          continue;
        }
        currentHumanMessages.push(msg);
        if (currentHumanSenderId === '__me__' && senderId !== '__me__') {
          currentHumanSenderId = senderId;
        }
        continue;
      }

      flushHumanMessages();
      currentHumanSenderId = senderId;
      currentHumanMessages.push(msg);
      continue;
    }

    // ── Any non-user message flushes the human batch ──
    flushHumanMessages();

    // Agent step types: thinking, tool_call, tool_result, tool_approval, plan, agent_status
    if (ct === 'thinking' || ct === 'tool_call' || ct === 'tool_result' || ct === 'tool_approval' || ct === 'plan' || ct === 'agent_status') {
      // Steps go into the per-agent buffer — no flushing on agent switch!
      let chainId = getChainId(msg);
      // If this message has no agent info (e.g. plan with role=tool_result and no agent_id),
      // inherit the chain from the most recently active agent step buffer to avoid splitting bubbles.
      if (chainId === 'agent_AI' && agentStepBuffers.size > 0) {
        const lastActiveChain = Array.from(agentStepBuffers.keys()).pop();
        if (lastActiveChain) chainId = lastActiveChain;
      }
      flushAllAgentTextBuffers(); // steps start a new agent turn (not text)
      // If this chain's buffer is empty but the LAST turn in `turns` is from the same chain,
      // append to that existing turn instead of starting a new buffer → prevents plan split.
      if (!agentStepBuffers.has(chainId) && turns.length > 0) {
        const lastTurn = turns[turns.length - 1];
        if (lastTurn.turnType === 'agent' && lastTurn.agentChainId === chainId) {
          lastTurn.messages.push(msg);
          continue;
        }
      }
      const buf = agentStepBuffers.get(chainId) || [];
      buf.push(msg);
      agentStepBuffers.set(chainId, buf);

      // WP-5: Detect <<@slug>> invocations in thinking blocks → split the bubble.
      // The thinking with the invocation becomes the "end" of the current turn,
      // and the invoking agent continues in a new turn after the invoked agent's turn.
      if (ct === 'thinking') {
        const invoked = detectInvocations(msg.content);
        if (invoked.length > 0) {
          // Flush current buffer as a completed turn with invocation metadata
          const currentBuf = agentStepBuffers.get(chainId);
          if (currentBuf && currentBuf.length > 0) {
            const turn = buildAgentTurn(currentBuf, false);
            turn.invokedAgents = invoked;
            turn.hasMoreSegments = true; // agent continues after invoked agent
            turns.push(turn);
            agentStepBuffers.delete(chainId);
          }
        }
      }
      continue;
    }

    // 'text' from assistant after tool steps → attach to THAT agent's step buffer and flush it
    if (msg.role === 'assistant' && ct === 'text' && agentStepBuffers.size > 0) {
      const chainId = getChainId(msg);
      const buf = agentStepBuffers.get(chainId);
      if (buf && buf.length > 0) {
        buf.push(msg);
        flushAgentStepBuffer(chainId);
        continue;
      }
    }

    // Regular message (old conversations without contentType, or plain assistant text)
    flushAllAgentStepBuffers();

    const isAgent = msg.role === 'assistant' || msg.role === 'tool' || msg.role === 'system';

    if (isAgent) {
      // Standalone agent text — per-agent buffer
      const chainId = getChainId(msg);
      const buf = agentTextBuffers.get(chainId) || [];
      buf.push(msg);
      agentTextBuffers.set(chainId, buf);
    } else {
      flushAllAgentTextBuffers();
      const reactions: Turn['reactions'] = {};
      if (msg.id) {
        const msgReactions = messageReactions[Number(msg.id)];
        if (msgReactions) {
          Object.assign(reactions, msgReactions);
        }
      }

      const isMe = currentUserId != null && msg.sender_id != null && Number(msg.sender_id) === Number(currentUserId);
      const standaloneHumanName = msg.sender_name && !isMe ? msg.sender_name : 'You';

      turns.push({
        id: msg.id ? `turn_human_${msg.id}` : `turn_idx_${turnCounter}`,
        turnType: 'human',
        senderName: standaloneHumanName,
        messages: [msg],
        reactions,
        isProcessing: false,
        isFirstInGroup: true,
        isLastInGroup: true,
      });
      turnCounter++;
    }
  }

  // Flush remaining batches
  flushHumanMessages();
  flushAllAgentTextBuffers();
  // Last agent step buffers: if agent is processing, mark the LAST buffer as processing
  if (isAgentProcessing && agentStepBuffers.size > 0) {
    const chainIds = Array.from(agentStepBuffers.keys());
    for (let i = 0; i < chainIds.length; i++) {
      // Mark all active agent buffers as processing (multiple agents can work concurrently)
      const buf = agentStepBuffers.get(chainIds[i]);
      if (buf && buf.length > 0) {
        const hasFinalText = buf.some(m => (m.contentType === 'text' || !m.contentType) && m.role === 'assistant');
        turns.push(buildAgentTurn(buf, !hasFinalText));
      }
      agentStepBuffers.delete(chainIds[i]);
    }
  } else {
    flushAllAgentStepBuffers();
  }

  // Post-process: mark agent turns as processing when appropriate.
  // 1. Any turn containing an agent-pending-* message is ALWAYS processing
  //    (optimistic bubble from onMutate — isAgentProcessing state may lag behind).
  // 2. Any turn with an active agent_status placeholder is processing
  //    (with staleness check: 10+ min with 0 tools = dead).
  // 3. If isAgentProcessing is true, the last agent turn without final text is processing.
  for (const turn of turns) {
    if (turn.turnType !== 'agent') continue;
    const hasPending = turn.messages.some(m => String(m.id).startsWith('agent-pending-'));
    const hasActivePlaceholder = turn.messages.some(m => {
      if (m.contentType !== 'agent_status' || !m.metadata) return false;
      const meta = m.metadata as Record<string, unknown>;
      if (meta.placeholder !== true) return false;
      // Synthetic placeholders are lazy-loaded step group summaries — never processing
      if (meta.synthetic === true) return false;
      if (meta.agent_status === 'finished' || meta.agent_status === 'error') return false;
      // BUG FIX #2: If backend confirms isAgentProcessing=true, trust it regardless of age.
      // Agents (like Orchestrator) can run for hours. The 10-min staleness limit was silently
      // killing their processing bubble. Only apply the limit when we DON'T have backend confirmation.
      if (isAgentProcessing) return true;
      // Staleness check: if started 10+ min ago with no tools AND backend doesn't confirm processing,
      // the job likely crashed — don't show stale bubble.
      const startedAt = meta.started_at as string | undefined;
      if (startedAt && (meta.tools_used as number || 0) === 0) {
        const age = Date.now() - new Date(startedAt).getTime();
        if (age > 10 * 60 * 1000) return false;
      }
      return true;
    });
    if (hasPending || hasActivePlaceholder) {
      turn.isProcessing = true;
    }
  }
  if (isAgentProcessing && turns.length > 0) {
    // Mark ALL agent turns without final text as processing — multiple agents can work concurrently.
    // Walk backwards and stop at the first human turn (agents after last user message are the active ones).
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].turnType === 'human') break; // stop at last user message boundary
      if (turns[i].turnType !== 'agent') continue;
      const hasFinalText = turns[i].messages.some(
        (m) => (m.contentType === 'text' || !m.contentType) && m.role === 'assistant',
      );
      if (!hasFinalText) {
        turns[i].isProcessing = true;
      }
    }
  }

  // Populate lastMessageAt for agent turns (used for stale detection on processing bubbles)
  for (const turn of turns) {
    if (turn.turnType !== 'agent' || turn.messages.length === 0) continue;
    const lastMsg = turn.messages[turn.messages.length - 1];
    if (lastMsg.createdAt) {
      turn.lastMessageAt = typeof lastMsg.createdAt === 'string'
        ? lastMsg.createdAt
        : new Date(lastMsg.createdAt).toISOString();
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
  agentChainMap.forEach((indices) => {
    // Only mark chains that are actually interrupted (more than one segment)
    if (indices.length < 2) return;
    for (let j = 0; j < indices.length; j++) {
      if (j < indices.length - 1) {
        turns[indices[j]].hasMoreSegments = true;
      }
      if (j > 0) {
        turns[indices[j]].isContinuation = true;
      }
    }
  });

  // Post-process: mark all turns of an agent as "active in chat" if ANY turn of that agent is processing
  const activeAgentNames = new Set<string>();
  for (const turn of turns) {
    if (turn.turnType === 'agent' && turn.isProcessing) {
      activeAgentNames.add(turn.senderName);
    }
  }
  if (activeAgentNames.size > 0) {
    for (const turn of turns) {
      if (turn.turnType === 'agent' && activeAgentNames.has(turn.senderName)) {
        turn.isAgentActiveInChat = true;
      }
    }
  }

  return turns;
}
