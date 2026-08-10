/**
 * useDocumentChat — shared hook for opening document chat in the global AI Chat Panel
 * Fixes bug #56296: chat was opening inside the documents module instead of the global panel
 */

import { useCallback } from 'react';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import { useAIChat } from '@/features/ai-chat';
import { useDocumentsContext } from './DocumentsContext';

export function useDocumentChat() {
  const ctx = useDocumentsContext();
  const { openTaskChat, openChat } = useAIChat();

  const openDocumentChat = useCallback(async (docId: number, docName: string) => {
    try {
      const response = await apiClient.get<{ data: { conversationId: number; id: number } }>(
        `/chat/tasks/${ctx.registryTableId}/${docId}?create=true`
      );
      const convId = response.data?.conversationId || response.data?.id;
      if (convId && ctx.registryTableId) {
        openTaskChat({
          conversationId: convId,
          tableId: ctx.registryTableId,
          rowId: docId,
          rowTitle: docName || `Document #${docId}`,
        });
      } else {
        openChat();
      }
    } catch (error) {
      logger.error('Failed to open document chat:', error);
      openChat();
    }
  }, [ctx.registryTableId, openTaskChat, openChat]);

  return { openDocumentChat };
}
