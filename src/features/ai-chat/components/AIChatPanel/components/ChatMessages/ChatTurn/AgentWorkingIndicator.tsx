/**
 * AgentWorkingIndicator — Real-time agent work visibility component.
 *
 * Shows the agent's current action as a live-updating step display.
 * The agent_status message is updated by the backend every few seconds
 * and polled via React Query. Shows:
 *   - Current status icon (thinking/tool_call/generating)
 *   - Current action text (what the agent is doing right now)
 *   - Tool progress counter (completed/total)
 *   - Elapsed time since start
 */

import React, { useMemo, useState, useEffect } from 'react';
import { Brain, Wrench, Sparkles, AlertCircle, Zap } from 'lucide-react';

interface AgentStatusMetadata {
  agent_status?: string;
  agent_action?: string;
  agent_name?: string;
  agent_icon?: string;
  agent_color?: string;
  tools_used?: number;
  tools_completed?: number;
  started_at?: string;
  placeholder?: boolean;
  [key: string]: unknown;
}

interface AgentWorkingIndicatorProps {
  metadata: AgentStatusMetadata;
}

const STATUS_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  starting: { icon: Sparkles, label: 'Запускается', color: 'text-blue-400' },
  thinking: { icon: Brain, label: 'Думает', color: 'text-purple-400' },
  tool_call: { icon: Wrench, label: 'Инструмент', color: 'text-orange-400' },
  generating: { icon: Sparkles, label: 'Генерирует ответ', color: 'text-green-400' },
  error: { icon: AlertCircle, label: 'Ошибка', color: 'text-red-400' },
};

export const AgentWorkingIndicator: React.FC<AgentWorkingIndicatorProps> = React.memo(({ metadata }) => {
  const status = metadata.agent_status || 'starting';
  const action = metadata.agent_action || '';
  const toolsUsed = metadata.tools_used || 0;
  const toolsCompleted = metadata.tools_completed || 0;
  const startedAt = metadata.started_at;
  const isPlaceholder = metadata.placeholder !== false;

  // Don't render if agent is finished
  if (!isPlaceholder && status === 'finished') return null;

  const config = STATUS_CONFIG[status] || STATUS_CONFIG.starting;
  const StatusIcon = config.icon;

  // Live elapsed timer — updates every second
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = useMemo(() => {
    if (!startedAt) return null;
    const start = new Date(startedAt).getTime();
    if (isNaN(start)) return null;
    const seconds = Math.floor((now - start) / 1000);
    if (seconds < 2) return null;
    if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${seconds}s`;
  }, [startedAt, now]);

  return (
    <div className="flex items-center gap-2.5 py-1.5">
      {/* Status icon with agent color */}
      <div
        className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: (metadata.agent_color || 'rgb(168, 85, 247)') + '20' }}
      >
        <StatusIcon className={`w-3 h-3 ${config.color}`} />
      </div>

      {/* Current action — the main real-time content */}
      <div className="min-w-0 flex-1">
        <span className={`text-xs font-medium ${config.color}`}>
          {config.label}
        </span>
        {action && (
          <span className="text-xs text-[var(--text-secondary)] ml-1.5">
            — {action}
          </span>
        )}
      </div>

      {/* Tool counter */}
      {toolsUsed > 0 && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[10px] tabular-nums text-[var(--text-tertiary)] flex-shrink-0">
          <Zap className="w-2.5 h-2.5 text-amber-400" />
          {toolsCompleted}/{toolsUsed}
        </span>
      )}

      {/* Elapsed time */}
      {elapsed && (
        <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums flex-shrink-0 opacity-70">
          {elapsed}
        </span>
      )}
    </div>
  );
});
