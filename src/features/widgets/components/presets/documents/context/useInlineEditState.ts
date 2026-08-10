import { useState } from 'react';
import type { DocumentItem } from '../../../../types/documents.types';

export function useInlineEditState() {
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingData, setEditingData] = useState<Partial<DocumentItem>>({});
  const [copied, setCopied] = useState(false);

  return {
    editingItemId,
    setEditingItemId,
    editingData,
    setEditingData,
    copied,
    setCopied,
  };
}
