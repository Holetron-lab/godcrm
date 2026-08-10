import React, { useState, useEffect } from 'react';
import { Loader2, CheckCircle2, AlertCircle, Brain, Wrench, Sparkles, PlayCircle, ShieldAlert } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

// ADR-0057 WP-B: `auth_failure` is a terminal status (like `error`) used when
// the Claude CLI returns an Anthropic 401 due to OAuth-token rotation. The
// chat used to render the raw "Invalid authentication credentials" string as
// agent text — now it lands as an agent_status row with this status.
export type AgentStatusValue = 'starting' | 'thinking' | 'tool_call' | 'generating' | 'finished' | 'error' | 'auth_failure';

// ---------------------------------------------------------------------------
// AgentStatusBadge — renders current agent working status with animation
// ---------------------------------------------------------------------------

interface AgentStatusBadgeProps {
  status: AgentStatusValue;
  action: string;
  agentColor?: string;
  startedAt?: string;
  toolsUsed?: number;
  toolsCompleted?: number;
}

/** Format elapsed time as "Xs" or "Xm Ys" */
function formatElapsed(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  if (isNaN(start)) return '';
  const elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
  if (elapsed < 60) return `${elapsed}s`;
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${minutes}m ${seconds}s`;
}

const STATUS_ICONS: Record<AgentStatusValue, React.FC<{ className?: string }>> = {
  starting: Sparkles,
  thinking: Brain,
  tool_call: Wrench,
  generating: Sparkles,
  finished: CheckCircle2,
  error: AlertCircle,
  auth_failure: ShieldAlert,
};

export const AgentStatusBadge: React.FC<AgentStatusBadgeProps> = ({
  status,
  action,
  agentColor,
  startedAt,
  toolsUsed,
  toolsCompleted,
}) => {
  const [elapsed, setElapsed] = useState('');
  const isWorking = status !== 'finished' && status !== 'error' && status !== 'auth_failure';

  // Update elapsed time every second while working
  useEffect(() => {
    if (!startedAt || !isWorking) return;
    setElapsed(formatElapsed(startedAt));
    const interval = setInterval(() => {
      setElapsed(formatElapsed(startedAt));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt, isWorking]);

  const StatusIcon = STATUS_ICONS[status] || Sparkles;
  const dotColor = agentColor
    || (status === 'finished' ? '#22c55e'
    : (status === 'error' || status === 'auth_failure') ? '#ef4444'
    : '#a855f7');

  return (
    <div className="flex items-center gap-3 py-2">
      {/* Pulsing status dot */}
      <div className="relative flex-shrink-0">
        <span
          className={cn(
            'block w-2.5 h-2.5 rounded-full',
            isWorking && 'animate-pulse'
          )}
          style={{ backgroundColor: dotColor }}
        />
        {isWorking && (
          <span
            className="absolute inset-0 rounded-full animate-ping opacity-30"
            style={{ backgroundColor: dotColor }}
          />
        )}
      </div>

      {/* Status icon + action text */}
      <div className="flex items-center gap-1.5 min-w-0">
        {isWorking ? (
          <Loader2
            className="w-3.5 h-3.5 animate-spin flex-shrink-0"
            style={{ color: dotColor }}
          />
        ) : (
          <StatusIcon
            className={cn(
              'w-3.5 h-3.5 flex-shrink-0',
              status === 'finished' && 'text-green-500',
              (status === 'error' || status === 'auth_failure') && 'text-red-500'
            )}
          />
        )}
        <span className="text-xs text-[var(--text-secondary)] truncate">
          {action}
        </span>
      </div>

      {/* Worker completion: "2/5 tools" */}
      {toolsUsed != null && toolsUsed > 0 && (
        <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0 tabular-nums">
          {toolsCompleted ?? 0}/{toolsUsed} tools
        </span>
      )}

      {/* Elapsed time */}
      {elapsed && (
        <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0 tabular-nums">
          {elapsed}
        </span>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// ContinueButton — shown at bottom-left of finished agent status messages
// ---------------------------------------------------------------------------

interface ContinueButtonProps {
  onClick: () => void;
  agentColor?: string;
}

export const ContinueButton: React.FC<ContinueButtonProps> = ({ onClick, agentColor }) => (
  <button
    onClick={onClick}
    className="mt-2 flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
    style={agentColor ? { color: agentColor } : undefined}
  >
    <PlayCircle className="w-3.5 h-3.5" />
    Continue
  </button>
);
