import { useState } from 'react';
import { Plus, Loader2, Upload, Filter, ChevronDown } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useDocumentsContext } from '../DocumentsContext';
import { type DocumentLevel, LEVEL_LABELS, LEVEL_ICONS } from '../../../../types/documents.types';
import { InsertTicketAtomModal } from '../atoms/TicketRefAtom/InsertTicketAtomModal';

export function ToolbarCreateMenu() {
  const ctx = useDocumentsContext();
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [showTicketAtomModal, setShowTicketAtomModal] = useState(false);

  const handleCreateDocument = () => {
    if (ctx.isReadOnly) return; // ADR-0060 P6/P fail-closed guard
    ctx.setShowCreateDocumentModal(true);
  };

  const handleAddElement = async (level: DocumentLevel) => {
    if (ctx.isReadOnly) return; // ADR-0060 P6/P fail-closed guard
    if (!ctx.selectedDocumentId || !ctx.selectedDocument?.content_table_id) return;

    // For atom, open modal with empty item
    if (level === 'atom') {
      ctx.setConvertToAtomItem({
        id: 0, // Will be assigned on save
        order: ctx.getNextOrder(),
        level: 'atom',
        content: '',
        content_en: '',
        content_ru: '',
        atom_ref: '',
        atom_title: '',
      } as any);
      ctx.setShowConvertToAtomModal(true);
      setAddMenuOpen(false);
      return;
    }

    // ADR-0012 Phase 5 / M4: ticket-as-atom — open the slash-command picker.
    if (level === 'ticket') {
      setShowTicketAtomModal(true);
      setAddMenuOpen(false);
      return;
    }

    // ADR-0005 §C-5 / Phase 5: widget — defer creation to the existing widget
    // picker (DocumentsContent listens for `widgetPickerTarget` and runs the
    // canonical insert flow on selection, including order resolution & atom
    // row creation with `level='widget', widget_ref=<id>`).
    // No anchor → picker falls through to `{ kind: 'end' }` (append).
    if (level === 'widget') {
      ctx.setWidgetPickerTarget({ mode: 'create' });
      setAddMenuOpen(false);
      return;
    }

    const order = ctx.getNextOrder();
    const isDividerLike = level === 'divider' || level === 'page_break';
    const contentField = `content_${ctx.currentLanguage}` as const;

    await ctx.addItem({
      documentId: ctx.selectedDocumentId,
      tableId: ctx.selectedDocument.content_table_id,
      item: {
        order,
        level,
        ...(isDividerLike ? {} : { [contentField]: '' }),
        image_max_height: level === 'image' ? 300 : undefined,
      },
    });
    setAddMenuOpen(false);
  };

  return (
    <>
      {/* ADR-105: Read-only badge */}
      {ctx.isReadOnly && (
        <span className="px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full font-medium">Read-only</span>
      )}

      {!ctx.isReadOnly && (
        <button
          onClick={handleCreateDocument}
          disabled={ctx.isCreating}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--color-primary-500)] text-white text-sm font-medium hover:bg-[var(--color-primary-600)]",
            ctx.isMobile && "px-2 py-1 min-h-[44px]"
          )}
        >
          {ctx.isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        </button>
      )}

      {!ctx.isReadOnly && !ctx.isMobile && (
        <button
          onClick={() => ctx.setShowFileUploadModal(true)}
          title="Импорт MD"
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] text-sm border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]"
        >
          <Upload className="w-4 h-4" />
        </button>
      )}

      {/* Status filter - only in documents grid view, hidden on mobile */}
      {!ctx.selectedDocument && !ctx.isMobile && (
        <div className="flex items-center gap-1.5">
          <Filter className="w-4 h-4 text-[var(--text-tertiary)]" />
          <select
            value={ctx.statusFilter}
            onChange={(e) => ctx.setStatusFilter(e.target.value)}
            className={cn(
              "px-2 py-1.5 rounded-lg text-sm border border-[var(--border-primary)] bg-[var(--bg-tertiary)]",
              ctx.statusFilter !== 'all' && "border-blue-500/50 bg-blue-500/10 text-blue-400"
            )}
          >
            <option value="all">All statuses</option>
            {ctx.statusOptions.map(option => (
              <option key={option.id} value={option.slug}>
                {option.icon ? `${option.icon} ` : ''}{option.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Divider between Import and Add - hidden on mobile */}
      {!ctx.isReadOnly && ctx.selectedDocument && !ctx.isMobile && (
        <div className="w-px h-6 bg-[var(--border-primary)]" />
      )}

      {/* Add element dropdown - only with selected document, hidden in read-only, hidden on mobile */}
      {!ctx.isReadOnly && ctx.selectedDocument && !ctx.isMobile && (
        <div
          className="relative"
          onMouseEnter={() => setAddMenuOpen(true)}
          onMouseLeave={() => setAddMenuOpen(false)}
        >
          <button
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] text-sm border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]"
          >
            <Plus className="w-4 h-4" />
            Добавить
            <ChevronDown className="w-3 h-3" />
          </button>

          {/* Dropdown menu */}
          {addMenuOpen && (
            <div className="absolute top-full left-0 pt-1 z-50">
              <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-lg py-1 min-w-[180px]" data-testid="documents-add-menu">
                {(['h2', 'h3', 'text', 'atom', 'ticket', 'image', 'widget', 'divider', 'page_break'] as DocumentLevel[]).map(level => {
                  const badgeClass = {
                    h1: 'bg-purple-500/20 text-purple-400',
                    h2: 'bg-blue-500/20 text-blue-400',
                    h3: 'bg-green-500/20 text-green-400',
                    text: 'bg-gray-500/20 text-gray-400',
                    atom: 'bg-purple-500/20 text-purple-400',
                    ticket: 'bg-blue-500/20 text-blue-400',
                    image: 'bg-pink-500/20 text-pink-400',
                    widget: 'bg-indigo-500/20 text-indigo-400',
                    divider: 'bg-gray-500/20 text-gray-400',
                    page_break: 'bg-orange-500/20 text-orange-400',
                  }[level] || 'bg-gray-500/20 text-gray-400';

                  return (
                    <button
                      key={level}
                      onClick={() => handleAddElement(level)}
                      data-testid={`documents-add-menu-item-${level}`}
                      className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-left hover:bg-[var(--bg-secondary)] transition-colors"
                    >
                      <span>{LEVEL_LABELS[level]}</span>
                      <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-mono uppercase", badgeClass)}>
                        {LEVEL_ICONS[level]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ADR-0012 Phase 5 / M4: ticket-as-atom slash-command picker.
          Display mode defaults to 'live' (snapshots are still available
          per-atom inside the modal). */}
      <InsertTicketAtomModal
        isOpen={showTicketAtomModal}
        onClose={() => setShowTicketAtomModal(false)}
        defaultMode="live"
      />
    </>
  );
}
