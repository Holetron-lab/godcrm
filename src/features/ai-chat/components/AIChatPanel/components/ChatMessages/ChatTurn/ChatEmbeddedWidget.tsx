/**
 * ChatEmbeddedWidget — ADR-0031 WP-20+21 (T-141238).
 *
 * Renders a live mini-widget (list / kanban / table) of CRM rows directly
 * inside a chat message bubble. Driven by the `widget_embed` attachment
 * payload that an agent (or user) attaches to a chat message via:
 *
 *   send_chat_message({
 *     content_type: 'widget_embed',
 *     attachments: [{
 *       type: 'widget_embed',
 *       widgetEmbed: { table_id, view, filter?, columns?, limit?, group_by? }
 *     }]
 *   })
 *
 * Render strategy (T-141238 fix):
 *   - Build a synthetic `Widget` from the attachment payload.
 *   - Drive it through the canonical `useTicketData` hook (the same hook
 *     `DashboardWidgetCard` uses), which fetches rows + columns + relation
 *     tables. The `relationData` map it returns is what makes raw FK ids
 *     ("24267") resolve to human labels ("In Progress", "developer-ralph"…).
 *   - Render via the real preset widgets (`TaskListWidget`, `KanbanWidget`,
 *     `TableViewWidget`) — same modules dashboards/documents use. Toolbars
 *     and create-row chrome are suppressed via widget config flags
 *     (`show_filters: false`, `compact: true`) so the embed reads as a
 *     read-only mini view inside the chat bubble.
 *
 * Why we route through the presets (and NOT bespoke views): foreign-key
 * columns on tickets table 1708 (`state`, `assignees`, `project_id`, etc.)
 * store row ids. Resolving those to labels requires loading the related
 * tables (workflow states, users, projects). `useTicketData` already does
 * that. Bespoke renderers had no concept of relation resolution → user saw
 * raw ids in cells/lanes.
 *
 * Constraints kept intact from the previous bespoke implementation:
 *   - IntersectionObserver lazy-mount via `useInView` (anti-jank).
 *   - ErrorBoundary + ErrorPill with retry.
 *   - Stable-height SkeletonBlock to avoid layout jump.
 *   - Click row → `RowViewerModal` (CardDetailModal in view mode).
 *   - `mergeWidgetConfig` kept in the loop so future overrides on top of
 *     the agent payload compose with byte-equivalent semantics.
 */

import {
  Component,
  lazy,
  Suspense,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import {
  AlertTriangle,
  Layers,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { mergeWidgetConfig } from '@/features/widgets/utils/mergeWidgetConfig';
import { useInView } from '@/features/widgets/components/presets/documents/content/useInView';
import { useTicketData } from '@/features/widgets/hooks/useTicketData';
import { TaskListWidget } from '@/features/widgets/components/presets/TaskListWidget';
import { KanbanWidget } from '@/features/widgets/components/presets/kanban/KanbanWidget';
import { TableViewWidget } from '@/features/widgets/components/presets/TableViewWidget';
import type { Widget, PresetWidgetName, WidgetConfig } from '@/features/widgets/types/widget.types';
import type { WidgetEmbedConfig } from '@/features/ai-chat/types';

// Self-loading row viewer (CardDetailModal) — same modal the row_reference
// chip uses, keeps "click row → open card" UX consistent across chat.
const RowViewerModal = lazy(() => import('../RowViewerModal'));

// ── Constants ──────────────────────────────────────────────────────────────

// Hard ceiling: an agent asking for 10k rows still gets a sane payload.
const ROW_PAGE_SIZE_CAP = 200;

// Skeleton height — picked to match a typical 5-row list/table embed so the
// bubble doesn't grow visibly when data arrives.
const SKELETON_MIN_HEIGHT = 240;

const VIEW_LABEL: Record<WidgetEmbedConfig['view'], string> = {
  list: 'Список',
  kanban: 'Канбан',
  table: 'Таблица',
};

const VIEW_TO_PRESET: Record<WidgetEmbedConfig['view'], PresetWidgetName> = {
  list: 'task_list',
  kanban: 'kanban_board',
  table: 'table_view',
};

// ── Helpers ────────────────────────────────────────────────────────────────

interface NormalizedFilter {
  column: string;
  value: unknown;
}

/**
 * Normalize the dual-shape `filter` field into [{column,value}, ...].
 *
 *   Brief shape:        `{ column: 'phase', value: 'todo' }`
 *   Backend doc shape:  `{ phase: 'todo', priority: 'high' }`
 *
 * Multi-key map shapes AND together. We accept both because the brief
 * defines one shape and the backend system-prompt + send_chat_message tool
 * definition document the other — agents in the wild will use either.
 */
function normalizeFilter(
  filter: WidgetEmbedConfig['filter'] | undefined,
): NormalizedFilter[] {
  if (!filter || typeof filter !== 'object') return [];
  const f = filter as Record<string, unknown>;
  if (typeof f.column === 'string' && 'value' in f) {
    return [{ column: f.column, value: f.value }];
  }
  const out: NormalizedFilter[] = [];
  for (const [k, v] of Object.entries(f)) {
    if (k === 'column' || k === 'value') continue;
    out.push({ column: k, value: v });
  }
  return out;
}

interface RowShape {
  id: number | string;
  data?: Record<string, unknown>;
  [k: string]: unknown;
}

function getCellValue(row: RowShape, column: string): unknown {
  if (!row) return undefined;
  if (row.data && typeof row.data === 'object' && column in row.data) {
    return (row.data as Record<string, unknown>)[column];
  }
  return (row as unknown as Record<string, unknown>)[column];
}

function valueMatches(cell: unknown, target: unknown): boolean {
  if (cell == null && target == null) return true;
  if (cell == null || target == null) return false;
  if (Array.isArray(cell)) return cell.map(String).includes(String(target));
  return String(cell).trim().toLowerCase() === String(target).trim().toLowerCase();
}

interface ColumnInfoLite {
  name: string;
  type: string;
}

/**
 * Pick the best title column to display in the card. Different tables use
 * different conventions: documents use `name`, BDD criteria use `title`,
 * tickets table 1708 uses `what` (free-text "what to do"). Fall back to the
 * first plain `text` column if none of the canonical names match. Returns
 * undefined if there's nothing usable — TaskListWidget then renders its own
 * "Без названия" placeholder.
 */
function pickTitleColumn(columnsInfo: ColumnInfoLite[]): string | undefined {
  if (!columnsInfo?.length) return undefined;
  const preferred = ['name', 'title', 'what', 'subject', 'label'];
  for (const candidate of preferred) {
    if (columnsInfo.some(c => c.name === candidate)) return candidate;
  }
  const firstText = columnsInfo.find(c => c.type === 'text' || c.type === 'string');
  return firstText?.name;
}

// ── Synthetic Widget builder ───────────────────────────────────────────────

/**
 * Build a synthetic `Widget` from an embed payload. Shape mirrors the real
 * `Widget` type so preset widgets behave identically. Toolbars/create-row
 * chrome are suppressed (`show_filters: false`, `compact: true`).
 *
 * `mergeWidgetConfig` is kept in the loop so any future overrides
 * (settings_override-style on top of the agent payload) compose with the
 * exact same byte-equivalent semantics as the backend resolver.
 */
function buildSyntheticWidget(embed: WidgetEmbedConfig): Widget {
  const presetName = VIEW_TO_PRESET[embed.view] ?? 'task_list';
  const limit = Math.min(Math.max(embed.limit ?? 50, 1), ROW_PAGE_SIZE_CAP);

  const baseConfig: WidgetConfig = {
    table_id: embed.table_id,
    visible_columns: embed.columns ?? undefined,
    limit,
    show_filters: false, // chat embed is read-only — no toolbar
    // Kanban grouping
    group_by_column: embed.group_by ?? undefined,
  };

  // Layer through mergeWidgetConfig so future overrides compose deterministically.
  const mergedConfig = mergeWidgetConfig(baseConfig, {
    table_id: embed.table_id,
    visible_columns: embed.columns ?? undefined,
    limit,
    group_by_column: embed.group_by ?? undefined,
    show_filters: false,
  }) as WidgetConfig;

  return {
    id: 0,
    dashboard_id: 0,
    source_widget_id: null,
    widget_type: 'preset',
    preset_name: presetName,
    code: null,
    code_version: 0,
    title: '',
    description: null,
    icon: '',
    config: mergedConfig,
    position: { x: 0, y: 0, w: 12, h: 6 },
    is_visible: true,
    is_module: false,
    order_index: 0,
    created_by: null,
    created_at: '',
    updated_at: '',
    module_id: null,
    sidebar_order: null,
    sidebar_icon: null,
    access_level: null,
    is_pinned: null,
  };
}

// ── Error boundary ────────────────────────────────────────────────────────

class ChatEmbeddedWidgetBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ChatEmbeddedWidget] preset crashed:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center gap-2 p-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>Виджет упал при рендере: {this.state.error.message}</span>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Main component ────────────────────────────────────────────────────────

interface ChatEmbeddedWidgetProps {
  widgetEmbed: WidgetEmbedConfig;
}

export function ChatEmbeddedWidget({ widgetEmbed }: ChatEmbeddedWidgetProps) {
  const { table_id, view, filter, limit } = widgetEmbed;

  // Lazy mount via IntersectionObserver. Defer the data fetch until the
  // embed scrolls near the viewport. Safe in a chat panel because the panel
  // itself participates in the page scroll; once the panel opens the embed
  // resolves "in view" within one frame.
  const { ref: ioRef, isInView } = useInView<HTMLDivElement>({
    rootMargin: '200px 0px',
    enabled: true,
  });

  // Row click → open CardDetailModal (same UX as row_reference chip).
  const [viewingRow, setViewingRow] = useState<{ tableId: number; rowId: number } | null>(null);

  // Synthetic widget — drives the preset widgets exactly like a real saved widget.
  const syntheticWidget = useMemo(() => buildSyntheticWidget(widgetEmbed), [widgetEmbed]);

  const effectiveTableId = Number(table_id);
  const effectiveLimit = Math.min(Math.max(limit ?? 50, 1), ROW_PAGE_SIZE_CAP);
  const enabled = isInView && Number.isFinite(effectiveTableId) && effectiveTableId > 0;

  // Canonical hook — same one DashboardWidgetCard uses. Loads rows, columns,
  // table config, AND relation tables. `relationData` is the literal fix:
  // it lets preset widgets resolve FK ids → labels.
  const {
    widgetData,
    columnsInfo,
    relationData,
    kanbanGroupColumn,
    kanbanColumnOptions,
    tableConfig,
    isLoadingData,
    isLoadingColumns,
    refetchData,
  } = useTicketData({
    widgetId: 0,
    widget: syntheticWidget,
    tableId: effectiveTableId,
    enabled,
  });

  const filters = useMemo(() => normalizeFilter(filter), [filter]);

  // Auto-detect the title column once columns load. Tickets table 1708 stores
  // the title in `what` (no `name`/`title` column) — without this the cards
  // render as empty "Без названия" rows.
  const titleColumn = useMemo(() => pickTitleColumn(columnsInfo), [columnsInfo]);

  // Inject the resolved title column into the synthetic widget config so
  // KanbanWidget (which reads `widget.config.card_title_column`) picks it up.
  // TaskListWidget gets it via the explicit `cardTitleColumn` prop below.
  const enrichedWidget = useMemo<Widget>(() => {
    if (!titleColumn) return syntheticWidget;
    return {
      ...syntheticWidget,
      config: { ...syntheticWidget.config, card_title_column: titleColumn },
    };
  }, [syntheticWidget, titleColumn]);

  // Apply embed-level filters + limit client-side. The hook fetches up to
  // 500 rows raw — we narrow per the agent's payload here.
  const filteredRows = useMemo(() => {
    let rows = (widgetData ?? []) as unknown as RowShape[];
    if (filters.length > 0) {
      rows = rows.filter(r =>
        filters.every(f => valueMatches(getCellValue(r, f.column), f.value)),
      );
    }
    return rows.slice(0, effectiveLimit);
  }, [widgetData, filters, effectiveLimit]);

  const handleCardDoubleClick = (card: RowShape) => {
    const rowId = Number(card.id);
    if (!Number.isFinite(rowId)) return;
    setViewingRow({ tableId: effectiveTableId, rowId });
  };

  // ── Render branches ──
  // Invalid input — never crashes the bubble.
  if (!Number.isFinite(effectiveTableId) || effectiveTableId <= 0) {
    return (
      <div ref={ioRef} className="w-full mt-2">
        <ErrorPill message={`Invalid table_id: ${String(table_id)}`} />
      </div>
    );
  }

  const isLoading = enabled && (isLoadingData || isLoadingColumns);

  return (
    <div
      ref={ioRef}
      className="w-full mt-2 chat-embedded-widget"
      data-widget-embed
      data-table-id={effectiveTableId}
      data-view={view}
    >
      {!isInView || isLoading ? (
        <SkeletonBlock label={`${VIEW_LABEL[view] ?? view} #${effectiveTableId}`} />
      ) : filteredRows.length === 0 && (widgetData ?? []).length === 0 ? (
        <ErrorPill
          message={`Нет строк (table #${effectiveTableId})`}
          onRetry={() => { refetchData(); }}
        />
      ) : filteredRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-secondary)] bg-[var(--bg-tertiary)]/40 px-3 py-4 text-center text-xs text-[var(--text-tertiary)]">
          Нет строк, удовлетворяющих фильтру (table #{effectiveTableId})
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] overflow-hidden">
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 text-[11px] text-[var(--text-tertiary)]">
            <span className="inline-flex items-center gap-1.5">
              <Layers className="w-3 h-3" />
              <span>{VIEW_LABEL[view] ?? view}</span>
              <span className="opacity-50">·</span>
              <span>#{effectiveTableId}</span>
              <span className="opacity-50">·</span>
              <span>{filteredRows.length} {filteredRows.length === 1 ? 'строка' : 'строк'}</span>
              {filters.length > 0 && (
                <>
                  <span className="opacity-50">·</span>
                  <span>{filters.length} {filters.length === 1 ? 'фильтр' : 'фильтра'}</span>
                </>
              )}
            </span>
          </div>
          <div className="max-h-[460px] overflow-auto">
            <ChatEmbeddedWidgetBoundary>
              {view === 'kanban' ? (
                <KanbanWidget
                  widget={enrichedWidget}
                  data={filteredRows}
                  columnsInfo={columnsInfo}
                  columnOptions={kanbanColumnOptions}
                  relationData={relationData}
                  showToolbar={false}
                  compact
                  onCardDoubleClick={(card) => handleCardDoubleClick(card as RowShape)}
                />
              ) : view === 'table' ? (
                <TableViewWidget
                  widget={enrichedWidget}
                  data={filteredRows}
                  columnsInfo={columnsInfo}
                  relationData={relationData}
                  tableConfig={{
                    ...(tableConfig ?? {}),
                    min_row_height: 24,
                    max_row_height: 300,
                    fixed_row_height: null,
                  }}
                  onRowDoubleClick={(row) => handleCardDoubleClick(row as unknown as RowShape)}
                />
              ) : (
                <TaskListWidget
                  widget={enrichedWidget}
                  data={filteredRows}
                  columnsInfo={columnsInfo}
                  cardTitleColumn={titleColumn}
                  compact
                  onTaskDoubleClick={(task) => handleCardDoubleClick(task as unknown as RowShape)}
                />
              )}
            </ChatEmbeddedWidgetBoundary>
          </div>
        </div>
      )}

      {viewingRow && (
        <Suspense fallback={null}>
          <RowViewerModal
            isOpen={true}
            onClose={() => setViewingRow(null)}
            tableId={viewingRow.tableId}
            rowId={viewingRow.rowId}
            mode="view"
          />
        </Suspense>
      )}
    </div>
  );
  // Suppress unused-var lint: kanbanGroupColumn is intentionally read off the
  // hook so the destructure stays explicit for future use; KanbanWidget reads
  // group_by_column from widget.config directly.
  void kanbanGroupColumn;
}

// ── Tiny presentational subcomponents ──────────────────────────────────────

function SkeletonBlock({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 p-3"
      style={{ minHeight: SKELETON_MIN_HEIGHT }}
    >
      <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] mb-3">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-primary-500)]" />
        <span className="truncate">{label}</span>
      </div>
      <div className="space-y-2" aria-hidden="true">
        <div className="h-3 rounded bg-[var(--bg-tertiary)] w-3/4 animate-pulse" />
        <div className="h-3 rounded bg-[var(--bg-tertiary)] w-1/2 animate-pulse" />
        <div className="h-3 rounded bg-[var(--bg-tertiary)] w-5/6 animate-pulse" />
        <div className="h-3 rounded bg-[var(--bg-tertiary)] w-2/3 animate-pulse" />
      </div>
      <span className="sr-only">Загрузка виджета…</span>
    </div>
  );
}

function ErrorPill({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300"
    >
      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="flex-1 min-w-0 truncate" title={message}>{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          <span>Повторить</span>
        </button>
      )}
    </div>
  );
}

export default ChatEmbeddedWidget;
