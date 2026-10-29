import type { ChatMessage } from '../types';
import type { Turn } from './turn.types';
export type { Turn } from './turn.types';
import { liftForeignStepGroups, type AnnotatedMessage, type ResolveAgentIdentity } from './stepGroupMessages';
export { liftForeignStepGroups, isMessageInStepGroup, type ResolveAgentIdentity } from './stepGroupMessages';

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

/** agent_status row whose run is over (backend flips placeholder=false on
 *  finished/error) and that carries no text. Synthetic step-group carriers
 *  always have placeholder=true, so they never match. */
const isSettledEmptyStatus = (m: ChatMessage): boolean =>
  m.contentType === 'agent_status' &&
  (m.metadata as Record<string, unknown> | undefined)?.placeholder === false &&
  !(m.content || '').trim();

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
  activeAgents: readonly { agent_name: string; started_at: string | null; inflight_status?: string }[] = [],
  resolveAgent?: ResolveAgentIdentity,
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
  // actor (sender_id or metadata.actor.id), or an explicit system sender.
  // Legacy watchdog notices used role assistant with senderType system.
  // Truly anonymous system errors
  // (no actor) fall through to the regular agent path and are NOT marked
  // system-event here.
  const isSystemEventMessage = (m: ChatMessage): boolean => {
    if (m.senderType === 'system') return true;
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
    const rowId = m.metadata?.agent_row_id || m.agentId || (m as ChatMessage & { agent_id?: number }).agent_id;
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
    const agentRowId = firstMsg.metadata?.agent_row_id || firstMsg.agentId || (firstMsg as ChatMessage & { agent_id?: number }).agent_id;
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

    // Step groups that were attached to human messages have already been lifted
    // into synthetic agent messages by liftForeignStepGroups — nothing to strip.
    turns.push({
      id: firstMsg.id ? `turn_human_${firstMsg.id}` : `turn_human_idx_${turnCounter}`,
      turnType: 'human',
      senderName: humanSenderName,
      senderAvatar: firstMsg.sender_avatar || undefined,
      messages: [...currentHumanMessages],
      reactions,
      isProcessing: false,
      isFirstInGroup: true,
      isLastInGroup: true,
    });
    turnCounter++;

    currentHumanMessages = [];
    currentHumanSenderId = undefined;
  };

  // ── Pre-process: drop stale annotations, give every agent its own carrier ──
  // A synthetic agent message between two human messages also keeps them from
  // merging into one human turn (it flushes the batch like any agent message).
  for (const msg of liftForeignStepGroups(messages, resolveAgent)) {
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
      // EXCEPTION: a turn already sealed by a final assistant `text` response is a
      // completed answer — new steps from the same agent must NOT be appended to it
      // (that would "drag" the sealed bubble on while the agent keeps working). Start
      // a fresh buffer → a new bubble opens after the final text.
      if (!agentStepBuffers.has(chainId) && turns.length > 0) {
        const lastTurn = turns[turns.length - 1];
        const lastTurnSealed = lastTurn.messages.some(
          (m) => (m.contentType === 'text' || !m.contentType) && m.role === 'assistant',
        );
        if (lastTurn.turnType === 'agent' && lastTurn.agentChainId === chainId && !lastTurnSealed) {
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

    // A handoff status can arrive before the invoking agent's final answer.
    // Keep status-only placeholders buffered so the first real step fills that
    // bubble after the answer. Status text (e.g. Processing...) is not a step.
    for (const [chainId, buffer] of agentStepBuffers) {
      const onlyPlaceholders = buffer.every(message => {
        const annotated = message as AnnotatedMessage;
        return message.contentType === 'agent_status'
          && message.metadata?.placeholder === true
          && message.metadata?.synthetic !== true
          && !annotated._step_groups_before?.length
          && !annotated._step_groups_after?.length;
      });
      if (msg.role !== 'assistant' || !onlyPlaceholders) flushAgentStepBuffer(chainId);
    }

    // An invocation flushes thinking early. Its final answer still belongs to
    // that bubble unless another participant has actually spoken in between.
    const lastTurn = turns[turns.length - 1];
    if (msg.role === 'assistant' && ct === 'text' && agentTextBuffers.size === 0
      && lastTurn?.invokedAgents?.length && lastTurn.agentChainId === getChainId(msg)
      && !lastTurn.messages.some(m => (m.contentType === 'text' || !m.contentType) && m.role === 'assistant')) {
      Object.assign(lastTurn, buildAgentTurn([...lastTurn.messages, msg], false));
      lastTurn.hasMoreSegments = false;
      continue;
    }

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

  // Drop turns that are nothing but a settled status row: a finished/error
  // placeholder has no steps and no text (TurnBody ignores it once
  // placeholder=false), so all that would render is an empty header. Real
  // runs keep their status row because it sits next to their steps.
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].turnType === 'agent' && turns[i].messages.every(isSettledEmptyStatus)) turns.splice(i, 1);
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

  // A running placeholder may remain in an earlier, sealed bubble. Carry
  // activity to the latest segment of that agent, never back to old segments.
  const latestAgentTurns = new Map<string, Turn>();
  const processingChains = new Set<string>();
  const latestAgentPlans = new Map<string, ChatMessage>();
  for (const turn of turns) {
    if (turn.turnType !== 'agent' || !turn.agentChainId) continue;
    latestAgentTurns.set(turn.agentChainId, turn);
    turn.planMessage = null;
    for (const message of turn.messages) {
      if (message.contentType === 'plan') latestAgentPlans.set(turn.agentChainId, message);
    }
    if (turn.isProcessing) processingChains.add(turn.agentChainId);
    turn.isProcessing = false;
  }
  for (const [chainId, turn] of latestAgentTurns) {
    turn.planMessage = latestAgentPlans.get(chainId) ?? null;
    const hasFinalText = turn.messages.some(
      (m) => (m.contentType === 'text' || !m.contentType) && m.role === 'assistant',
    );
    // A text answer seals a bubble, not necessarily its job. The conversation
    // flag/status placeholder can settle before later tool work finishes.
    const confirmedActive = activeAgents.some(agent => {
      if (agent.agent_name !== turn.senderName) return false;
      if (agent.inflight_status && agent.inflight_status !== 'running') return false;
      if (!agent.started_at) return false;
      const startedAt = new Date(agent.started_at).getTime();
      return turn.messages.some(message => {
        const createdAt = 'createdAt' in message ? message.createdAt : undefined;
        const timestamp = (typeof createdAt === 'string' || createdAt instanceof Date)
          ? createdAt : message.timestamp;
        return timestamp != null && new Date(timestamp).getTime() >= startedAt;
      });
    });
    turn.isProcessing = (processingChains.has(chainId) || confirmedActive) && !hasFinalText;
  }

  // Populate lastMessageAt for agent turns (used for stale detection on processing bubbles)
  for (const turn of turns) {
    if (turn.turnType !== 'agent' || turn.messages.length === 0) continue;
    const lastMsg = turn.messages[turn.messages.length - 1];
    const createdAt = 'createdAt' in lastMsg ? lastMsg.createdAt : undefined;
    if (typeof createdAt === 'string') {
      turn.lastMessageAt = createdAt;
    } else if (createdAt instanceof Date) {
      turn.lastMessageAt = createdAt.toISOString();
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
