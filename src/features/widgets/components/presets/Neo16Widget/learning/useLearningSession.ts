/**
 * Neo16 W2-S5 — the client half of the receipt/lease loop.
 *
 * Rules this hook enforces (README §W2-S3/§W2-S4, doc 239900 §Runtime Contract):
 *  - every send carries a fresh client `request_id`; a 502 EVALUATION_FAILED is
 *    retried with the SAME id (the server replays the saved receipt, never a 2nd turn);
 *  - `expected_version` is the session version we last read; a 409 stale /
 *    VERSION_CONFLICT / SESSION_CLOSED re-reads state and does NOT resend;
 *  - a 202 `processing` turn is followed by polling GET state until the turn is
 *    applied, failed (→ same-id retry) or cancelled;
 *  - everything rendered (NPC reply, feedback, goals, XP) is a server value;
 *  - binding/policy 409s are shown as configuration errors, no silent fallback.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CONFIG_ERROR_CODES,
  Neo16ApiError,
  STALE_ERROR_CODES,
  type AppliedSay,
  type CommandResult,
  type Neo16Transport,
  type PublicTurn,
  type SessionState,
} from './types';

export const DEFAULT_QUEST = Object.freeze({ quest_key: 'arrange_meeting', content_version: 1 });
const AUTO_RETRIES = 2;
const MAX_POLLS = 120;

export type NoticeKind = 'stale' | 'config' | 'retryable' | 'error' | 'completed' | 'abandoned' | 'processing';
export interface Notice { kind: NoticeKind; message: string; code?: string; details?: unknown }

export interface PendingSend {
  requestId: string;
  npcKey: string;
  text: string;
  attempts: number;
}

/** What a send ended as — the panel decides whether the composer may be cleared. */
export type SendOutcome = 'applied' | 'duplicate' | 'stale' | 'config' | 'retryable' | 'error' | 'cancelled' | 'skipped';

export interface LearningSession {
  phase: 'idle' | 'starting' | 'ready' | 'sending' | 'processing' | 'failed';
  state: SessionState | null;
  sessionId: number | null;
  pending: PendingSend | null;
  notice: Notice | null;
  lastXp: number;
  start: () => Promise<void>;
  say: (npcKey: string, text: string) => Promise<SendOutcome>;
  retry: () => Promise<SendOutcome>;
  abandon: () => Promise<void>;
  refresh: () => Promise<void>;
  dismissNotice: () => void;
}

export interface UseLearningSessionOptions {
  widgetId: number;
  transport: Neo16Transport;
  questKey?: string;
  contentVersion?: number;
  /** Delay between GET state polls while a turn is `processing`. */
  pollIntervalMs?: number;
  /** Start the session on mount (default true). */
  autoStart?: boolean;
  restoreSession?: boolean;
}

export function newRequestId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Fold a 200 `applied` reply into the state we hold — no re-fetch needed. */
function applySay(prev: SessionState, r: AppliedSay, pending: PendingSend): SessionState {
  const inputNumber = prev.turns.reduce((m, t) => Math.max(m, t.input_number ?? 0), 0) + 1;
  const turn: PublicTurn = {
    id: r.turn.id,
    input_number: inputNumber,
    command: 'say',
    npc_key: pending.npcKey,
    text: pending.text,
    processing_status: 'applied',
    applied_version: r.session.state_version,
    npc_response: r.turn.npc_response,
    evaluation: r.turn.evaluation,
    execution: null,
  };
  const turns = prev.turns.some((t) => t.id === turn.id)
    ? prev.turns.map((t) => (t.id === turn.id ? turn : t))
    : [...prev.turns, turn];
  return {
    ...prev,
    session: { ...prev.session, state_version: r.session.state_version, goals_done: r.session.goals_done, status: r.session.status },
    turns,
    progress: r.progress ?? prev.progress,
  };
}

export function useLearningSession(opts: UseLearningSessionOptions): LearningSession {
  const { widgetId, transport, autoStart = true, pollIntervalMs = 1500 } = opts;
  const questKey = opts.questKey ?? DEFAULT_QUEST.quest_key;
  const contentVersion = opts.contentVersion ?? DEFAULT_QUEST.content_version;
  const storageKey = opts.restoreSession ? `neo16:session:${widgetId}:${questKey}:${contentVersion}` : null;

  const [phase, setPhase] = useState<LearningSession['phase']>('idle');
  const [state, setState] = useState<SessionState | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingSend | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lastXp, setLastXp] = useState(0);

  // Latest values for async continuations; one in-flight command at a time per tab.
  const stateRef = useRef<SessionState | null>(null);
  const sessionRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  const commit = useCallback((next: SessionState | null) => {
    stateRef.current = next;
    if (aliveRef.current) setState(next);
  }, []);

  const refresh = useCallback(async () => {
    const sid = sessionRef.current;
    if (sid == null) return;
    const next = await transport.getState(sid, widgetId);
    commit(next);
    if (next.session.status === 'completed') setNotice({ kind: 'completed', message: 'Quest completed.' });
    else if (next.session.status === 'abandoned') setNotice({ kind: 'abandoned', message: 'Session abandoned. Start a new attempt when ready.' });
  }, [transport, widgetId, commit]);

  const start = useCallback(async () => {
    setPhase('starting');
    setNotice(null);
    setPending(null);
    try {
      const { body } = await transport.startSession({
        widget_id: widgetId,
        request_id: newRequestId(),
        command: 'start_session',
        payload: { quest_key: questKey, content_version: contentVersion },
      });
      if (storageKey) {
        try { sessionStorage.setItem(storageKey, String(body.session_id)); } catch { /* Storage can be disabled. */ }
      }
      sessionRef.current = body.session_id;
      setSessionId(body.session_id);
      commit(body.state);
      if (body.state.session.status !== 'active') {
        setNotice({ kind: body.state.session.status === 'completed' ? 'completed' : 'abandoned', message: `Session is ${body.state.session.status}.` });
      }
      setPhase('ready');
    } catch (err) {
      setPhase('failed');
      setNotice(startNotice(err, questKey, contentVersion));
    }
  }, [transport, widgetId, questKey, contentVersion, commit, storageKey]);

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      let saved: string | null = null;
      if (storageKey) {
        try { saved = sessionStorage.getItem(storageKey); } catch { /* Storage can be disabled. */ }
      }
      if (saved && Number.isSafeInteger(Number(saved)) && Number(saved) > 0) {
        setPhase('starting');
        try {
          const next = await transport.getState(Number(saved), widgetId);
          if (cancelled) return;
          sessionRef.current = next.session.id;
          setSessionId(next.session.id);
          commit(next);
          setPhase('ready');
          return;
        } catch (error) {
          if (cancelled) return;
          if (!(error instanceof Neo16ApiError && error.status === 404)) {
            setPhase('failed');
            setNotice(toNotice(error));
            return;
          }
          // A pointer from another signed-in actor is never authority; the API denied it.
          if (storageKey) { try { sessionStorage.removeItem(storageKey); } catch { /* No storage. */ } }
        }
      }
      if (!cancelled) await start();
    };
    if (autoStart) void restore();
    return () => { cancelled = true; };
  }, [autoStart, start, storageKey, transport, widgetId, commit]);

  /** Wait for a `processing` turn to settle by re-reading state. */
  const settleProcessing = useCallback(async (turnId: number): Promise<'applied' | 'failed' | 'cancelled' | 'timeout'> => {
    const sid = sessionRef.current;
    if (sid == null) return 'cancelled';
    for (let i = 0; i < MAX_POLLS && aliveRef.current; i += 1) {
      await sleep(pollIntervalMs);
      const next = await transport.getState(sid, widgetId);
      commit(next);
      const turn = next.turns.find((t) => t.id === turnId);
      if (!turn) return 'cancelled';
      if (turn.processing_status === 'applied') return 'applied';
      if (turn.processing_status === 'failed') return 'failed';
      if (turn.processing_status === 'cancelled') return 'cancelled';
    }
    return 'timeout';
  }, [transport, widgetId, pollIntervalMs, commit]);

  /**
   * One attempt of the pending `say`. Resolves with what to do next; never
   * generates a new request_id — that is the caller's (user's) decision.
   */
  const attempt = useCallback(async (p: PendingSend): Promise<SendOutcome> => {
    const sid = sessionRef.current;
    const cur = stateRef.current;
    if (sid == null || !cur) return 'skipped';
    setPhase('sending');
    setNotice(null);
    let res: { status: number; body: CommandResult };
    try {
      res = await transport.sendCommand(sid, {
        widget_id: widgetId,
        session_id: sid,
        request_id: p.requestId,
        expected_version: cur.session.state_version,
        command: 'say',
        payload: { npc_key: p.npcKey, text: p.text },
      });
    } catch (err) {
      if (err instanceof Neo16ApiError && err.status === 502 && p.attempts < AUTO_RETRIES) {
        // Retryable receipt: replay the SAME request_id, never a new one.
        const again = { ...p, attempts: p.attempts + 1 };
        setPending(again);
        return attempt(again);
      }
      if (err instanceof Neo16ApiError && STALE_ERROR_CODES.has(err.code)) {
        setPending(null);
        setPhase('ready');
        await refresh().catch(() => undefined);
        setNotice({ kind: 'stale', message: 'The session changed in another tab. State reloaded — your text was not sent.', code: err.code });
        return 'stale';
      }
      if (err instanceof Neo16ApiError && CONFIG_ERROR_CODES.has(err.code)) {
        setPending(null);
        setPhase('ready');
        setNotice({ kind: 'config', message: `NPC agent is not configured for this installation (${err.code}).`, code: err.code, details: err.details });
        return 'config';
      }
      setPending({ ...p, attempts: p.attempts + 1 });
      setPhase('ready');
      if (err instanceof Neo16ApiError && err.status === 502) {
        setNotice({ kind: 'retryable', message: 'The NPC did not answer. Retry sends the same request.', code: err.code });
        return 'retryable';
      }
      setNotice(toNotice(err));
      return 'error';
    }

    const { body } = res;
    if (body.status === 'applied' && 'quest_completed' in body) {
      commit(applySay(stateRef.current ?? cur, body, p));
      setPending(null);
      setPhase('ready');
      if (body.xp_awarded) setLastXp(body.xp_awarded);
      if (body.quest_completed) setNotice({ kind: 'completed', message: `Quest completed! +${body.xp_awarded} XP` });
      return 'applied';
    }
    if (body.status === 'duplicate') {
      // Saved outcome of this very request: the authoritative row is in state.
      setPending(null);
      setPhase('ready');
      await refresh().catch(() => undefined);
      return 'duplicate';
    }
    if (body.status === 'processing') {
      setPhase('processing');
      setNotice({ kind: 'processing', message: 'The NPC is thinking…' });
      const outcome = await settleProcessing(body.turn.id);
      if (outcome === 'applied') { setPending(null); setPhase('ready'); setNotice(null); return 'applied'; }
      if (outcome === 'failed' && p.attempts < AUTO_RETRIES) {
        const again = { ...p, attempts: p.attempts + 1 };
        setPending(again);
        return attempt(again);
      }
      setPhase('ready');
      setNotice(outcome === 'cancelled'
        ? { kind: 'stale', message: 'This turn was cancelled. State reloaded.' }
        : { kind: 'retryable', message: 'The NPC did not answer in time. Retry sends the same request.' });
      if (outcome === 'cancelled') { setPending(null); return 'cancelled'; }
      return 'retryable';
    }
    if (body.status === 'stale') {
      setPending(null);
      setPhase('ready');
      await refresh().catch(() => undefined);
      setNotice({ kind: 'stale', message: 'Your turn was superseded (stale). State reloaded — nothing was resent.', code: 'stale' });
      return 'stale';
    }
    // abandon-shaped `applied` on a say path cannot happen; treat as a refresh.
    setPending(null);
    setPhase('ready');
    await refresh().catch(() => undefined);
    return 'error';
  }, [transport, widgetId, refresh, settleProcessing, commit]);

  const say = useCallback(async (npcKey: string, text: string): Promise<SendOutcome> => {
    const trimmed = text.trim();
    if (!trimmed || busyRef.current) return 'skipped';
    const cur = stateRef.current;
    if (!cur || cur.session.status !== 'active') return 'skipped';
    busyRef.current = true;
    const p: PendingSend = { requestId: newRequestId(), npcKey, text: trimmed, attempts: 0 };
    setPending(p);
    try { return await attempt(p); } finally { busyRef.current = false; }
  }, [attempt]);

  const retry = useCallback(async (): Promise<SendOutcome> => {
    if (!pending || busyRef.current) return 'skipped';
    busyRef.current = true;
    try { return await attempt(pending); } finally { busyRef.current = false; }
  }, [pending, attempt]);

  const abandon = useCallback(async () => {
    const sid = sessionRef.current;
    const cur = stateRef.current;
    if (sid == null || !cur || busyRef.current) return;
    busyRef.current = true;
    setPhase('sending');
    try {
      const { body } = await transport.sendCommand(sid, {
        widget_id: widgetId,
        session_id: sid,
        request_id: newRequestId(),
        expected_version: cur.session.state_version,
        command: 'abandon_session',
        payload: {},
      });
      setPending(null);
      if (body.status === 'applied' && 'cancelled_turns' in body) {
        commit({ ...(stateRef.current ?? cur), session: { ...cur.session, status: 'abandoned', state_version: body.session.state_version } });
      }
      await refresh().catch(() => undefined);
      setPhase('ready');
    } catch (err) {
      setPhase('ready');
      if (err instanceof Neo16ApiError && STALE_ERROR_CODES.has(err.code)) {
        await refresh().catch(() => undefined);
        setNotice({ kind: 'stale', message: 'The session changed in another tab. State reloaded.', code: err.code });
      } else {
        setNotice(toNotice(err));
      }
    } finally {
      busyRef.current = false;
    }
  }, [transport, widgetId, refresh, commit]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  return useMemo(() => ({
    phase, state, sessionId, pending, notice, lastXp, start, say, retry, abandon, refresh, dismissNotice,
  }), [phase, state, sessionId, pending, notice, lastXp, start, say, retry, abandon, refresh, dismissNotice]);
}

/**
 * A failed `start_session` where the server rejected the quest itself is a widget
 * configuration problem (W2-S6: `config.quest_key` / `config.content_version`), so it
 * is shown as one — naming the quest that was asked for — never swallowed into the
 * default quest. Every other failure keeps the generic mapping.
 */
function startNotice(err: unknown, questKey: string, contentVersion: number): Notice {
  if (err instanceof Neo16ApiError && (err.code === 'QUEST_NOT_FOUND' || err.code === 'VALIDATION_ERROR')) {
    return {
      kind: 'config',
      message: `Quest "${questKey}@${contentVersion}" is not available here (${err.code}). Check the widget's quest_key / content_version.`,
      code: err.code,
      details: err.details,
    };
  }
  return toNotice(err);
}

function toNotice(err: unknown): Notice {
  if (err instanceof Neo16ApiError) {
    if (CONFIG_ERROR_CODES.has(err.code)) {
      return { kind: 'config', message: `NPC agent is not configured for this installation (${err.code}).`, code: err.code, details: err.details };
    }
    if (err.status === 401) return { kind: 'error', message: 'Sign in again to continue.', code: err.code };
    if (err.status === 404) return { kind: 'error', message: 'This widget is not an installed Neo16 module (or you have no access).', code: err.code };
    return { kind: 'error', message: `${err.code}: ${err.message}`, code: err.code, details: err.details };
  }
  return { kind: 'error', message: err instanceof Error ? err.message : 'Request failed' };
}
