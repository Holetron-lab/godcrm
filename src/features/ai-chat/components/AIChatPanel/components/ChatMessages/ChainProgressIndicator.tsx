import React from 'react';
import { cn } from '@/shared/utils/cn';

// ---------------------------------------------------------------------------
// ChainProgressIndicator — compact dot progress bar for agent chain turns
//
// Shows numbered dot indicators like: [●] [●] [◉] [○] [○]  Step 3 of 5
// Used in ChatTurn headers to visualize multi-agent chain progress.
// ADR-077 Task #9: Chain progress visualization in conversation.
// ---------------------------------------------------------------------------

export interface ChainProgressIndicatorProps {
  /** 1-based index of the current step (e.g. 2 = "Step 2") */
  stepIndex: number;
  /** Total number of steps in the chain */
  totalSteps: number;
  /** Agent color used for active/done dots (hex or CSS color) */
  agentColor?: string;
  /** Additional CSS class */
  className?: string;
}

const FALLBACK_COLOR = 'rgb(168, 85, 247)'; // purple-500

/**
 * Renders a compact dot-based chain progress indicator.
 * - Dots before stepIndex = completed (filled, full opacity)
 * - Dot at stepIndex = active (ring + filled center, larger)
 * - Dots after stepIndex = pending (empty circle, low opacity)
 */
export const ChainProgressIndicator: React.FC<ChainProgressIndicatorProps> = ({
  stepIndex,
  totalSteps,
  agentColor,
  className,
}) => {
  if (totalSteps < 2) return null;

  const color = agentColor || FALLBACK_COLOR;

  return (
    <div
      className={cn('flex items-center gap-1', className)}
      aria-label={`Step ${stepIndex} of ${totalSteps}`}
      role="status"
      data-testid="chain-progress-indicator"
    >
      {/* Dot track */}
      <div className="flex items-center gap-0.5" aria-hidden="true">
        {Array.from({ length: totalSteps }, (_, i) => {
          const dotNumber = i + 1;
          const isCompleted = dotNumber < stepIndex;
          const isActive = dotNumber === stepIndex;

          if (isActive) {
            // Active: outer ring with filled center
            return (
              <span
                key={dotNumber}
                data-testid={`chain-dot-active-${dotNumber}`}
                className="relative flex items-center justify-center"
                style={{ width: '10px', height: '10px' }}
              >
                {/* Outer ring */}
                <span
                  className="absolute inset-0 rounded-full"
                  style={{
                    border: `1.5px solid ${color}`,
                    opacity: 1,
                  }}
                />
                {/* Inner filled dot */}
                <span
                  className="rounded-full"
                  style={{
                    width: '5px',
                    height: '5px',
                    backgroundColor: color,
                  }}
                />
              </span>
            );
          }

          if (isCompleted) {
            // Completed: fully filled dot
            return (
              <span
                key={dotNumber}
                data-testid={`chain-dot-completed-${dotNumber}`}
                className="rounded-full"
                style={{
                  width: '6px',
                  height: '6px',
                  backgroundColor: color,
                  opacity: 0.85,
                  display: 'block',
                }}
              />
            );
          }

          // isPending: empty circle
          return (
            <span
              key={dotNumber}
              data-testid={`chain-dot-pending-${dotNumber}`}
              className="rounded-full"
              style={{
                width: '6px',
                height: '6px',
                border: `1.5px solid ${color}`,
                opacity: 0.35,
                display: 'block',
              }}
            />
          );
        })}
      </div>

      {/* Step label */}
      <span
        className="text-[10px] tabular-nums whitespace-nowrap"
        style={{ color, opacity: 0.8 }}
        data-testid="chain-step-label"
      >
        {stepIndex}/{totalSteps}
      </span>
    </div>
  );
};
