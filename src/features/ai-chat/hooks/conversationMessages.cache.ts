import type { ChatMessage } from '../types';
import { slugifyAgentName } from '../utils/parseInvocations';

// Extract a slug for placeholder reconciliation from any agent-bearing message.
export function statusMessageSlug(msg: ChatMessage): string | null {
  const senderName = msg.sender_name
    || (msg.metadata as Record<string, unknown> | undefined)?.agent_name as string | undefined;
  return slugifyAgentName(senderName);
}

// Match a single pending placeholder against a status-row slug. We keep
// legacy placeholders (no `metadata.agent_slug`) — those are auto-respond
// fallbacks where the slug isn't known at send time and the old "strip on
// any agent message" rule still applies.
export function placeholderSlug(msg: ChatMessage): string | null {
  const slug = (msg.metadata as Record<string, unknown> | undefined)?.agent_slug as string | undefined;
  return slug || null;
}

// Cheap structural compare for an agent_status / plan message in cache vs.
// the freshly-polled version. Returns true when nothing the renderer can see
// has changed — used to skip cache writes that would otherwise produce new
// page/messages refs every poll tick and trigger a full ChatTurn re-render
// (visible as bottom-of-chat flicker during agent processing).
export function isSameStatusRow(a: ChatMessage | undefined, b: ChatMessage | undefined): boolean {
  if (!a || !b) return false;
  if (String(a.id) !== String(b.id)) return false;
  if ((a.content || '') !== (b.content || '')) return false;
  return JSON.stringify(a.metadata ?? null) === JSON.stringify(b.metadata ?? null);
}

// A status row whose run is over. The status poll may only UPDATE such a row
// when it is already in the cache (so a running bubble can settle); it must
// never APPEND one — the backend returns the last N status rows by id with no
// regard to state, so another agent's finished row from an earlier run would
// otherwise land at the bottom of the feed as an empty bubble on every tick.
export function isTerminalStatusRow(msg: ChatMessage): boolean {
  const status = (msg.metadata as Record<string, unknown> | undefined)?.agent_status;
  return status === 'finished' || status === 'error';
}

export function findCachedById(data: { pages?: Array<{ messages: ChatMessage[] }> } | undefined, id: string): ChatMessage | undefined {
  if (!data?.pages) return undefined;
  for (const page of data.pages) {
    const match = page.messages.find(m => String(m.id) === id);
    if (match) return match;
  }
  return undefined;
}

// Status/plan polling refreshes a row, not a window of conversation history.
// Lazy annotations from these filtered responses can refer to another job.
export function withoutStepAnnotations(msg: ChatMessage): ChatMessage {
  const copy: ChatMessage & Record<string, unknown> = { ...msg };
  for (const key of Object.keys(copy)) {
    if (/^_(step_groups_|total_hidden_|thinking_steps_|tool_steps_|hidden_)/.test(key)) delete copy[key];
  }
  return copy;
}
