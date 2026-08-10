import { useCallback } from 'react';
import { useDocumentsContext } from '../../DocumentsContext';

export function useDocumentDelete(itemId: number | undefined, tableId: number | undefined) {
  const ctx = useDocumentsContext();
  return useCallback(async () => {
    if (!tableId || !ctx.selectedDocumentId || itemId == null) return;
    if (!confirm('Удалить этот элемент?')) return;
    await ctx.deleteItem({
      documentId: ctx.selectedDocumentId,
      itemId,
      tableId,
    });
    ctx.setRightPanelOpen(false);
  }, [ctx, itemId, tableId]);
}
