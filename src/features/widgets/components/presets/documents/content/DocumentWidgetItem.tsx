import { useMemo } from 'react';
import { MoreVertical, Loader2 } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { type DocumentLevel, type DocumentItem } from '../../../../types/documents.types';
import { useDocumentsContext } from '../DocumentsContext';
import { ItemMenu } from './ItemMenu';
import { useWidget, useWidgetData } from '../../../../hooks/useWidgets';
import { WidgetRenderer } from '../../../WidgetRenderer';
import { mergeWidgetConfig } from '../../../../utils/mergeWidgetConfig';
import type { WidgetDataRow, Widget } from '../../../../types/widget.types';
import { useInView, shouldEagerRenderWidgets } from './useInView';

interface FilterOverride {
  column?: string | null;
  value?: string;
  use_doc_number?: boolean;
}

function parseItemOverride(raw: unknown): { filter?: FilterOverride } {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as { filter?: FilterOverride };
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw as { filter?: FilterOverride };
  return {};
}

interface DocumentWidgetItemProps {
  item: DocumentItem;
  index: number;
  itemsCount: number;
  openMenu: { id: number; position: { top: number; left: number } } | null;
  openMenuAt: (itemId: number, buttonElement: HTMLElement) => void;
  closeMenu: () => void;
  onAddBefore: (item: DocumentItem, level: DocumentLevel) => void;
  onAddAfter: (item: DocumentItem, level: DocumentLevel) => void;
  onDelete: (itemId: number) => void;
  onCopy: (item: DocumentItem) => void;
  onMoveUp: (item: DocumentItem) => void;
  onMoveDown: (item: DocumentItem) => void;
  isSelected: boolean;
}

// ADR-0005 C-2: number of widget items eager-rendered above the fold. The
// "first N" heuristic uses the document item index — cheap, deterministic,
// and good enough because heavy widgets are rarely stacked at the very top.
const EAGER_RENDER_THRESHOLD = 3;

// ADR-0005 C-2: default placeholder height (px). Tuned to a typical
// tickets-list / table widget so layout doesn't jump on first paint.
const DEFAULT_PLACEHOLDER_MIN_HEIGHT = 240;

export function DocumentWidgetItem({
  item,
  index,
  itemsCount,
  openMenu,
  openMenuAt,
  closeMenu,
  onAddBefore,
  onAddAfter,
  onDelete,
  onCopy,
  onMoveUp,
  onMoveDown,
  isSelected,
}: DocumentWidgetItemProps) {
  const ctx = useDocumentsContext();
  const widgetId = typeof item.widget_ref === 'number' ? item.widget_ref : null;

  // ADR-0005 C-2: eager-render the first N widget-atoms (above-the-fold) and
  // any time print/reduced-motion flags are set. Otherwise, use IO to defer
  // the heavy queries (`useWidget`, `useWidgetData`) until the placeholder
  // scrolls near the viewport. We never unmount once mounted.
  const eagerRender =
    index < EAGER_RENDER_THRESHOLD || shouldEagerRenderWidgets();
  const { ref: ioRef, isInView } = useInView<HTMLDivElement>({
    rootMargin: '200px 0px',
    enabled: !eagerRender,
  });
  const shouldMount = eagerRender || isInView;

  // ADR-0005 C-2: gate both data hooks on `shouldMount`. We pass `0` for
  // the widgetId until mount which causes `useWidget` / `useWidgetData` to
  // short-circuit via their internal `enabled: !!widgetId`. `useWidgetData`
  // also accepts an explicit `enabled` flag we feed `shouldMount` into.
  const gatedWidgetId = shouldMount && widgetId ? widgetId : 0;
  const atomId = typeof item.id === 'number' ? item.id : null;
  const widgetQuery = useWidget(gatedWidgetId);
  const dataQuery = useWidgetData(gatedWidgetId, shouldMount, atomId);

  const effectiveWidget = useMemo<Widget | null>(() => {
    if (!widgetQuery.data) return null;
    const override = parseItemOverride(item.settings_override);
    if (!override || Object.keys(override).length === 0) return widgetQuery.data;
    return {
      ...widgetQuery.data,
      config: mergeWidgetConfig(widgetQuery.data.config, override) as Widget['config'],
    };
  }, [widgetQuery.data, item.settings_override]);

  const filteredData = useMemo<WidgetDataRow[]>(() => {
    const rows = (dataQuery.data as WidgetDataRow[] | undefined) ?? [];
    const override = parseItemOverride(item.settings_override);
    const f = override.filter;
    if (!f || !f.column) return rows;
    const docNumber = String(ctx.selectedDocument?.id || '');
    const needle = (f.use_doc_number ? docNumber : (f.value ?? '')).toString().trim().toLowerCase();
    if (!needle) return rows;
    const col = f.column;
    return rows.filter((r) => {
      const row = r as unknown as Record<string, unknown>;
      const cellCandidate = row[col] ?? (row.data as Record<string, unknown> | undefined)?.[col];
      if (cellCandidate == null) return false;
      return String(cellCandidate).trim().toLowerCase() === needle;
    });
  }, [dataQuery.data, item.settings_override, ctx.selectedDocument?.id]);

  // ADR-0005 C-15: stable id so the wrapper region can point its
  // aria-labelledby at the heading without colliding across items.
  const titleId = `widget-atom-${item.id}-title`;
  const widgetTitle = effectiveWidget?.title || `Виджет #${widgetId ?? '—'}`;

  return (
    <div
      ref={ioRef}
      id={`item-${item.id}`}
      role="region"
      aria-labelledby={titleId}
      className={cn(
        "group relative py-4 transition-colors",
        isSelected && 'bg-[var(--color-primary-500)]/10'
      )}
      onClick={() => {
        ctx.setSelectedItemId(item.id);
        ctx.setRightPanelMode('settings');
        ctx.setRightPanelOpen(true);
      }}
    >
      {/* ADR-0005 C-15: visually hidden title anchor — present even before
          mount so screen readers can announce the region while the skeleton
          is still in place. */}
      <span id={titleId} className="sr-only">
        {widgetTitle}
      </span>

      {!ctx.isReadOnly && (
        <div className="absolute top-2 -right-12 flex items-center gap-1.5 transition-opacity z-10 opacity-0 group-hover:opacity-100">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-cyan-500/20 text-cyan-400">
            widget
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              openMenu?.id === item.id ? closeMenu() : openMenuAt(item.id, e.currentTarget);
            }}
            className={cn(
              "p-1 rounded text-[var(--text-tertiary)]",
              isSelected ? "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]" : "hover:bg-[var(--bg-tertiary)]"
            )}
            title="Меню"
            aria-label="Меню виджета"
          >
            <MoreVertical className="w-3.5 h-3.5" aria-hidden="true" />
          </button>

          <ItemMenu
            item={item}
            position={openMenu?.position || { top: 0, left: 0 }}
            isOpen={openMenu?.id === item.id}
            onClose={closeMenu}
            onAddBefore={onAddBefore}
            onAddAfter={onAddAfter}
            onDelete={onDelete}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            onCopy={onCopy}
            isFirst={index === 0}
            isLast={index === itemsCount - 1}
          />
        </div>
      )}

      {!widgetId ? (
        <button
          type="button"
          onClick={(e) => {
            if (ctx.isReadOnly) return;
            e.stopPropagation();
            ctx.setWidgetPickerTarget({ mode: 'replace', itemId: item.id });
          }}
          disabled={ctx.isReadOnly}
          className={cn(
            "w-full flex items-center gap-2 p-4 bg-[var(--bg-tertiary)] rounded-lg text-sm text-[var(--text-tertiary)] border border-dashed border-[var(--border-primary)] text-left",
            !ctx.isReadOnly && "hover:bg-[var(--bg-secondary)] hover:border-cyan-500/40 cursor-pointer"
          )}
        >
          <span className="text-cyan-400" aria-hidden="true">🧩</span>
          <span>{ctx.isReadOnly ? 'Виджет не выбран' : 'Выбрать виджет…'}</span>
        </button>
      ) : !shouldMount ? (
        // ADR-0005 C-2 / C-15: lightweight skeleton placeholder. Reserves
        // approximate height to prevent layout shift, exposes status to
        // screen readers, and keeps the title visible via aria-labelledby.
        <div
          role="status"
          aria-busy="true"
          aria-live="polite"
          className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)]/40 p-4"
          style={{ minHeight: DEFAULT_PLACEHOLDER_MIN_HEIGHT }}
        >
          <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)] mb-3">
            <span className="text-cyan-400/60" aria-hidden="true">🧩</span>
            <span className="truncate">{widgetTitle}</span>
          </div>
          <div className="space-y-2" aria-hidden="true">
            <div className="h-3 rounded bg-[var(--bg-secondary)] w-3/4 animate-pulse" />
            <div className="h-3 rounded bg-[var(--bg-secondary)] w-1/2 animate-pulse" />
            <div className="h-3 rounded bg-[var(--bg-secondary)] w-2/3 animate-pulse" />
          </div>
          <span className="sr-only">Загрузка виджета…</span>
        </div>
      ) : widgetQuery.isLoading ? (
        <div
          role="status"
          aria-busy="true"
          aria-live="polite"
          className="flex items-center gap-2 p-4 text-sm text-[var(--text-tertiary)]"
        >
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span>Загрузка виджета #{widgetId}…</span>
        </div>
      ) : widgetQuery.error || !effectiveWidget ? (
        <div
          role="alert"
          className="flex items-center gap-2 p-4 bg-red-500/10 rounded-lg text-sm text-red-400"
        >
          <span aria-hidden="true">🧩</span>
          <span>Виджет #{widgetId} не найден</span>
        </div>
      ) : (
        <div
          className="rounded-lg border border-[var(--border-primary)] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <WidgetRenderer widget={effectiveWidget} data={filteredData} />
        </div>
      )}
    </div>
  );
}
