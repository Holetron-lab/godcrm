import React, { useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

export interface ContextStats {
  total_tokens_in: number;
  total_tokens_out: number;
  total_messages: number;
  text_messages: number;
  tool_calls: number;
  thinking_steps: number;
  last_prompt_tokens: number;
  model_used: string | null;
  context_window: number | null;
  context_usage_percent: number | null;
}

interface ContextIndicatorProps {
  stats: ContextStats | null;
  className?: string;
}

/** Format token count to compact form: 1234 → "1.2K", 123456 → "123K" */
function formatTokens(n: number): string {
  if (n === 0) return '0';
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1) + 'K';
  if (n < 1000000) return Math.round(n / 1000) + 'K';
  return (n / 1000000).toFixed(1) + 'M';
}

/** Get color class based on usage percentage */
function getUsageColor(percent: number | null): { bar: string; text: string; bg: string } {
  if (percent === null || percent === 0) return { bar: 'bg-gray-500', text: 'text-gray-400', bg: 'bg-gray-500/10' };
  if (percent < 50) return { bar: 'bg-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-500/10' };
  if (percent < 75) return { bar: 'bg-yellow-500', text: 'text-yellow-400', bg: 'bg-yellow-500/10' };
  if (percent < 90) return { bar: 'bg-orange-500', text: 'text-orange-400', bg: 'bg-orange-500/10' };
  return { bar: 'bg-red-500', text: 'text-red-400', bg: 'bg-red-500/10' };
}

/** Format model name to short form */
function formatModel(model: string | null): string {
  if (!model) return '—';
  // Remove date suffixes like "-20241022"
  const cleaned = model.replace(/-\d{8}$/, '');
  // Short aliases
  const shorts: Record<string, string> = {
    'claude-3-5-sonnet': 'Sonnet 3.5',
    'claude-3.5-sonnet': 'Sonnet 3.5',
    'claude-sonnet-4': 'Sonnet 4',
    'claude-4-sonnet': 'Sonnet 4',
    'claude-opus-4': 'Opus 4',
    'claude-4-opus': 'Opus 4',
    'claude-3-opus': 'Opus 3',
    'claude-3-haiku': 'Haiku 3',
    'claude-3.5-haiku': 'Haiku 3.5',
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o mini',
    'gpt-4-turbo': 'GPT-4 Turbo',
    'o1': 'o1',
    'o3': 'o3',
    'o3-mini': 'o3-mini',
    'o4-mini': 'o4-mini',
  };
  const lower = cleaned.toLowerCase();
  return shorts[lower] || cleaned;
}

export const ContextIndicator: React.FC<ContextIndicatorProps> = ({ stats, className }) => {
  const [showTooltip, setShowTooltip] = useState(false);

  const { percent, colors, tokenText, totalTokens } = useMemo(() => {
    if (!stats) return { percent: null, colors: getUsageColor(null), tokenText: '', totalTokens: 0 };

    const p = stats.context_usage_percent;
    const c = getUsageColor(p);
    const total = stats.total_tokens_in + stats.total_tokens_out;

    let text = '';
    if (stats.last_prompt_tokens > 0 && stats.context_window) {
      text = `${formatTokens(stats.last_prompt_tokens)} / ${formatTokens(stats.context_window)}`;
    } else if (total > 0) {
      text = `${formatTokens(total)} tokens`;
    }

    return { percent: p, colors: c, tokenText: text, totalTokens: total };
  }, [stats]);

  if (!stats || stats.total_messages === 0) return null;

  return (
    <div
      className={cn("relative inline-flex items-center", className)}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Compact badge */}
      <div className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium cursor-default transition-colors",
        colors.bg, colors.text
      )}>
        {/* Mini progress bar */}
        <div className="w-8 h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-500", colors.bar)}
            style={{ width: `${Math.min(percent || 0, 100)}%` }}
          />
        </div>

        {/* Percentage or token text */}
        {percent !== null ? (
          <span>{percent}%</span>
        ) : tokenText ? (
          <span>{tokenText}</span>
        ) : (
          <span>{stats.total_messages} msg</span>
        )}
      </div>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 w-56 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] shadow-xl text-xs">
          {/* Arrow */}
          <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-[var(--bg-secondary)] border-l border-t border-[var(--border-primary)]" />

          <div className="relative space-y-2">
            {/* Title */}
            <div className="flex items-center gap-1.5 text-[var(--text-primary)] font-medium">
              <Activity className="w-3.5 h-3.5" />
              Context Usage
            </div>

            {/* Progress bar (full) */}
            {percent !== null && (
              <div>
                <div className="flex justify-between text-[10px] text-[var(--text-secondary)] mb-1">
                  <span>{formatTokens(stats.last_prompt_tokens)} prompt</span>
                  <span className={colors.text}>{percent}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all duration-500", colors.bar)}
                    style={{ width: `${Math.min(percent, 100)}%` }}
                  />
                </div>
                <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5 text-right">
                  {formatTokens(stats.context_window || 0)} window
                </div>
              </div>
            )}

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
              <div className="text-[var(--text-tertiary)]">Tokens in</div>
              <div className="text-[var(--text-primary)] text-right font-mono">{formatTokens(stats.total_tokens_in)}</div>

              <div className="text-[var(--text-tertiary)]">Tokens out</div>
              <div className="text-[var(--text-primary)] text-right font-mono">{formatTokens(stats.total_tokens_out)}</div>

              <div className="text-[var(--text-tertiary)]">Total tokens</div>
              <div className="text-[var(--text-primary)] text-right font-mono">{formatTokens(totalTokens)}</div>

              <div className="col-span-2 h-px bg-[var(--border-secondary)] my-0.5" />

              <div className="text-[var(--text-tertiary)]">Messages</div>
              <div className="text-[var(--text-primary)] text-right font-mono">{stats.text_messages}</div>

              <div className="text-[var(--text-tertiary)]">Tool calls</div>
              <div className="text-[var(--text-primary)] text-right font-mono">{stats.tool_calls}</div>

              <div className="text-[var(--text-tertiary)]">Thinking</div>
              <div className="text-[var(--text-primary)] text-right font-mono">{stats.thinking_steps}</div>

              {stats.model_used && (
                <>
                  <div className="col-span-2 h-px bg-[var(--border-secondary)] my-0.5" />
                  <div className="text-[var(--text-tertiary)]">Model</div>
                  <div className="text-[var(--text-primary)] text-right truncate">{formatModel(stats.model_used)}</div>
                </>
              )}
            </div>

            {/* Cost estimate */}
            {totalTokens > 0 && (
              <div className="pt-1 border-t border-[var(--border-secondary)] text-[10px] text-[var(--text-tertiary)]">
                ~${((stats.total_tokens_in * 0.003 + stats.total_tokens_out * 0.015) / 1000).toFixed(3)} estimated cost
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
