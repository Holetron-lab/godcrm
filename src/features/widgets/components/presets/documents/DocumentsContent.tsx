/**
 * Documents Content - Main content area with document view
 * Refactored: sub-components extracted to ./content/ (ADR-046)
 */

import { logger } from '@/shared/utils/logger';
import { useSystemVariables } from '@/shared/hooks/useSystemVariables';

import { useMemo, useState, useRef, useCallback } from 'react';
import { Loader2, PanelLeft } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useDocumentsContext } from './DocumentsContext';
import { type DocumentLevel, type DocumentItem } from '../../../types/documents.types';

// Extracted sub-components (ADR-046)
import { AtomsListView } from './content/AtomsListView';
import { TicketsListView } from './content/TicketsListView';
import { DocumentPages } from './content/DocumentPages';
import { DocumentStructure } from './content/DocumentStructure';
import { DocumentsGrid } from './content/DocumentsGrid';
import { DocumentItemRenderer } from './content/DocumentItemRenderer';
import { AddWidgetModal } from '../../AddWidgetModal';
import type { Widget } from '../../../types/widget.types';
import { resolveOrderForInsert, type InsertPosition } from './utils/orderUtils';

export function DocumentsContent() {
  const ctx = useDocumentsContext();
  const [openMenu, setOpenMenu] = useState<{ id: number; position: { top: number; left: number } } | null>(null);

  // === MOBILE SWIPE SUPPORT ===
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const SWIPE_THRESHOLD = 80;
  const SWIPE_TIME_LIMIT = 300;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!ctx.isMobile || !ctx.selectedDocument) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }, [ctx.isMobile, ctx.selectedDocument]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!ctx.isMobile || !ctx.selectedDocument || !touchStartRef.current) return;
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    const elapsed = Date.now() - touchStartRef.current.time;
    touchStartRef.current = null;

    // Only trigger horizontal swipe if horizontal movement > vertical and meets threshold
    if (elapsed > SWIPE_TIME_LIMIT || Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaY) > Math.abs(deltaX)) {
      return;
    }

    const currentIndex = ctx.documents.findIndex(d => d.id === ctx.selectedDocumentId);
    if (deltaX > 0 && currentIndex > 0) {
      // Swipe right = previous doc
      ctx.setSelectedDocumentId(ctx.documents[currentIndex - 1].id);
    } else if (deltaX < 0 && currentIndex < ctx.documents.length - 1) {
      // Swipe left = next doc
      ctx.setSelectedDocumentId(ctx.documents[currentIndex + 1].id);
    }
  }, [ctx.isMobile, ctx.selectedDocument, ctx.selectedDocumentId, ctx.documents, ctx.setSelectedDocumentId]);

  // Build system variables for MarkdownPreview (includes space variables)
  const variables = useSystemVariables({
    widgetId: ctx.widget?.id,
    projectId: ctx.widget?.dashboard_id,
    spaceId: ctx.spaceId,
    includeSpaceVars: true,
  });

  // Helper to open menu with position from button click
  const openMenuAt = (itemId: number, buttonElement: HTMLElement) => {
    const rect = buttonElement.getBoundingClientRect();
    setOpenMenu({
      id: itemId,
      position: {
        top: rect.bottom + 4,
        left: rect.right - 180, // Menu width ~180px, align right edge
      }
    });
  };

  const closeMenu = () => setOpenMenu(null);

  // Filter items by search
  const filteredItems = useMemo(() => {
    if (!ctx.contentSearchQuery.trim()) return ctx.items;
    const q = ctx.contentSearchQuery.toLowerCase();
    return ctx.items.filter(item =>
      item.title?.toLowerCase().includes(q) ||
      item.content?.toLowerCase().includes(q)
    );
  }, [ctx.items, ctx.contentSearchQuery]);

  // === HANDLERS ===

  const startEditing = (item: DocumentItem) => {
    // ADR-105: Block editing in read-only mode
    if (ctx.isReadOnly) return;
    ctx.setEditingItemId(item.id);
    ctx.setEditingData({ ...item });
  };

  const cancelEditing = () => {
    ctx.setEditingItemId(null);
    ctx.setEditingData({});
  };

  const saveEditing = async () => {
    logger.debug('[DocumentsContent] saveEditing called', {
      editingItemId: ctx.editingItemId,
      selectedDocumentId: ctx.selectedDocumentId,
      hasTableId: !!ctx.selectedDocument?.content_table_id
    });
    if (!ctx.editingItemId || !ctx.selectedDocumentId || !ctx.selectedDocument?.content_table_id) {
      logger.debug('[DocumentsContent] saveEditing: missing required data, returning');
      return;
    }

    // Transform 'content' field to language-specific field (content_en, content_ru)
    const data = { ...ctx.editingData };
    if ('content' in data && data.content !== undefined) {
      const contentField = `content_${ctx.currentLanguage}`;
      data[contentField] = data.content;
      delete data.content;
    }

    logger.debug('[DocumentsContent] saveEditing: saving', {
      documentId: ctx.selectedDocumentId,
      itemId: ctx.editingItemId,
      tableId: ctx.selectedDocument.content_table_id,
      dataKeys: Object.keys(data)
    });

    await ctx.updateItem({
      documentId: ctx.selectedDocumentId,
      itemId: ctx.editingItemId,
      tableId: ctx.selectedDocument.content_table_id,
      data,
    });

    cancelEditing();
  };

  // Resolve a row order for inserts. Uses integer math with `ORDER_GAP=10`;
  // if the local gap is exhausted, renumbers the whole list first.
  const resolveInsertOrder = useCallback(
    async (position: InsertPosition): Promise<number | null> => {
      const tableId = ctx.selectedDocument?.content_table_id;
      const documentId = ctx.selectedDocumentId;
      if (!tableId || !documentId) return null;
      return resolveOrderForInsert(ctx.items, position, async (id, order) => {
        await ctx.updateItem({ documentId, itemId: id, tableId, data: { order } });
      });
    },
    [ctx]
  );

  const handleAddItem = async (level: DocumentLevel, afterItemId?: number) => {
    if (!ctx.selectedDocumentId || !ctx.selectedDocument?.content_table_id) return;

    // ADR-0003 widget-embed §Phase1: widget insertion goes through the picker.
    if (level === 'widget') {
      ctx.setWidgetPickerTarget({ mode: 'create', afterItemId });
      return;
    }

    const order = await resolveInsertOrder(
      afterItemId != null ? { kind: 'after', afterId: afterItemId } : { kind: 'end' }
    );
    if (order == null) return;

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
  };

  const handleDeleteItem = async (itemId: number) => {
    if (!ctx.selectedDocumentId || !ctx.selectedDocument?.content_table_id) return;
    if (!confirm('Удалить этот элемент?')) return;

    await ctx.deleteItem({
      documentId: ctx.selectedDocumentId,
      itemId,
      tableId: ctx.selectedDocument.content_table_id,
    });

    if (ctx.selectedItemId === itemId) {
      ctx.setSelectedItemId(null);
      ctx.setRightPanelOpen(false);
    }
  };

  const handleCopyItem = async (item: DocumentItem) => {
    if (!ctx.selectedDocumentId || !ctx.selectedDocument?.content_table_id) return;

    const order = await resolveInsertOrder({ kind: 'after', afterId: item.id });
    if (order == null) return;

    const contentField = `content_${ctx.currentLanguage}` as const;

    await ctx.addItem({
      documentId: ctx.selectedDocumentId,
      tableId: ctx.selectedDocument.content_table_id,
      item: {
        order,
        level: item.level,
        [contentField]: item.content,
        atom_ref: item.atom_ref,
      },
    });
    closeMenu();
  };

  const handleAddBefore = async (item: DocumentItem, level: DocumentLevel = 'text') => {
    if (!ctx.selectedDocumentId || !ctx.selectedDocument?.content_table_id) return;

    // ADR-0003 widget-embed §Phase1: widget insertion goes through the picker.
    if (level === 'widget') {
      ctx.setWidgetPickerTarget({ mode: 'create', beforeItemId: item.id });
      closeMenu();
      return;
    }

    const order = await resolveInsertOrder({ kind: 'before', beforeId: item.id });
    if (order == null) return;

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
    closeMenu();
  };

  const handleAddAfter = async (item: DocumentItem, level: DocumentLevel = 'text') => {
    await handleAddItem(level, item.id);
    closeMenu();
  };

  // Move item up (swap with previous item)
  const handleMoveUp = async (item: DocumentItem) => {
    if (!ctx.selectedDocumentId || !ctx.selectedDocument?.content_table_id) return;

    const items = ctx.items;
    const itemIndex = items.findIndex(i => i.id === item.id);
    if (itemIndex <= 0) return; // Already first

    const prevItem = items[itemIndex - 1];
    // Swap orders
    const tempOrder = item.order;

    await ctx.updateItem({
      documentId: ctx.selectedDocumentId,
      itemId: item.id,
      tableId: ctx.selectedDocument.content_table_id,
      data: { order: prevItem.order }
    });
    await ctx.updateItem({
      documentId: ctx.selectedDocumentId,
      itemId: prevItem.id,
      tableId: ctx.selectedDocument.content_table_id,
      data: { order: tempOrder }
    });
    closeMenu();
  };

  // Move item down (swap with next item)
  const handleMoveDown = async (item: DocumentItem) => {
    if (!ctx.selectedDocumentId || !ctx.selectedDocument?.content_table_id) return;

    const items = ctx.items;
    const itemIndex = items.findIndex(i => i.id === item.id);
    if (itemIndex >= items.length - 1) return; // Already last

    const nextItem = items[itemIndex + 1];
    // Swap orders
    const tempOrder = item.order;

    await ctx.updateItem({
      documentId: ctx.selectedDocumentId,
      itemId: item.id,
      tableId: ctx.selectedDocument.content_table_id,
      data: { order: nextItem.order }
    });
    await ctx.updateItem({
      documentId: ctx.selectedDocumentId,
      itemId: nextItem.id,
      tableId: ctx.selectedDocument.content_table_id,
      data: { order: tempOrder }
    });
    closeMenu();
  };

  // === WIDGET PICKER (ADR-0003 widget-embed §Phase1) ===

  const handleWidgetPicked = useCallback(
    async (widget?: Widget) => {
      const target = ctx.widgetPickerTarget;
      ctx.setWidgetPickerTarget(null);
      if (!widget || !ctx.selectedDocumentId || !ctx.selectedDocument?.content_table_id || !target) return;

      const tableId = ctx.selectedDocument.content_table_id;

      if (target.mode === 'replace') {
        await ctx.updateItem({
          documentId: ctx.selectedDocumentId,
          itemId: target.itemId,
          tableId,
          data: { widget_ref: widget.id },
        });
        return;
      }

      const position: InsertPosition =
        target.afterItemId != null
          ? { kind: 'after', afterId: target.afterItemId }
          : target.beforeItemId != null
            ? { kind: 'before', beforeId: target.beforeItemId }
            : { kind: 'end' };
      const order = await resolveInsertOrder(position);
      if (order == null) return;

      await ctx.addItem({
        documentId: ctx.selectedDocumentId,
        tableId,
        item: {
          order,
          level: 'widget',
          widget_ref: widget.id,
        },
      });
    },
    [ctx, resolveInsertOrder]
  );

  // === RENDER ITEM ===

  const renderItemContent = (item: DocumentItem, index: number) => (
    <DocumentItemRenderer
      key={item.id}
      item={item}
      index={index}
      itemsCount={ctx.items.length}
      openMenu={openMenu}
      openMenuAt={openMenuAt}
      closeMenu={closeMenu}
      onStartEditing={startEditing}
      onCancelEditing={cancelEditing}
      onSaveEditing={saveEditing}
      onAddBefore={handleAddBefore}
      onAddAfter={handleAddAfter}
      onDelete={handleDeleteItem}
      onCopy={handleCopyItem}
      onMoveUp={handleMoveUp}
      onMoveDown={handleMoveDown}
      variables={variables}
    />
  );


  // === LOADING STATE ===

  if (ctx.isLoadingContent) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--color-primary-500)]" />
      </div>
    );
  }

  // === MAIN RENDER ===

  return (
    <div
      ref={ctx.contentRef}
      className={cn(
        "flex-1 overflow-y-auto overflow-x-hidden relative",
        // Mobile: full-width, reduced padding, better text size
        ctx.isMobile && "px-0"
      )}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Sidebar toggle button when collapsed - hidden on mobile (uses hamburger in toolbar) */}
      {ctx.sidebarCollapsed && !ctx.isMobile && (
        <button
          onClick={() => ctx.setSidebarCollapsed(false)}
          className="absolute left-3 top-3 z-30 p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] shadow-lg hover:bg-[var(--bg-tertiary)]"
          title="Показать панель"
        >
          <PanelLeft className="w-5 h-5" />
        </button>
      )}

      {ctx.ticketsViewMode ? (
        /* Tickets view mode - show all tickets in center */
        <TicketsListView />
      ) : ctx.atomsViewMode ? (
        /* Atoms view mode - show all atoms from all documents */
        <AtomsListView />
      ) : ctx.selectedDocument ? (
        /* Document view - switch between structure mode and pages mode */
        ctx.structureMode ? (
          <DocumentStructure
            items={filteredItems}
            document={ctx.selectedDocument}
            onSelectItem={(item) => {
              // For atom level, open atom modal (only if not read-only)
              if (item.level === 'atom' && !ctx.isReadOnly) {
                ctx.setConvertToAtomItem(item);
                ctx.setShowConvertToAtomModal(true);
                return;
              }
              ctx.setSelectedItemId(item.id);
              ctx.setRightPanelMode('settings');
              ctx.setRightPanelOpen(true);
            }}
            onAddItem={ctx.isReadOnly ? undefined : handleAddItem}
          />
        ) : (
          <DocumentPages
            items={filteredItems}
            document={ctx.selectedDocument}
            renderItemContent={renderItemContent}
          />
        )
      ) : (
        /* No document selected - show documents grid */
        <DocumentsGrid />
      )}

      {/* Documents grid overlay - DISABLED: now "All Documents" clears selection and shows list in sidebar */}
      {/* {ctx.showDocumentsGrid && ctx.selectedDocument && (
        <DocumentsGridOverlay />
      )} */}

      {/* ADR-0003 widget-embed §Phase1: widget picker modal — shared by placeholder clicks,
          right-panel "change widget", and "+ Виджет" insert menu entries. */}
      {ctx.widgetPickerTarget && ctx.selectedDocumentId != null && (
        <AddWidgetModal
          isOpen={true}
          onClose={() => ctx.setWidgetPickerTarget(null)}
          dashboardId={0}
          spaceId={ctx.spaceId}
          embedMode="document"
          ownerKind="document"
          ownerId={ctx.selectedDocumentId}
          onWidgetCreated={handleWidgetPicked}
        />
      )}
    </div>
  );
}
