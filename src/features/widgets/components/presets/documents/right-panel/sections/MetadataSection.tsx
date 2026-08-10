import { MessageSquare } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useDocumentsContext } from '../../DocumentsContext';
import { LEVEL_LABELS, LEVEL_ICONS, type DocumentLevel } from '../../../../../types/documents.types';
import { useDocumentUpdate } from '../hooks/useDocumentUpdate';
import type { DocumentItem } from '../../../../../types/documents.types';

interface MetadataSectionProps {
  item: DocumentItem;
  tableId: number | undefined;
}

export function MetadataSection({ item, tableId }: MetadataSectionProps) {
  const ctx = useDocumentsContext();
  const updateItem = useDocumentUpdate(item.id, tableId);

  return (
    <>
      {/* Element Type Selector */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-[var(--text-secondary)]">Тип элемента</label>
        <div className="flex items-center gap-2">
          <select
            value={item.level}
            disabled={ctx.isReadOnly}
            onChange={async (e) => {
              if (ctx.isReadOnly) return;
              await updateItem({ level: e.target.value as DocumentLevel });
            }}
            className={cn(
              "flex-1 px-3 py-1.5 rounded text-sm font-medium border bg-[var(--bg-tertiary)] text-[var(--text-primary)] border-[var(--border-primary)]",
              ctx.isReadOnly ? "cursor-default opacity-60" : "cursor-pointer"
            )}
          >
            {(Object.keys(LEVEL_LABELS) as DocumentLevel[])
              .filter(level => level !== 'h1')
              .map(level => (
                <option key={level} value={level}>
                  {LEVEL_ICONS[level]} {LEVEL_LABELS[level]}
                </option>
              ))
            }
          </select>
          <span className="text-xs text-[var(--text-tertiary)]">
            id: {item.id}
          </span>
        </div>
      </div>

      {/* Comment */}
      <div>
        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5 flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5" /> Комментарий
        </label>
        <textarea
          value={item.comment || ''}
          placeholder="Не отображается в документе..."
          rows={3}
          readOnly={ctx.isReadOnly}
          onChange={async (e) => {
            if (ctx.isReadOnly) return;
            await updateItem({ comment: e.target.value || null });
          }}
          className={cn(
            "w-full px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm resize-none",
            ctx.isReadOnly && "opacity-60 cursor-default"
          )}
        />
      </div>
    </>
  );
}
