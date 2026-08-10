import { FileText } from 'lucide-react';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import { useDocumentsContext } from '../../DocumentsContext';
import { useDocumentUpdate } from '../hooks/useDocumentUpdate';
import type { DocumentItem } from '../../../../../types/documents.types';

interface ContentPreviewSectionProps {
  item: DocumentItem;
  tableId: number | undefined;
}

export function ContentPreviewSection({ item, tableId }: ContentPreviewSectionProps) {
  const ctx = useDocumentsContext();
  const updateItem = useDocumentUpdate(item.id, tableId);

  if (!(item.level === 'text' || item.level === 'h2' || item.level === 'h3') || !item.content) {
    return null;
  }

  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-[var(--text-secondary)] flex items-center gap-1.5">
        <FileText className="w-3.5 h-3.5" /> Содержимое
      </label>
      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)] overflow-hidden max-h-[120px]">
        <div className="overflow-y-auto max-h-[200px] origin-top-left" style={{ transform: 'scale(0.6)', width: '166.66%' }}>
          <MarkdownPreview
            content={item.content}
            onContentChange={!ctx.isReadOnly && tableId && ctx.selectedDocumentId ? async (newContent) => {
              await updateItem({ [`content_${ctx.currentLanguage}`]: newContent });
            } : undefined}
          />
        </div>
      </div>
    </div>
  );
}
