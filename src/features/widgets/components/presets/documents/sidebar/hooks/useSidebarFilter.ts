import { useMemo } from 'react';
import { useDocumentsContext } from '../../DocumentsContext';
import type { DocumentRegistryItem } from '../../../../../types/documents.types';

export function useSidebarFilter(): DocumentRegistryItem[] {
  const ctx = useDocumentsContext();
  return useMemo(() => {
    let docs = ctx.documents;

    if (ctx.statusFilter && ctx.statusFilter !== 'all') {
      docs = docs.filter(doc => {
        const slug = ctx.resolveStatus(doc)?.slug ?? doc.status;
        return slug === ctx.statusFilter;
      });
    }

    if (ctx.searchQuery.trim()) {
      const q = ctx.searchQuery.toLowerCase();
      docs = docs.filter(doc =>
        doc.name.toLowerCase().includes(q) ||
        doc.description?.toLowerCase().includes(q) ||
        doc.category?.toLowerCase().includes(q)
      );
    }

    return docs;
  }, [ctx.documents, ctx.searchQuery, ctx.statusFilter, ctx.resolveStatus]);
}
