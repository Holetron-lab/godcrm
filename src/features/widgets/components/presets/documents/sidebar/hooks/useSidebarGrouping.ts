import { useMemo } from 'react';
import type { DocumentRegistryItem } from '../../../../../types/documents.types';

const CATEGORY_ORDER = ['API', 'Frontend', 'Backend', 'DevOps', 'Guide', 'Other'];

export interface GroupedDocs {
  category: string;
  docs: DocumentRegistryItem[];
}

export function useSidebarGrouping(filteredDocuments: DocumentRegistryItem[]): GroupedDocs[] {
  return useMemo(() => {
    const grouped = new Map<string, DocumentRegistryItem[]>();
    for (const doc of filteredDocuments) {
      const cat = doc.category || 'Other';
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(doc);
    }
    const sortedKeys = [...grouped.keys()].sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a);
      const bi = CATEGORY_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    return sortedKeys.map(category => ({ category, docs: grouped.get(category)! }));
  }, [filteredDocuments]);
}
