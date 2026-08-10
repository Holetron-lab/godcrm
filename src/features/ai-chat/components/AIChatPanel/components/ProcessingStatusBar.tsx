/**
 * ProcessingStatusBar — self-contained "agent is working… Xs" indicator.
 *
 * Owns its own 1-Hz tick locally so the timer never propagates a re-render
 * up the AIChatPanel tree. Lifting the elapsed state to the panel root used
 * to invalidate MessagesArea every second, which remounted ChatTurn DOM and
 * killed text selection / table scroll position.
 */
import React, { memo, useEffect, useState } from 'react';
import { AlertCircle, Loader2, PauseCircle, RotateCcw, Square, XCircle } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { FEATURE_MULTI_AGENT_PRESENCE_V2 } from '../../../hooks/useInflightAgents';

// ADR-0057-A WP-A: minimal slice of the backend `active_agents[]` row that
// the multi-agent bar needs. Keeps the prop self-contained — the full
// `ActiveAgent` type lives in `useConversationMessages.ts`.
//
// ADR-0057-A WP-C (B.6): the optional `inflight_status` + pause taxonomy
// fields are populated by `useInflightAgents` when the feature flag is on.
// When unset, the row renders the legacy "running" treatment unchanged.
export interface ProcessingActiveAgent {
  agent_user_id: number | null;
  agent_name: string;
  started_at: string | null;
  agent_slug?: string | null;
  inflight_status?: 'running' | 'paused' | 'failed';
  reason?: string | null;
  resume_at?: string | null;
}

interface ProcessingStatusBarProps {
  isAgentProcessing: boolean;
  processingAgentName: string | null | undefined;
  processingStartedAt: number | null | undefined;
  stopAgent: () => void;
  /** ADR-0057-A WP-A: when 2+ agents are running, render one row per agent
   *  with its own elapsed timer. Falls back to the single-name UI for 0–1. */
  activeAgents?: ProcessingActiveAgent[];
  /** ADR-0057-A WP-C (B.6): retry handler for `failed` rows. Optional — when
   *  unset the badge logs to console.warn (stub fallback per the WP-C ticket
   *  acceptance criteria: failed-retry endpoint is not required for this PR). */
  onRetryAgent?: (agent: ProcessingActiveAgent) => void;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// ADR-0057-A WP-C — countdown in mm:ss until `resume_at`. Returns 'overdue'
// (with negative magnitude implicit) when the wall clock has already passed
// the scheduled resume. Caller renders the literal `now=Date.now()` so the
// 1Hz tick driven by ProcessingStatusBar refreshes the value without each
// row needing its own timer.
function formatCountdown(resumeAtIso: string | null | undefined, now: number): string {
  if (!resumeAtIso) return '';
  const target = new Date(resumeAtIso).getTime();
  if (isNaN(target)) return '';
  const diffSec = Math.floor((target - now) / 1000);
  if (diffSec <= 0) return 'overdue';
  const mm = Math.floor(diffSec / 60);
  const ss = diffSec % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

// 40-char truncation per WP-C B.6 acceptance criteria. Tail-ellipsis preserves
// the prefix (e.g. `paused-rate-limit:`) which carries the meaningful taxonomy.
function truncateReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (reason.length <= 40) return reason;
  return reason.slice(0, 39) + '…';
}

function ProcessingStatusBarImpl({
  isAgentProcessing,
  processingAgentName,
  processingStartedAt,
  stopAgent,
  activeAgents,
  onRetryAgent,
}: ProcessingStatusBarProps) {
  // Single 1Hz tick drives elapsed strings for the bar (and each agent row in
  // multi mode). Avoids N timers when many agents are running.
  const [, setTick] = useState(0);
  // ADR-0057-A WP-C — when the flag is on we may have paused/failed rows even
  // while the conversation's coarse `is_processing` flag has flipped to false
  // (writer not yet caught up). Surface them as long as `activeAgents` carries
  // any non-running entries — otherwise legacy single-bar behavior controls.
  const hasNonRunning = !!activeAgents?.some((a) => a.inflight_status && a.inflight_status !== 'running');
  const shouldRender = isAgentProcessing || (FEATURE_MULTI_AGENT_PRESENCE_V2 && hasNonRunning);
  const multi = (activeAgents?.length ?? 0) > 1
    || (FEATURE_MULTI_AGENT_PRESENCE_V2 && hasNonRunning && (activeAgents?.length ?? 0) >= 1);

  useEffect(() => {
    if (!shouldRender) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [shouldRender]);

  if (!shouldRender) return null;

  // Multi-agent: one row per agent, each with independent elapsed timer.
  if (multi && activeAgents) {
    const now = Date.now();
    const oldestElapsedSec = activeAgents.reduce((max, a) => {
      if (!a.started_at) return max;
      const t = new Date(a.started_at).getTime();
      if (isNaN(t)) return max;
      return Math.max(max, Math.floor((now - t) / 1000));
    }, 0);
    const wallClockBg = oldestElapsedSec >= 600
      ? 'bg-yellow-500/10 border-t border-yellow-500/30 text-yellow-400'
      : 'text-[var(--text-tertiary)]';
    return (
      <div className={cn('flex items-start justify-between gap-3 px-4 py-1.5 text-xs', wallClockBg)}>
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          {activeAgents.map((agent) => {
            const startedMs = agent.started_at ? new Date(agent.started_at).getTime() : NaN;
            const elapsedSec = isNaN(startedMs) ? 0 : Math.max(0, Math.floor((now - startedMs) / 1000));
            const slow = elapsedSec >= 600;
            const dead = elapsedSec >= 1500;
            // ADR-0057-A WP-C (B.6) — paused/failed treatments live behind
            // the flag. With the flag off (or status absent) the row falls
            // through to the legacy running treatment unchanged.
            const status = FEATURE_MULTI_AGENT_PRESENCE_V2 ? (agent.inflight_status ?? 'running') : 'running';
            const reasonChip = status !== 'running' ? truncateReason(agent.reason) : null;
            const countdown = status === 'paused' ? formatCountdown(agent.resume_at, now) : '';

            return (
              <div
                key={`${agent.agent_slug ?? agent.agent_user_id ?? agent.agent_name}`}
                className="flex items-center gap-2 min-w-0"
              >
                {status === 'paused' ? (
                  <PauseCircle className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
                ) : status === 'failed' ? (
                  <XCircle className="w-3.5 h-3.5 flex-shrink-0 text-red-400" />
                ) : slow ? (
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                ) : (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-primary-500)] flex-shrink-0" />
                )}
                <span className={cn('truncate', status === 'failed' && 'text-red-400')}>
                  {agent.agent_name || 'AI'}
                  {status === 'running' && (dead ? ' — возможно завис' : slow ? ' — работает давно' : '')}
                </span>
                {reasonChip && (
                  <span
                    className={cn(
                      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] tabular-nums flex-shrink-0',
                      status === 'paused'
                        ? 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
                        : 'bg-red-500/10 text-red-300 border border-red-500/30'
                    )}
                    title={agent.reason ?? undefined}
                  >
                    {reasonChip}
                  </span>
                )}
                {status === 'paused' && countdown && (
                  <span className={cn(
                    'text-[10px] tabular-nums flex-shrink-0',
                    countdown === 'overdue' ? 'text-amber-400 font-medium' : 'opacity-70'
                  )}>
                    {countdown === 'overdue' ? 'overdue' : `resume in ${countdown}`}
                  </span>
                )}
                {status === 'running' && (
                  <span className="opacity-70 tabular-nums flex-shrink-0">
                    {formatElapsed(elapsedSec)}
                  </span>
                )}
                {status === 'failed' && (
                  <button
                    onClick={() => {
                      if (onRetryAgent) onRetryAgent(agent);
                      else console.warn('[ProcessingStatusBar] retry handler not wired for', agent.agent_slug || agent.agent_name);
                    }}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-red-500/20 hover:bg-red-500/30 text-red-300 hover:text-red-200 transition-colors flex-shrink-0"
                    title="Retry agent"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Retry
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <button
          onClick={stopAgent}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 transition-colors flex-shrink-0"
          title="Остановить агентов"
        >
          <Square className="w-3 h-3 fill-current" />
          <span>Стоп</span>
        </button>
      </div>
    );
  }

  // Single-agent (legacy): unchanged behaviour.
  const elapsed = processingStartedAt
    ? Math.max(0, Math.floor((Date.now() - processingStartedAt) / 1000))
    : 0;
  return (
    <div className={cn(
      'flex items-center justify-between px-4 py-1.5 text-xs',
      elapsed >= 600
        ? 'bg-yellow-500/10 border-t border-yellow-500/30 text-yellow-400'
        : 'text-[var(--text-tertiary)]'
    )}>
      <div className="flex items-center gap-2">
        {elapsed >= 600
          ? <AlertCircle className="w-3.5 h-3.5" />
          : <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-primary-500)]" />}
        <span>
          {processingAgentName || 'AI'}
          {elapsed >= 1500 ? ' — возможно завис' : elapsed >= 600 ? ' — работает давно' : ''}
        </span>
        {elapsed > 0 && (
          <span className="opacity-70 tabular-nums">
            {formatElapsed(elapsed)}
          </span>
        )}
      </div>
      <button
        onClick={stopAgent}
        className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 transition-colors"
        title="Остановить агента"
      >
        <Square className="w-3 h-3 fill-current" />
        <span>Стоп</span>
      </button>
    </div>
  );
}

export const ProcessingStatusBar = memo(ProcessingStatusBarImpl);
