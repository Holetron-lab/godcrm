import { useCallback } from 'react';
import { useDocumentsContext } from '../../DocumentsContext';
import type { DocumentItem } from '../../../../../types/documents.types';

export function useDocumentUpdate(itemId: number | undefined, tableId: number | undefined) {
  const ctx = useDocumentsContext();
  return useCallback(
    async (data: Partial<DocumentItem>) => {
      if (!tableId || !ctx.selectedDocumentId || itemId == null) return;
      await ctx.updateItem({
        documentId: ctx.selectedDocumentId,
        itemId,
        tableId,
        data,
      });
    },
    [ctx, itemId, tableId],
  );
}
