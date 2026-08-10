/**
 * useInflightAgents (ADR-0057-A WP-C — B.5)
 * =========================================
 *
 * Per-conversation merged presence view fed by TWO sources of truth:
 *
 *   1. `conversation.active_agents[]` SNAPSHOT polled by useConversationMessages.
 *      Carries the UNION (`_inflight_runs` ∪ `agent_jobs`) computed by
 *      `queryActiveInflight` (backend WP-B). The snapshot wins on first paint
 *      and whenever a slug has no SSE delta yet (initial seed contract).
 *
 *   2. `event: inflight` SSE DELTA emitted by writers via
 *      `pg_notify('chat_inflight', …)` (markPaused.js, FSM writers post-0042).
 *      Carries the live status flips (running → paused, paused → running,
 *      → done, → failed) plus pause taxonomy (`reason`, `resume_at`).
 *
 * Merge contract:
 *   * SSE deltas WIN over snapshot for the SAME slug — they are strictly
 *     newer than the last poll. Snapshot is allowed to ADD slugs the SSE
 *     stream missed (writer crash, late subscriber) but never to clobber a
 *     slug that has received an SSE update since the SSE connection opened.
 *   * Terminal SSE statuses (`done`, `failed` w/o expected retry) REMOVE the
 *     slug from the active set after a short grace window — until the next
 *     snapshot confirms the removal. For `failed` we keep the row visible so
 *     the UI can render its retry affordance.
 *   * On SSE disconnect or initial mount the hook reports `isStale=true` —
 *     consumers may still render but should not mark the presence as live.
 *
 * The hook is conversation-scoped: change `conversationId` and the internal
 * map resets. Consumers register the returned `handleInflightEvent` as the
 * `onInflight` callback of `useConversationSSE` for the same conversation.
 *
 * Feature flag:
 *   When `FEATURE_MULTI_AGENT_PRESENCE_V2` is `false` (or unset) the hook is a
 *   pass-through over `seedAgents` — no internal state, no SSE handler is
 *   registered by the caller. This preserves the WP-A snapshot-only path
 *   (no-regression contract per the WP-C ticket acceptance criteria).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActiveAgent } from './useConversationMessages';
import type { SSEInflightEvent } from './useConversationSSE';

/**
 * Vite-time feature flag. Single source of truth — imported by both the hook
 * and the presence bar so they stay in sync. Reads `'true'` / unset → boolean.
 * Anything other than the literal `'true'` evaluates to `false` (defensive).
 */
export const FEATURE_MULTI_AGENT_PRESENCE_V2: boolean = (() => {
  try {
    return (import.meta as { env?: Record<string, string | undefined> }).env
      ?.VITE_FEATURE_MULTI_AGENT_PRESENCE_V2 === 'true';
  } catch {
    return false;
  }
})();

/** Statuses we surface to the UI. `done` is dropped from the active set. */
type InflightStatus = 'running' | 'paused' | 'failed';

/** What the hook returns per agent — superset of ActiveAgent. */
export interface InflightAgentView extends ActiveAgent {
  /**
   * Normalized status — paused-only fields (`reason`, `resume_at`, `paused_at`)
   * are populated when this is `'paused'`. Failed retains the last known
   * `reason` (often the failure cause) for diagnostic display.
   */
  inflight_status: InflightStatus;
  /** Pause taxonomy code (e.g. 'paused-rate-limit') — null unless paused/failed. */
  reason: string | null;
  /** ISO when watchdog/writer expects to resume. Null = no schedule. */
  resume_at: string | null;
  /** ISO when status flipped to paused. Null for non-paused. */
  paused_at: string | null;
  /** 'inflight' when last update came from `_inflight_runs`, 'jobs' otherwise. */
  source: 'inflight' | 'jobs' | string;
}

/** Internal cache entry — tracks last-update lineage for merge semantics. */
interface AgentEntry extends InflightAgentView {
  /** When the entry was last touched (Date.now()). */
  _updatedAt: number;
  /** 'sse' once a delta has landed; 'seed' until then. */
  _lineage: 'sse' | 'seed';
}

export interface UseInflightAgentsOptions {
  /** Conversation we're tracking. Switching this clears the internal map. */
  conversationId: number | null;
  /** Snapshot from useConversationMessages (`active_agents` field). */
  seedAgents: ActiveAgent[] | undefined;
  /** Whether the SSE stream is currently connected. Drives `isStale`. */
  sseConnected?: boolean;
  /** Feature flag override — defaults to the build-time constant. Test seam. */
  enabled?: boolean;
}

export interface UseInflightAgentsReturn {
  /** Merged active agents — ordered by `started_at` ascending. */
  agents: InflightAgentView[];
  /** True when SSE is not connected (consumer can dim the UI / show snapshot-only). */
  isStale: boolean;
  /** Wire this to `useConversationSSE({ onInflight })`. No-op when flag is off. */
  handleInflightEvent: (payload: SSEInflightEvent) => void;
}

/** Coerce arbitrary SSE-event `status` strings to our 3-value enum. */
function normalizeStatus(raw: string | null | undefined): InflightStatus | 'done' {
  if (raw === 'paused') return 'paused';
  if (raw === 'failed') return 'failed';
  if (raw === 'done' || raw === 'finished') return 'done';
  return 'running';
}

/** Build an entry from a snapshot row. */
function entryFromSeed(seed: ActiveAgent, now: number): AgentEntry {
  const status = normalizeStatus((seed as ActiveAgent & { status?: string }).status);
  // 'done' is never in the seed (queryActive filters it out), but guard anyway.
  const inflightStatus: InflightStatus = status === 'done' ? 'running' : status;
  return {
    ...seed,
    inflight_status: inflightStatus,
    reason: (seed as ActiveAgent & { reason?: string | null }).reason ?? null,
    resume_at: (seed as ActiveAgent & { resume_at?: string | null }).resume_at ?? null,
    paused_at: (seed as ActiveAgent & { paused_at?: string | null }).paused_at ?? null,
    source: ((seed as ActiveAgent & { source?: string }).source ?? 'jobs') as AgentEntry['source'],
    _updatedAt: now,
    _lineage: 'seed',
  };
}

/** Derive the cache key for a snapshot row — slug first, fallback to id. */
function seedKey(seed: ActiveAgent): string | null {
  const slug = (seed as ActiveAgent & { agent_slug?: string | null }).agent_slug;
  if (slug) return slug;
  // Legacy agent_jobs row without a slug — key by job_id or db id so we still
  // dedupe correctly across polls.
  if (seed.job_id) return `__job:${seed.job_id}`;
  if (seed.job_db_id != null) return `__job:${seed.job_db_id}`;
  if (seed.agent_user_id != null) return `__user:${seed.agent_user_id}`;
  return null;
}

export function useInflightAgents({
  conversationId,
  seedAgents,
  sseConnected = false,
  enabled = FEATURE_MULTI_AGENT_PRESENCE_V2,
}: UseInflightAgentsOptions): UseInflightAgentsReturn {
  // Internal merged map. Kept in a ref so SSE callback writes don't tear with
  // React's commit phase — we project to a `version` counter for re-renders.
  const mapRef = useRef<Map<string, AgentEntry>>(new Map());
  const [version, setVersion] = useState(0);
  const bumpVersion = useCallback(() => setVersion((v) => (v + 1) & 0xffff), []);

  const prevConvIdRef = useRef<number | null>(null);

  // Conversation switch → drop the map. We do this in a ref-tracking effect so
  // it runs once per change, before the seed-merge below has a chance to write.
  useEffect(() => {
    if (prevConvIdRef.current !== conversationId) {
      mapRef.current = new Map();
      prevConvIdRef.current = conversationId;
      bumpVersion();
    }
  }, [conversationId, bumpVersion]);

  // Merge snapshot into the cache:
  //  * For each seed row, if no SSE update has touched the slug → write.
  //  * If an SSE update IS present for the slug → leave it alone (SSE wins).
  //  * For slugs absent from the seed, prune ONLY those whose lineage is 'seed'.
  //    SSE-owned entries persist until a terminal delta or conversation switch.
  useEffect(() => {
    if (!enabled) return;
    if (conversationId == null) return;
    const now = Date.now();
    const map = mapRef.current;
    const seenKeys = new Set<string>();
    let changed = false;

    for (const seed of seedAgents ?? []) {
      const key = seedKey(seed);
      if (!key) continue;
      seenKeys.add(key);
      const existing = map.get(key);
      if (existing && existing._lineage === 'sse') continue;
      map.set(key, entryFromSeed(seed, now));
      changed = true;
    }

    for (const [key, entry] of map.entries()) {
      if (entry._lineage === 'seed' && !seenKeys.has(key)) {
        map.delete(key);
        changed = true;
      }
    }

    if (changed) bumpVersion();
  }, [enabled, conversationId, seedAgents, bumpVersion]);

  // SSE delta handler. Stable callback — consumer can pass directly to
  // useConversationSSE without churning the effect dependency array.
  const handleInflightEvent = useCallback((payload: SSEInflightEvent) => {
    if (!enabled) return;
    if (conversationId == null) return;
    if (Number(payload.conversation_id) !== conversationId) return;
    const slug = payload.agent_slug;
    if (!slug) return;

    const status = normalizeStatus(payload.status);
    const now = Date.now();
    const map = mapRef.current;

    if (status === 'done') {
      // Terminal: drop from active set. Snapshot will not re-add (queryActive
      // filters terminal statuses) so this is safe — and immediate so the UI
      // doesn't keep the row spinning for an extra poll tick.
      if (map.delete(slug)) bumpVersion();
      return;
    }

    const existing = map.get(slug);
    const next: AgentEntry & { agent_slug?: string } = {
      job_db_id: existing?.job_db_id ?? null,
      job_id: existing?.job_id ?? null,
      agent_row_id: existing?.agent_row_id ?? null,
      agent_user_id: existing?.agent_user_id ?? null,
      agent_name: existing?.agent_name ?? slug,
      // last_status_message_id stays sticky from snapshot — SSE doesn't carry it
      last_status_message_id: existing?.last_status_message_id ?? null,
      invocation_type: existing?.invocation_type ?? null,
      status: payload.status,
      started_at: payload.started_at ?? existing?.started_at ?? null,
      inflight_status: status,
      reason: payload.reason ?? null,
      resume_at: payload.resume_at ?? null,
      paused_at: payload.paused_at ?? (status === 'paused' ? new Date(now).toISOString() : null),
      source: 'inflight',
      _updatedAt: now,
      _lineage: 'sse',
      // Stamp slug at runtime — backend snapshot carries it but ActiveAgent
      // interface omits it. Cast widens the type just enough.
      agent_slug: slug,
    };
    map.set(slug, next);
    bumpVersion();
  }, [enabled, conversationId, bumpVersion]);

  // Project the map → ordered array, sorted by `started_at` ascending so the
  // UI mirrors the backend's UNION ordering and stays stable across deltas.
  const agents = useMemo<InflightAgentView[]>(() => {
    if (!enabled) {
      // Pass-through over the snapshot. Cast through Partial so the seed
      // surface can carry status/reason/resume_at/paused_at when present.
      return (seedAgents ?? []).map((seed) => {
        const raw = seed as ActiveAgent & Partial<InflightAgentView>;
        const status = normalizeStatus(raw.status);
        return {
          ...seed,
          inflight_status: status === 'done' ? 'running' : status,
          reason: raw.reason ?? null,
          resume_at: raw.resume_at ?? null,
          paused_at: raw.paused_at ?? null,
          source: (raw.source ?? 'jobs') as InflightAgentView['source'],
        };
      });
    }
    const list = Array.from(mapRef.current.values());
    list.sort((a, b) => {
      const at = a.started_at ? new Date(a.started_at).getTime() : Number.POSITIVE_INFINITY;
      const bt = b.started_at ? new Date(b.started_at).getTime() : Number.POSITIVE_INFINITY;
      return at - bt;
    });
    // Strip internal lineage fields from the public projection.
    return list.map(({ _updatedAt: _u, _lineage: _l, ...rest }) => rest);
    // `version` is the re-render trigger — bumpVersion() increments it so the
    // memo re-runs after each map mutation. Without it the projection would
    // stay frozen across SSE deltas.
  }, [enabled, seedAgents, version]);

  const isStale = !sseConnected;

  return { agents, isStale, handleInflightEvent };
}
