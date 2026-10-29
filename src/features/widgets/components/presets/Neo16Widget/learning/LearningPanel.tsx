/**
 * Neo16 W2-S5 — conversation + feedback panel.
 *
 * Renders ONLY what the server returned: quest content, goals done, XP from
 * `progress`, the NPC's reply and the evaluation of each applied turn. The
 * transport is injectable so the two-tab serialization test runs without HTTP.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PALETTE } from '../types';
import { createHttpTransport } from './transport';
import { useLearningSession, type Notice, type SendOutcome } from './useLearningSession';
import type { Neo16Transport, PublicTurn, Quest } from './types';

export interface LearningPanelProps {
  widgetId: number;
  transport?: Neo16Transport;
  questKey?: string;
  contentVersion?: number;
  pollIntervalMs?: number;
  onClose?: () => void;
  width?: number;
  selectedNpcKey?: string;
  restoreSession?: boolean;
}

const mono = { fontFamily: 'monospace' } as const;

const NOTICE_COLOR: Record<Notice['kind'], string> = {
  stale: PALETTE.amber,
  config: PALETTE.lightRed,
  retryable: PALETTE.peach,
  error: PALETTE.lightRed,
  completed: PALETTE.freshGreen,
  abandoned: PALETTE.lightGrey,
  processing: PALETTE.cyan,
};

function npcName(quest: Quest | undefined, key: string | null): string {
  if (!key) return 'NPC';
  return quest?.npcs.find((n) => n.key === key)?.name ?? key;
}

function TurnView({ turn, quest }: { turn: PublicTurn; quest: Quest }) {
  if (turn.command === 'abandon_session') {
    return (
      <li className="text-xs italic" style={{ color: PALETTE.lightGrey }}>— session abandoned —</li>
    );
  }
  const ev = turn.evaluation;
  const goal = ev?.goal_completed ? quest.goals.find((g) => g.key === ev.goal_completed) : null;
  return (
    <li className="text-xs space-y-1" data-testid={`turn-${turn.id}`} data-status={turn.processing_status}>
      <div>
        <span style={{ color: PALETTE.cyan }}>You → {npcName(quest, turn.npc_key)}:</span>{' '}
        <span style={{ color: PALETTE.pale }}>{turn.text}</span>
      </div>
      {turn.processing_status === 'processing' && (
        <div style={{ color: PALETTE.lightGrey }}>{npcName(quest, turn.npc_key)} is thinking…</div>
      )}
      {turn.processing_status === 'failed' && (
        <div style={{ color: PALETTE.peach }}>No answer yet — retry below.</div>
      )}
      {turn.npc_response && (
        <div>
          <span style={{ color: PALETTE.peach }}>{npcName(quest, turn.npc_key)}:</span>{' '}
          <span style={{ color: PALETTE.nearWhite }}>{turn.npc_response}</span>
        </div>
      )}
      {goal && (
        <div style={{ color: PALETTE.freshGreen }}>✓ Goal: {goal.title}</div>
      )}
      {ev && ev.feedback.length > 0 && (
        <ul className="pl-3 space-y-0.5" aria-label="Feedback">
          {ev.feedback.map((f, i) => (
            <li key={i} style={{ color: f.type === 'praise' ? PALETTE.lightGreen : PALETTE.yellow }}>
              [{f.type}] {f.message}
            </li>
          ))}
        </ul>
      )}
      {ev && ev.grammar_errors.length > 0 && (
        <ul className="pl-3 space-y-0.5" aria-label="Grammar">
          {ev.grammar_errors.map((g, i) => (
            <li key={i} style={{ color: PALETTE.lightGrey }}>
              <s style={{ color: PALETTE.lightRed }}>{g.original}</s> → <b style={{ color: PALETTE.freshGreen }}>{g.corrected}</b>
              <span style={{ color: PALETTE.lightGrey }}> · {g.rule}</span>
            </li>
          ))}
        </ul>
      )}
      {ev && ev.vocabulary.length > 0 && (
        <ul className="pl-3 space-y-0.5" aria-label="Vocabulary">
          {ev.vocabulary.map((v, i) => (
            <li key={i} style={{ color: PALETTE.lightGrey }}>
              <b style={{ color: PALETTE.purple }}>{v.term}</b> — {v.meaning}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function LearningPanel({
  widgetId, transport, questKey, contentVersion, pollIntervalMs, onClose, width = 360, selectedNpcKey, restoreSession,
}: LearningPanelProps) {
  const http = useMemo(() => transport ?? createHttpTransport(), [transport]);
  const s = useLearningSession({ widgetId, transport: http, questKey, contentVersion, pollIntervalMs, restoreSession });
  const quest = s.state?.quest;
  const session = s.state?.session;
  const [npcKey, setNpcKey] = useState<string>('');
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (quest && !quest.npcs.some((n) => n.key === npcKey)) setNpcKey(quest.npcs[0]?.key ?? '');
  }, [quest, npcKey]);

  useEffect(() => {
    if (selectedNpcKey && quest?.npcs.some((n) => n.key === selectedNpcKey)) setNpcKey(selectedNpcKey);
  }, [selectedNpcKey, quest]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [s.state?.turns.length, s.phase]);

  // The composer keeps its text while a send is in flight. It is cleared only when the
  // turn is applied; on stale / config / error the learner decides whether to resend
  // (which mints a NEW request_id — the old one is never reused with different intent).
  const afterSend = (sent: string, outcome: SendOutcome) => {
    if (outcome === 'applied' || outcome === 'duplicate') setText((cur) => (cur === sent ? '' : cur));
  };

  const active = session?.status === 'active';
  const busy = s.phase === 'sending' || s.phase === 'processing' || s.phase === 'starting';
  const canSend = active && !busy && !s.pending && text.trim().length > 0 && npcKey !== '';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    const sent = text;
    void s.say(npcKey, sent).then((outcome) => afterSend(sent, outcome));
  };

  const goalsDone = new Set(session?.goals_done ?? []);

  return (
    <section
      aria-label="Neo16 quest"
      className="absolute right-0 top-0 bottom-0 flex flex-col border-l"
      style={{ width, maxWidth: '100%', backgroundColor: PALETTE.deepNight, borderColor: PALETTE.darkWall, zIndex: 20, ...mono }}
    >
      <header className="flex items-start justify-between gap-2 px-3 py-2 border-b" style={{ borderColor: PALETTE.darkWall }}>
        <div className="min-w-0">
          <div className="text-sm font-bold truncate" style={{ color: PALETTE.cyan }}>
            📚 {quest?.title ?? 'Loading quest…'}
          </div>
          <div className="text-[10px]" style={{ color: PALETTE.lightGrey }}>
            {session ? <span data-testid="session-status">session #{session.id} · {session.status} · v{session.state_version}</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: PALETTE.darkWall, color: PALETTE.gold }} data-testid="xp">
            ★ {s.state?.progress?.xp ?? 0} XP
          </span>
          {onClose && (
            <button type="button" onClick={onClose} className="text-xs px-2 py-1 rounded hover:opacity-80"
              style={{ backgroundColor: PALETTE.darkWall, color: PALETTE.pale }} aria-label="Close quest panel">
              ✕
            </button>
          )}
        </div>
      </header>

      {quest && (
        <div className="px-3 py-2 border-b text-xs space-y-1" style={{ borderColor: PALETTE.darkWall }}>
          {quest.intro && <p style={{ color: PALETTE.lightGrey }}>{quest.intro}</p>}
          <ul aria-label="Goals" className="space-y-0.5">
            {quest.goals.map((g) => {
              const done = goalsDone.has(g.key);
              return (
                <li key={g.key} data-testid={`goal-${g.key}`} data-done={done ? 'true' : 'false'}
                  style={{ color: done ? PALETTE.freshGreen : PALETTE.pale }}>
                  {done ? '☑' : '☐'} {g.title}
                  <span style={{ color: PALETTE.lightGrey }}> · {npcName(quest, g.npc)}</span>
                </li>
              );
            })}
          </ul>
          {quest.preparation?.phrases?.length ? (
            <details>
              <summary className="cursor-pointer" style={{ color: PALETTE.lightGrey }}>Useful phrases</summary>
              <ul className="pl-3">
                {quest.preparation.phrases.map((p, i) => (
                  <li key={i} style={{ color: PALETTE.lightGrey }}>
                    “{p.text}”{p.note ? <span style={{ color: PALETTE.lightGrey }}> — {p.note}</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}

      <ol ref={scrollRef} aria-label="Conversation" className="flex-1 overflow-y-auto px-3 py-2 space-y-3 list-none">
        {quest && (s.state?.turns.length ?? 0) === 0 && (
          <li className="text-xs" style={{ color: PALETTE.lightGrey }}>Pick an NPC and say something in English.</li>
        )}
        {quest && s.state?.turns.map((t) => <TurnView key={t.id} turn={t} quest={quest} />)}
      </ol>

      {s.notice && (
        <div role={s.notice.kind === 'config' || s.notice.kind === 'error' ? 'alert' : 'status'} data-testid={`notice-${s.notice.kind}`}
          className="mx-3 mb-2 px-2 py-1.5 rounded text-xs flex items-start justify-between gap-2"
          style={{ backgroundColor: PALETTE.darkWall, color: NOTICE_COLOR[s.notice.kind], border: `1px solid ${NOTICE_COLOR[s.notice.kind]}55` }}>
          <div>
            <div>{s.notice.message}</div>
            {s.notice.kind === 'config' && (
              <div style={{ color: PALETTE.lightGrey }}>
                Bind an agent row to this installation (neo16_content · agent_binding). Nothing was sent.
              </div>
            )}
          </div>
          <div className="flex gap-1 shrink-0">
            {s.notice.kind === 'retryable' && s.pending && (
              <button type="button" onClick={() => { const sent = text; void s.retry().then((o) => afterSend(sent, o)); }} className="px-2 py-0.5 rounded"
                style={{ backgroundColor: PALETTE.shadow, color: PALETTE.nearWhite }}>
                Retry
              </button>
            )}
            {s.notice.kind !== 'processing' && (
              <button type="button" onClick={s.dismissNotice} aria-label="Dismiss" className="px-1"
                style={{ color: PALETTE.lightGrey }}>✕</button>
            )}
          </div>
        </div>
      )}

      <form onSubmit={submit} className="p-2 border-t space-y-2" style={{ borderColor: PALETTE.darkWall }}>
        <div className="flex gap-2">
          {/* Typing must not reach useGameLoop's window keydown (WASD / Enter toggle the office). */}
          <select aria-label="Talk to" value={npcKey} onChange={(e) => setNpcKey(e.target.value)} disabled={!active || busy}
            onKeyDown={(e) => e.stopPropagation()}
            className="text-xs rounded px-1 py-1" style={{ backgroundColor: PALETTE.darkWall, color: PALETTE.pale, border: `1px solid ${PALETTE.shadow}` }}>
            {quest?.npcs.map((n) => <option key={n.key} value={n.key}>{n.name} · {n.role}</option>)}
          </select>
          <input
            aria-label="Your message"
            type="text"
            value={text}
            maxLength={1000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder={active ? 'Say it in English…' : 'Session is not active'}
            disabled={!active || busy}
            className="min-w-0 flex-1 px-2 py-1 text-xs rounded focus-visible:ring-2"
            style={{ backgroundColor: PALETTE.darkWall, color: PALETTE.pale, border: `1px solid ${PALETTE.shadow}`, ...mono }}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <button type="submit" disabled={!canSend} className="text-xs px-3 py-1 rounded disabled:opacity-50"
            style={{ backgroundColor: PALETTE.forest, color: PALETTE.nearWhite }}>
            {s.phase === 'processing' ? 'Waiting…' : s.phase === 'sending' ? 'Sending…' : 'Send'}
          </button>
          {active ? (
            <button type="button" onClick={() => void s.abandon()} disabled={busy}
              className="text-xs px-3 py-1 rounded disabled:opacity-50"
              style={{ backgroundColor: PALETTE.darkWall, color: PALETTE.lightRed, border: `1px solid ${PALETTE.red}` }}>
              Abandon session
            </button>
          ) : session ? (
            <button type="button" onClick={() => void s.start()} disabled={busy}
              className="text-xs px-3 py-1 rounded disabled:opacity-50"
              style={{ backgroundColor: PALETTE.deepBlue, color: PALETTE.nearWhite }}>
              Start new attempt
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
