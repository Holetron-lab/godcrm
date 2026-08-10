import React from 'react';

// ---------------------------------------------------------------------------
// AgentChainConnector — thin vertical line on the left side of agent bubbles
// that visually connects all turns belonging to the same agentChainId.
// ---------------------------------------------------------------------------

interface AgentChainConnectorProps {
  /** CSS color for the connector line (hex, rgb, or CSS variable) */
  color?: string;
  /** Whether the chain continues below (renders dashed bottom segment) */
  hasMoreSegments?: boolean;
  /** Whether this is a continuation from a previous segment */
  isContinuation?: boolean;
}

const FALLBACK_COLOR = 'rgb(168, 85, 247)'; // purple-500

export const AgentChainConnector: React.FC<AgentChainConnectorProps> = ({
  color,
  hasMoreSegments = false,
  isContinuation = false,
}) => {
  const lineColor = color || FALLBACK_COLOR;

  return (
    <div
      className="absolute left-0 top-0 bottom-0 flex flex-col items-center"
      style={{ width: '12px' }}
      aria-hidden="true"
    >
      {/* Top dot — only for the start of a chain (not a continuation) */}
      {!isContinuation && (
        <div
          className="flex-shrink-0 rounded-full"
          style={{
            width: '6px',
            height: '6px',
            backgroundColor: lineColor,
            marginTop: '14px',
          }}
        />
      )}

      {/* Vertical line — solid for current segment */}
      <div
        className="flex-1"
        style={{
          width: '2px',
          backgroundColor: lineColor,
          opacity: 0.6,
          borderStyle: hasMoreSegments ? undefined : undefined,
          marginTop: isContinuation ? '0px' : '2px',
          marginBottom: hasMoreSegments ? '2px' : '0px',
        }}
      />

      {/* Bottom dot — only when chain ends here (no more segments) */}
      {!hasMoreSegments && (
        <div
          className="flex-shrink-0 rounded-full"
          style={{
            width: '6px',
            height: '6px',
            backgroundColor: lineColor,
            marginBottom: '14px',
          }}
        />
      )}

      {/* Dashed extension when chain continues below */}
      {hasMoreSegments && (
        <div
          className="flex-shrink-0"
          style={{
            width: '2px',
            height: '12px',
            backgroundImage: `repeating-linear-gradient(to bottom, ${lineColor} 0px, ${lineColor} 3px, transparent 3px, transparent 6px)`,
            opacity: 0.4,
          }}
        />
      )}
    </div>
  );
};
