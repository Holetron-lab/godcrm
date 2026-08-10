import { useState, useEffect, useRef, useCallback } from 'react';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';

/**
 * Encapsulates all agent processing state: isAgentProcessing, processingAgentName,
 * processingStartedAt, safety timeout, dismiss, reset, and stop.
 */
export function useProcessingState(currentConversationIdRef: React.MutableRefObject<number | null>) {
  const [isAgentProcessing, setIsAgentProcessing] = useState(false);
  const [processingAgentName, setProcessingAgentName] = useState<string | null>(null);
  const [processingStartedAt, setProcessingStartedAt] = useState<number | null>(null);
  const processingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ticket #36708 + BUG-504: Safety timeout — auto-clear isAgentProcessing after 35 minutes
  // Claude CLI timeout is 30 min; we give 5 min extra buffer before declaring it stuck.
  // Previous value (60s) was killing agent runs prematurely — agents need 5-30 min for complex tasks.
  const PROCESSING_SAFETY_TIMEOUT_MS = 35 * 60 * 1000; // 35 minutes
  useEffect(() => {
    if (isAgentProcessing) {
      if (!processingStartedAt) {
        setProcessingStartedAt(Date.now());
      }
      processingTimerRef.current = setTimeout(() => {
        logger.warn(`[AI Chat] Agent processing timeout (${PROCESSING_SAFETY_TIMEOUT_MS / 60000}min) — auto-clearing stuck state`);
        setIsAgentProcessing(false);
        setProcessingAgentName(null);
        setProcessingStartedAt(null);
        // Also clear on backend so reloading doesn't re-show the spinner
        const convId = currentConversationIdRef.current;
        if (convId) {
          apiClient.post(`/chat/conversations/${convId}/reset-processing`).catch(() => {});
        }
      }, PROCESSING_SAFETY_TIMEOUT_MS);
    } else {
      setProcessingStartedAt(null);
      setProcessingAgentName(null);
      if (processingTimerRef.current) {
        clearTimeout(processingTimerRef.current);
        processingTimerRef.current = null;
      }
    }
    return () => {
      if (processingTimerRef.current) {
        clearTimeout(processingTimerRef.current);
      }
    };
  }, [isAgentProcessing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ticket #36708: Manual dismiss for isAgentProcessing (user can click to dismiss stuck state)
  // Also clears backend DB flag so the spinner doesn't reappear on conversation reload
  const dismissProcessing = useCallback(() => {
    logger.info('[AI Chat] User dismissed processing state');
    setIsAgentProcessing(false);
    setProcessingAgentName(null);
    setProcessingStartedAt(null);
    const convId = currentConversationIdRef.current;
    if (convId) {
      apiClient.post(`/chat/conversations/${convId}/reset-processing`).catch((err) => {
        logger.warn('[AI Chat] Failed to clear processing on backend during dismiss:', err);
      });
    }
  }, [currentConversationIdRef]);

  // Ticket #36708: Force-clear stuck processing state — calls backend endpoint to reset DB flag too
  const resetProcessing = useCallback(async () => {
    const convId = currentConversationIdRef.current;
    logger.info('[AI Chat] User force-resetting processing state', { conversationId: convId });
    setIsAgentProcessing(false);
    setProcessingAgentName(null);
    setProcessingStartedAt(null);
    if (convId) {
      try {
        await apiClient.post(`/chat/conversations/${convId}/reset-processing`);
      } catch (err) {
        logger.warn('[AI Chat] Failed to reset processing on backend:', err);
      }
    }
  }, [currentConversationIdRef]);

  // Stop agent — calls POST /chat/conversations/:id/stop which kills the worker process
  const stopAgent = useCallback(async () => {
    const convId = currentConversationIdRef.current;
    logger.info('[AI Chat] User stopping agent', { conversationId: convId });
    if (convId) {
      try {
        await apiClient.post(`/chat/conversations/${convId}/stop`);
      } catch (err) {
        logger.warn('[AI Chat] Failed to stop agent:', err);
      }
    }
    setIsAgentProcessing(false);
    setProcessingAgentName(null);
    setProcessingStartedAt(null);
  }, [currentConversationIdRef]);

  return {
    isAgentProcessing,
    setIsAgentProcessing,
    processingAgentName,
    setProcessingAgentName,
    processingStartedAt,
    setProcessingStartedAt,
    dismissProcessing,
    resetProcessing,
    stopAgent,
  };
}
