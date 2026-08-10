/**
 * Documents Right Panel — routes to the correct sub-panel for the current mode:
 *   - atoms list (rightPanelMode='atoms')
 *   - import mode (isCreatingMode)
 *   - normal mode (element settings)
 *
 * Works in both normal mode (editing saved items) and import mode (editing import sections).
 */

import { X, Settings, Trash2, Atom, Check, ArrowLeft } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useDocumentsContext } from '../DocumentsContext';
import { AtomPicker } from '../AtomPicker';
import { LEVEL_ICONS } from '../../../../types/documents.types';
import { AtomsListPanel } from './AtomsListPanel';
import { ImportModePanel } from './ImportModePanel';
import { WidgetSettingsSection } from './WidgetSettingsSection';
import { ImagePreviewSection } from './sections/ImagePreviewSection';
import { ContentPreviewSection } from './sections/ContentPreviewSection';
import { MetadataSection } from './sections/MetadataSection';
import { AtomPreviewSection } from './sections/AtomPreviewSection';
import { useDocumentDelete } from './hooks/useDocumentDelete';
import { usePanelEdit } from './hooks/usePanelEdit';
import { getLevelBadgeClass } from './constants';

export function DocumentsRightPanel() {
  const ctx = useDocumentsContext();
  const panelEdit = usePanelEdit();

  // === ATOMS PANEL MODE ===
  if (ctx.rightPanelMode === 'atoms' && ctx.rightPanelOpen) {
    return <AtomsListPanel />;
  }

  // === IMPORT MODE ===
  if (ctx.isCreatingMode) {
    return <ImportModePanel />;
  }

  // === NORMAL MODE ===
  if (!ctx.rightPanelOpen || !ctx.selectedItemId) {
    return null;
  }

  const item = ctx.items.find(i => i.id === ctx.selectedItemId);
  if (!item) {
    return null;
  }

  const tableId = ctx.selectedDocument?.content_table_id;

  return <NormalModePanel item={item} tableId={tableId} panelEdit={panelEdit} />;
}

function NormalModePanel({
  item,
  tableId,
  panelEdit,
}: {
  item: ReturnType<typeof useDocumentsContext>['items'][number];
  tableId: number | undefined;
  panelEdit: ReturnType<typeof usePanelEdit>;
}) {
  const ctx = useDocumentsContext();
  const handleDelete = useDocumentDelete(item.id, tableId);

  return (
    <div className="absolute right-0 top-0 bottom-0 z-20 w-[320px] flex flex-col border-l border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-[var(--text-tertiary)]" />
          <span className="font-medium text-sm">Настройки элемента</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn(
            "px-1.5 py-0.5 rounded text-[10px] font-mono uppercase",
            getLevelBadgeClass(item.level)
          )}>
            {LEVEL_ICONS[item.level]}
          </span>
          {item.level === 'text' && item.atom_ref && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/20 text-purple-400 flex items-center gap-1">
              <Atom className="w-3 h-3" />
            </span>
          )}
          <button
            onClick={() => {
              ctx.setSelectedItemId(null);
              ctx.setRightPanelMode('atoms');
            }}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)]"
            title="Назад к атомам"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => ctx.setRightPanelOpen(false)}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <ContentPreviewSection item={item} tableId={tableId} />
        <MetadataSection item={item} tableId={tableId} />

        {item.level === 'image' && tableId && (
          <ImagePreviewSection item={item} tableId={tableId} />
        )}

        {item.level === 'widget' && tableId && (
          <WidgetSettingsSection item={item} tableId={tableId} />
        )}

        <AtomPreviewSection
          item={item}
          tableId={tableId}
          onOpenAtomPicker={panelEdit.openPicker}
        />
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        {ctx.isReadOnly ? (
          <button
            onClick={() => ctx.setRightPanelOpen(false)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[var(--text-secondary)] bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] text-sm border border-[var(--border-primary)]"
          >
            <X className="w-4 h-4" /> Закрыть
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => ctx.setRightPanelOpen(false)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-white bg-[var(--color-primary-500)] hover:bg-[var(--color-primary-600)] text-sm"
            >
              <Check className="w-4 h-4" /> Сохранить
            </button>
            <button
              onClick={handleDelete}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-red-400 hover:bg-red-500/10 border border-red-500/30 text-sm"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Atom Picker Modal */}
      <AtomPicker
        isOpen={panelEdit.showAtomPicker}
        onClose={panelEdit.closePicker}
        onSelect={async (atomId, atom) => {
          if (!panelEdit.atomPickerTargetItemId || !ctx.selectedDocumentId || !ctx.selectedDocument?.content_table_id) return;

          await ctx.updateItem({
            documentId: ctx.selectedDocumentId,
            itemId: panelEdit.atomPickerTargetItemId,
            tableId: ctx.selectedDocument.content_table_id,
            data: {
              level: 'atom',
              atom_ref: atomId,
              atom_title: atom.title || null,
              content_en: null,
              content_ru: null,
            },
          });

          panelEdit.closePicker();
        }}
      />
    </div>
  );
}
