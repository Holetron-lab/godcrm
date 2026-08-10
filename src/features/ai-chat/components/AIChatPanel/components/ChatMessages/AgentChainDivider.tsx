import React, { useCallback } from 'react';
import { ChevronDown } from 'lucide-react';

// ---------------------------------------------------------------------------
// AgentChainDivider — shows between segments of an agent chain when
// interrupted by user messages or other agents' turns.
// Displays: "── {icon} {name} continues below ──" with a scroll button.
// ---------------------------------------------------------------------------

interface AgentChainDividerProps {
  /** Agent display name */
  agentName: string;
  /** Agent icon emoji (optional) */
  agentIcon?: string;
  /** Agent color for the text accent */
  agentColor?: string;
  /** The agentChainId to scroll to — finds next turn with matching data attribute */
  nextTurnId?: string;
}

const FALLBACK_COLOR = 'rgb(168, 85, 247)'; // purple-500

export const AgentChainDivider: React.FC<AgentChainDividerProps> = ({
  agentName,
  agentIcon,
  agentColor,
  nextTurnId,
}) => {
  const color = agentColor || FALLBACK_COLOR;

  const handleScrollToNext = useCallback(() => {
    if (!nextTurnId) return;
    const nextEl = document.querySelector(
      `[data-agent-chain-continuation="${nextTurnId}"]`
    );
    if (nextEl) {
      nextEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [nextTurnId]);

  return (
    <div className="flex items-center gap-2 py-1 px-2 my-1 select-none">
      {/* Left line */}
      <div
        className="flex-1 h-px opacity-30"
        style={{ backgroundColor: color }}
      />

      {/* Center label */}
      <button
        onClick={handleScrollToNext}
        className="group/divider flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] whitespace-nowrap transition-colors hover:bg-[var(--bg-tertiary)]"
        style={{ color }}
        title={`Scroll to ${agentName}'s next message`}
      >
        <span>{agentIcon || '\uD83E\uDD16'}</span>
        <span className="font-medium">{agentName}</span>
        <span className="text-[var(--text-tertiary)]">continues below</span>
        <ChevronDown
          className="w-3 h-3 opacity-0 group-hover/divider:opacity-100 transition-opacity"
          style={{ color }}
        />
      </button>

      {/* Right line */}
      <div
        className="flex-1 h-px opacity-30"
        style={{ backgroundColor: color }}
      />
    </div>
  );
};
