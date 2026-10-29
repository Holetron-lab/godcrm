import type { ChatMessage } from '../types';

// ---------------------------------------------------------------------------
// Lazy-loaded step groups — `_step_groups_before/after` annotations produced by
// backend routes/v3/chat/stepGroups.js. Since WP-2 (Bugs 1552/228710) a group
// closes when the agent changes and carries agent_id/agent_name, so a single
// annotation may hold runs from several agents. Before grouping we lift every
// run that does not belong to the annotated message into its own synthetic
// `agent_status` message, so each agent gets its own bubble instead of being
// folded into whichever agent happened to own the visible message.
// ---------------------------------------------------------------------------

interface StepGroupAnnotation {
  type: 'thinking' | 'tools';
  count: number;
  first_id: number;
  last_id: number;
  preview?: string;
  agent_id?: number | null;
  agent_name?: string | null;
  agent_icon?: string | null;
  agent_color?: string | null;
}

export type AnnotatedMessage = ChatMessage & {
  _step_groups_before?: StepGroupAnnotation[];
  _total_hidden_before?: number;
  _step_groups_after?: StepGroupAnnotation[];
  _total_hidden_after?: number;
};

const groupRunKey = (g: StepGroupAnnotation): string =>
  g.agent_id != null ? `id_${g.agent_id}` : g.agent_name ? `name_${g.agent_name.toLowerCase()}` : '';

/** Split groups into consecutive runs by agent (the backend already closes a
 *  group on agent change, so this only re-joins same-agent neighbours). */
function splitIntoAgentRuns(groups: StepGroupAnnotation[]): StepGroupAnnotation[][] {
  const runs: StepGroupAnnotation[][] = [];
  for (const g of groups) {
    const last = runs[runs.length - 1];
    if (last && groupRunKey(last[0]) === groupRunKey(g)) last.push(g);
    else runs.push([g]);
  }
  return runs;
}

/** A run stays on the annotated message only when that message was authored by
 *  the same agent. Human messages own nothing; a run with no agent info (legacy
 *  backend) or a message with no agent identity can't be told apart → keep. */
function runBelongsToMessage(run: StepGroupAnnotation[], m: ChatMessage): boolean {
  if (m.role === 'user') return false;
  const g = run[0];
  const msgRowId = m.metadata?.agent_row_id || m.agentId;
  if (g.agent_id != null && msgRowId != null) return Number(g.agent_id) === Number(msgRowId);
  const msgName = m.agentName || (m as any).agent_name || m.metadata?.agent_name || m.sender_name;
  if (g.agent_name && msgName) return g.agent_name.toLowerCase() === String(msgName).toLowerCase();
  return true;
}

const sumCounts = (groups: StepGroupAnnotation[]): number => groups.reduce((s, g) => s + g.count, 0);

/** Directory lookup by agent row id — fills colour/icon the lazy groups lack. */
export type ResolveAgentIdentity = (agentRowId: number) => { color?: string; icon?: string } | null;

/** Placeholder message that carries one agent's run so it renders as that agent's bubble. */
function syntheticRunMessage(
  anchor: ChatMessage,
  side: 'before' | 'after',
  runIdx: number,
  run: StepGroupAnnotation[],
  resolveAgent?: ResolveAgentIdentity,
): AnnotatedMessage {
  const g = run.find(x => x.agent_name || x.agent_id != null) || run[0];
  // Lazy groups carry the raw metadata colour, which is null for agents whose
  // writer never stamps one. A run with no final text row (interrupted agent)
  // renders from this carrier alone, so resolve the identity here — the real
  // messages get the same treatment upstream in MessagesArea.
  const resolved = g.agent_id != null ? resolveAgent?.(g.agent_id) : null;
  const agentIcon = g.agent_icon || resolved?.icon;
  const agentColor = g.agent_color || resolved?.color;
  return {
    id: `synthetic_agent_${side}_${anchor.id}_${runIdx}`,
    role: 'assistant',
    content: '',
    contentType: 'agent_status',
    senderType: 'agent',
    timestamp: anchor.timestamp,
    metadata: {
      placeholder: true,
      synthetic: true,
      ...(g.agent_name ? { agent_name: g.agent_name } : {}),
      ...(agentIcon ? { agent_icon: agentIcon } : {}),
      ...(agentColor ? { agent_color: agentColor } : {}),
      ...(g.agent_id != null ? { agent_row_id: g.agent_id } : {}),
    },
    [`_step_groups_${side}`]: run,
    [`_total_hidden_${side}`]: sumCounts(run),
  } as AnnotatedMessage;
}

/** Only the actual hidden step range can replace its lazy summary. */
export function isMessageInStepGroup(message: ChatMessage, group: StepGroupAnnotation): boolean {
  const id = Number(message.id);
  const matchesType = group.type === 'thinking'
    ? message.contentType === 'thinking'
    : message.contentType === 'tool_call' || message.contentType === 'tool_result';
  return matchesType && id >= group.first_id && id <= group.last_id
    && runBelongsToMessage([group], message);
}

/**
 * Returns a message list where every lazy step-group annotation sits on a
 * message of the agent that produced it: runs of other agents become synthetic
 * `agent_status` messages placed before/after the anchor, stale annotations are
 * dropped, and annotated inputs are copied rather than mutated.
 */
export function liftForeignStepGroups(messages: ChatMessage[], resolveAgent?: ResolveAgentIdentity): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i] as AnnotatedMessage;
    if (!m._step_groups_before && !m._step_groups_after) {
      out.push(m);
      continue;
    }
    const stillHidden = (group: StepGroupAnnotation): boolean =>
      new Set(messages.filter(message => isMessageInStepGroup(message, group)).map(message => message.id)).size < group.count;
    const before = (m._step_groups_before ?? []).filter(stillHidden);
    const after = (m._step_groups_after ?? []).filter(stillHidden);

    const keepBefore: StepGroupAnnotation[] = [];
    const keepAfter: StepGroupAnnotation[] = [];
    const lifted: AnnotatedMessage[] = [];
    splitIntoAgentRuns(before).forEach((run, k) => {
      if (runBelongsToMessage(run, m)) keepBefore.push(...run);
      else out.push(syntheticRunMessage(m, 'before', k, run, resolveAgent));
    });
    splitIntoAgentRuns(after).forEach((run, k) => {
      if (runBelongsToMessage(run, m)) keepAfter.push(...run);
      else lifted.push(syntheticRunMessage(m, 'after', k, run, resolveAgent));
    });

    const copy: AnnotatedMessage = { ...m };
    delete copy._step_groups_before;
    delete copy._total_hidden_before;
    delete copy._step_groups_after;
    delete copy._total_hidden_after;
    if (keepBefore.length > 0) {
      copy._step_groups_before = keepBefore;
      copy._total_hidden_before = sumCounts(keepBefore);
    }
    if (keepAfter.length > 0) {
      copy._step_groups_after = keepAfter;
      copy._total_hidden_after = sumCounts(keepAfter);
    }
    out.push(copy, ...lifted);
  }
  return out;
}
