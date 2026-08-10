/**
 * useProcessingTimer Hook
 * Extracted from AIChatPanel.tsx — lines 370–383
 *
 * Tracks elapsed seconds while an AI agent is processing a request.
 * Shows warnings in the UI when processing takes too long ("stuck" detection).
 *
 * Ticket #36708: Track elapsed processing time for stuck state detection.
 *
 * Lifecycle:
 *   - When `isAgentProcessing` is true and `processingStartedAt` is set,
 *     a 1-second interval updates `processingElapsed`.
 *   - When processing ends (either flag clears), resets elapsed to 0.
 *
 * @param isAgentProcessing  Whether the agent is currently processing
 * @param processingStartedAt  Timestamp (ms) when processing began, or null
 * @param setProcessingElapsed  State setter from useChatState
 */

import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';

interface UseProcessingTimerParams {
  /** Whether the agent is currently processing a request */
  isAgentProcessing: boolean;
  /** Epoch timestamp (ms) when processing started, or null/undefined */
  processingStartedAt: number | null | undefined;
  /** Setter to update the elapsed seconds counter in ChatState */
  setProcessingElapsed: Dispatch<SetStateAction<number>>;
}

/**
 * Stuck-agent detection timer.
 *
 * Updates `processingElapsed` every second so the UI can show
 * "Processing for Xs..." warnings and offer a cancel/retry button.
 */
export function useProcessingTimer({
  isAgentProcessing,
  processingStartedAt,
  setProcessingElapsed,
}: UseProcessingTimerParams): void {
  useEffect(() => {
    if (!isAgentProcessing || !processingStartedAt) {
      setProcessingElapsed(0);
      return;
    }

    // Immediately set the current elapsed value
    setProcessingElapsed(Math.floor((Date.now() - processingStartedAt) / 1000));

    // Then update every second
    const timer = setInterval(() => {
      setProcessingElapsed(Math.floor((Date.now() - processingStartedAt) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [isAgentProcessing, processingStartedAt, setProcessingElapsed]);
}
