import { MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, SIDEBAR_WIDTH_KEY } from './sidebar/constants';
/**
 * Documents Sidebar - thin container. Composition of sub-components lives in ./sidebar/.
 */

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/shared/utils/cn';
import { apiClient } from '@/shared/utils/apiClient';
import { useDocumentsContext } from './DocumentsContext';
import { useTicketConfig, type TicketRow } from './content/ticketUtils';
import { tablesApi } from '@/features/tables/api/tablesApi';
import {
  CATEGORIES_VISIBLE_KEY,
  SidebarDocList,
  SidebarFooterButtons,
  SidebarFooterStats,
  SidebarHeader,
  SidebarImportView,
  SidebarItemsTree,
  useSidebarFilter,
  useSidebarResize,
} from './sidebar';

export function DocumentsSidebar() {
  const ctx = useDocumentsContext();
  const [showCategories, setShowCategories] = useState(() => {
    const saved = localStorage.getItem(CATEGORIES_VISIBLE_KEY);
    return saved === 'true';
  });
  const [showInlineWidgets, setShowInlineWidgets] = useState(false);

  const { handleResizeStart } = useSidebarResize();
  const filteredDocuments = useSidebarFilter();

  const { config: sidebarTicketConfig } = useTicketConfig(ctx.config);
  const { data: ticketsCountData } = useQuery({
    queryKey: ['tickets', ctx.projectId, sidebarTicketConfig?.table_id],
    queryFn: async () => {
      const response = await apiClient.get<{ data: { rows: TicketRow[] } }>(`/tables/${sidebarTicketConfig!.table_id}/rows?limit=5000`);
      return response.data;
    },
    enabled: !!sidebarTicketConfig?.table_id,
  });
  const ticketsCount = (ticketsCountData?.rows || []).length;

  const { data: ticketsColumnsData } = useQuery({
    queryKey: ['table-columns', sidebarTicketConfig?.table_id],
    queryFn: async () => {
      const response = await tablesApi.getColumns(String(sidebarTicketConfig!.table_id));
      return response.columns;
    },
    enabled: !!sidebarTicketConfig?.table_id,
    staleTime: 60_000,
  });

  // Same registry-relation scan as `TicketsListView.registryRelationColumns`:
  // any relation column on tickets pointing to this widget's registry table
  // (e.g. `adr_ref` → `_registry`) ties a ticket to the doc whose id matches
  // the column's value. Counter must include this signal so it agrees with
  // the central view.
  const registryRelationColumns = useMemo(() => {
    if (!ctx.registryTableId) return [] as string[];
    const targetId = Number(ctx.registryTableId);
    const cols: string[] = [];
    for (const col of ticketsColumnsData || []) {
      const cfg = (typeof col.config === 'string'
        ? (() => { try { return JSON.parse(col.config as unknown as string); } catch { return {}; } })()
        : (col.config || {})) as {
          relation?: { enabled?: boolean; tableId?: number | string };
          relatedTableId?: number | string;
          tableId?: number | string;
        };
      const candidate = Number(
        cfg?.relation?.tableId ?? cfg?.relatedTableId ?? (col.type === 'relation' ? cfg?.tableId : undefined),
      );
      if (Number.isFinite(candidate) && candidate === targetId) {
        cols.push(col.name);
      }
    }
    return cols;
  }, [ticketsColumnsData, ctx.registryTableId]);

  // Document-scoped counter — counts a ticket if it EXISTS in the tickets
  // table AND any of these match: an atom in this doc references it (legacy
  // `ticket_ref`); its `parent_document_id` equals docId (ADR-0012); or a
  // relation column pointing to the registry (e.g. `adr_ref`) equals docId.
  // Stale `ticket_ref` atoms pointing to deleted tickets are excluded.
  const documentTicketsCount = useMemo(() => {
    if (!ctx.selectedDocumentId) return 0;
    const docId = Number(ctx.selectedDocumentId);
    const refIds = new Set<number>();
    for (const item of ctx.items) {
      if (item.ticket_ref != null) {
        const n = Number(item.ticket_ref);
        if (!Number.isNaN(n)) refIds.add(n);
      }
    }
    const rows = (ticketsCountData?.rows || []) as Array<{
      id: number | string;
      data?: Record<string, unknown>;
    }>;
    let count = 0;
    for (const row of rows) {
      const rowId = Number(row.id);
      if (refIds.has(rowId)) {
        count += 1;
        continue;
      }
      const flat = row as Record<string, unknown>;
      const nested = row.data || {};
      const parentId = Number((nested as Record<string, unknown>).parent_document_id ?? flat.parent_document_id);
      if (Number.isFinite(parentId) && parentId === docId) {
        count += 1;
        continue;
      }
      let matchedRelation = false;
      for (const col of registryRelationColumns) {
        const val = Number((nested as Record<string, unknown>)[col] ?? flat[col]);
        if (Number.isFinite(val) && val === docId) {
          matchedRelation = true;
          break;
        }
      }
      if (matchedRelation) count += 1;
    }
    return count;
  }, [ctx.items, ctx.selectedDocumentId, ticketsCountData, registryRelationColumns]);

  const documentAtomsCount = useMemo(() => {
    if (!ctx.selectedDocumentId) return 0;
    return ctx.items.filter(item => item.atom_ref != null).length;
  }, [ctx.items, ctx.selectedDocumentId]);

  const atomsDisplay = ctx.selectedDocumentId
    ? documentAtomsCount
    : (ctx.allAtoms?.length || 0);
  const ticketsDisplay = ctx.selectedDocumentId
    ? documentTicketsCount
    : ticketsCount;

  // Desktop/tablet: respect sidebarCollapsed. Mobile: overlay, controlled by mobileSidebarOpen.
  if (!ctx.isMobile && ctx.sidebarCollapsed) return null;
  if (ctx.isMobile && !ctx.mobileSidebarOpen) return null;

  return (
    <div
      className={cn(
        'relative flex flex-col border-r border-[var(--border-primary)] bg-[var(--bg-secondary)]',
        ctx.isMobile && 'absolute inset-y-0 left-0 z-20 w-[85vw] max-w-[360px] shadow-2xl animate-slide-in-left',
        ctx.isTablet && 'max-w-[280px]'
      )}
      style={ctx.isMobile ? undefined : { width: ctx.sidebarWidth }}
    >
      <SidebarHeader
        showCategories={showCategories}
        setShowCategories={setShowCategories}
      />

      <div className="flex-1 overflow-y-auto">
        {ctx.isCreatingMode ? (
          <SidebarImportView />
        ) : ctx.selectedDocumentId ? (
          <SidebarItemsTree
            showInlineWidgets={showInlineWidgets}
            setShowInlineWidgets={setShowInlineWidgets}
          />
        ) : (
          <SidebarDocList documents={filteredDocuments} showCategories={showCategories} />
        )}
      </div>

      <SidebarFooterButtons
        ticketsCount={ticketsDisplay}
        atomsCount={atomsDisplay}
      />
      <SidebarFooterStats />

      {!ctx.isMobile && (
        <div role="slider" tabIndex={0} aria-label="Ширина списка документов" aria-orientation="horizontal"
          aria-valuenow={ctx.sidebarWidth} aria-valuemin={MIN_SIDEBAR_WIDTH} aria-valuemax={MAX_SIDEBAR_WIDTH}
          onKeyDown={e => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
            e.preventDefault();
            const width = e.key === 'Home' ? MIN_SIDEBAR_WIDTH : e.key === 'End' ? MAX_SIDEBAR_WIDTH
              : Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, ctx.sidebarWidth + (e.key === 'ArrowRight' ? 20 : -20)));
            ctx.setSidebarWidth(width);
            localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
          }}
          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/50 active:bg-blue-500 transition-colors z-20"
          onMouseDown={handleResizeStart}
        />
      )}
    </div>
  );
}
