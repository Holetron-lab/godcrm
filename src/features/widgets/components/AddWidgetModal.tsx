/**
 * AddWidgetModal Component — ADR-073
 *
 * Two-column picker:
 *   Left  = space widgets (modules) + tables (show_in_nav=1)
 *   Right = compatible widget types (shown on click)
 *
 * Uses shared Modal component + i18n translations.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { logger } from '@/shared/utils/logger';
import {
  Search, ChevronRight, Table2, LayoutGrid, Calendar,
  GitBranch, BarChart3, ListTodo, Activity, Bot, FileText,
  Loader2, Hash, Image, PieChart, Database, Ticket
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/components/ui/Modal';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useSpaceWidgets, useSpaceTables } from '../hooks/useWidgetLibrary';
import { widgetKeys, useCreateWidget } from '../hooks/useWidgets';
import { createWidgetByOwner } from '../api/widgetsApi';
import { useSpacesQuery } from '@/features/spaces/hooks/useSpacesQuery';
import { cn } from '@/shared/utils/cn';
import type { SpaceWidgetItem, SpaceTableItem } from '../types/widget-library.types';
import type { CreateWidgetRequest, CreateWidgetByOwnerRequest, PresetWidgetName, Widget, WidgetOwnerKind } from '../types/widget.types';

interface AddWidgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Dashboard the widget is created under. Required when embedMode is
   * 'dashboard' (the default). Ignored when embedMode is 'document' or 'atom'.
   */
  dashboardId: number;
  spaceId?: number;
  /**
   * ADR-0003 widget-embed Phase 1. Default: 'dashboard'.
   * When set to 'document' or 'atom', the modal creates the widget via
   * POST /api/v3/widgets with the given owner instead of attaching it to a
   * dashboard.
   */
  embedMode?: 'dashboard' | 'document' | 'atom';
  ownerKind?: WidgetOwnerKind;
  ownerId?: number;
  /**
   * When embedMode === 'dashboard' the created widget is invalidated in-place
   * and the callback fires with no data (legacy signature). When embedMode is
   * 'document' or 'atom', the callback receives the created widget so the
   * caller can insert a document item referencing widget.id.
   */
  onWidgetCreated?: (widget?: Widget) => void;
}

interface WidgetTypeOption {
  id: string;
  nameKey: string;
  descKey: string;
  icon: React.ReactNode;
  color: string;
  compatibleWith: string[];
  /** Also compatible with raw tables (show_in_nav) */
  compatibleWithTable?: boolean;
  /**
   * If set, this widget type only shows for tables matching one of these
   * logical types (currently detected by table name match — `name === 'Tickets'`
   * → 'tickets'). Empty/undefined means "any table" (when compatibleWithTable=true).
   */
  compatibleWithTableTypes?: string[];
  defaultSize: { w: number; h: number };
}

// Selected item can be either a widget or a table
type SelectedItem =
  | { kind: 'widget'; data: SpaceWidgetItem }
  | { kind: 'table'; data: SpaceTableItem };

const WIDGET_TYPES: WidgetTypeOption[] = [
  {
    id: 'table_view',
    nameKey: 'widgets.picker.tableView',
    descKey: 'widgets.picker.tableViewDesc',
    icon: <Table2 className="w-5 h-5" />,
    color: 'bg-purple-600',
    compatibleWith: ['table_view', 'kanban_board', 'calendar_widget', 'timeline_widget'],
    compatibleWithTable: true,
    defaultSize: { w: 12, h: 6 },
  },
  {
    id: 'kanban_board',
    nameKey: 'widgets.picker.kanbanBoard',
    descKey: 'widgets.picker.kanbanBoardDesc',
    icon: <LayoutGrid className="w-5 h-5" />,
    color: 'bg-cyan-500',
    compatibleWith: ['table_view', 'kanban_board'],
    compatibleWithTable: true,
    defaultSize: { w: 12, h: 8 },
  },
  {
    id: 'calendar_widget',
    nameKey: 'widgets.picker.calendarWidget',
    descKey: 'widgets.picker.calendarWidgetDesc',
    icon: <Calendar className="w-5 h-5" />,
    color: 'bg-emerald-500',
    compatibleWith: ['table_view', 'kanban_board', 'calendar_widget'],
    compatibleWithTable: true,
    defaultSize: { w: 12, h: 8 },
  },
  {
    id: 'timeline_widget',
    nameKey: 'widgets.picker.timeline',
    descKey: 'widgets.picker.timelineDesc',
    icon: <GitBranch className="w-5 h-5" />,
    color: 'bg-amber-600',
    compatibleWith: ['table_view', 'kanban_board', 'timeline_widget'],
    compatibleWithTable: true,
    defaultSize: { w: 12, h: 6 },
  },
  {
    id: 'chart_widget',
    nameKey: 'widgets.picker.chart',
    descKey: 'widgets.picker.chartDesc',
    icon: <PieChart className="w-5 h-5" />,
    color: 'bg-pink-500',
    compatibleWith: ['table_view', 'kanban_board', 'calendar_widget', 'timeline_widget'],
    compatibleWithTable: true,
    defaultSize: { w: 6, h: 4 },
  },
  {
    id: 'number_widget',
    nameKey: 'widgets.picker.metricCard',
    descKey: 'widgets.picker.metricCardDesc',
    icon: <Hash className="w-5 h-5" />,
    color: 'bg-indigo-500',
    compatibleWith: ['table_view', 'kanban_board', 'calendar_widget', 'timeline_widget'],
    compatibleWithTable: true,
    defaultSize: { w: 3, h: 2 },
  },
  {
    id: 'gallery_widget',
    nameKey: 'widgets.picker.gallery',
    descKey: 'widgets.picker.galleryDesc',
    icon: <Image className="w-5 h-5" />,
    color: 'bg-rose-500',
    compatibleWith: ['table_view'],
    compatibleWithTable: true,
    defaultSize: { w: 12, h: 6 },
  },
  {
    id: 'task_list',
    nameKey: 'widgets.picker.taskList',
    descKey: 'widgets.picker.taskListDesc',
    icon: <ListTodo className="w-5 h-5" />,
    color: 'bg-green-500',
    compatibleWith: ['table_view', 'kanban_board'],
    compatibleWithTable: true,
    defaultSize: { w: 6, h: 6 },
  },
  {
    id: 'recent_activity',
    nameKey: 'widgets.picker.recentActivity',
    descKey: 'widgets.picker.recentActivityDesc',
    icon: <Activity className="w-5 h-5" />,
    color: 'bg-blue-500',
    compatibleWith: ['table_view', 'kanban_board'],
    compatibleWithTable: true,
    defaultSize: { w: 6, h: 4 },
  },
  {
    id: 'documents',
    nameKey: 'widgets.picker.documents',
    descKey: 'widgets.picker.documentsDesc',
    icon: <FileText className="w-5 h-5" />,
    color: 'bg-blue-600',
    compatibleWith: ['documents'],
    defaultSize: { w: 12, h: 8 },
  },
  {
    id: 'tickets_list',
    nameKey: 'widgets.picker.ticketsList',
    descKey: 'widgets.picker.ticketsListDesc',
    icon: <Ticket className="w-5 h-5" />,
    color: 'bg-purple-600',
    compatibleWith: ['tickets_list'],
    compatibleWithTable: true,
    compatibleWithTableTypes: ['tickets'],
    defaultSize: { w: 12, h: 8 },
  },
  {
    id: 'ai_agents',
    nameKey: 'widgets.picker.aiAgents',
    descKey: 'widgets.picker.aiAgentsDesc',
    icon: <Bot className="w-5 h-5" />,
    color: 'bg-gradient-to-br from-purple-500 to-indigo-600',
    compatibleWith: ['ai_agents'],
    defaultSize: { w: 12, h: 8 },
  },
  {
    id: 'virtual_office',
    nameKey: 'widgets.picker.virtualOffice',
    descKey: 'widgets.picker.virtualOfficeDesc',
    icon: <FileText className="w-5 h-5" />,
    color: 'bg-indigo-600',
    compatibleWith: ['virtual_office'],
    defaultSize: { w: 4, h: 4 },
  },
];

const moduleIconStyles: Record<string, { bg: string; icon: typeof Table2 }> = {
  'table_view': { bg: 'bg-purple-600', icon: Table2 },
  'kanban_board': { bg: 'bg-cyan-500', icon: LayoutGrid },
  'calendar_widget': { bg: 'bg-emerald-500', icon: Calendar },
  'timeline_widget': { bg: 'bg-amber-600', icon: GitBranch },
  'chart_widget': { bg: 'bg-pink-500', icon: BarChart3 },
  'task_list': { bg: 'bg-green-500', icon: ListTodo },
  'recent_activity': { bg: 'bg-indigo-500', icon: Activity },
  'ai_agents': { bg: 'bg-gradient-to-br from-purple-500 to-indigo-600', icon: Bot },
  'documents': { bg: 'bg-primary-600', icon: FileText },
  'tickets_list': { bg: 'bg-purple-600', icon: Ticket },
  'virtual_office': { bg: 'bg-indigo-600', icon: FileText },
};

/** Widget types compatible with any table */
const TABLE_WIDGET_TYPES = WIDGET_TYPES.filter(wt => wt.compatibleWithTable);

/**
 * Map a `SpaceTableItem` to a logical table type used by
 * `WidgetTypeOption.compatibleWithTableTypes`. Currently the only recognized
 * type is 'tickets' (the per-project Tickets table created by ProjectService);
 * unknown tables return null so generic widget types still apply.
 */
function getTableLogicalType(table: SpaceTableItem): string | null {
  if (table.name === 'Tickets') return 'tickets';
  return null;
}

/** Filter TABLE_WIDGET_TYPES for a specific table (honoring compatibleWithTableTypes). */
function getCompatibleTypesForTable(table: SpaceTableItem): WidgetTypeOption[] {
  const logical = getTableLogicalType(table);
  return TABLE_WIDGET_TYPES.filter((wt) => {
    if (!wt.compatibleWithTableTypes || wt.compatibleWithTableTypes.length === 0) {
      // Generic table widget — always shown.
      return true;
    }
    // Restricted: show only when the table's logical type matches.
    return logical !== null && wt.compatibleWithTableTypes.includes(logical);
  });
}

export function AddWidgetModal({
  isOpen,
  onClose,
  dashboardId,
  spaceId: externalSpaceId = 0,
  embedMode = 'dashboard',
  ownerKind,
  ownerId,
  onWidgetCreated,
}: AddWidgetModalProps) {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState(externalSpaceId);
  const queryClient = useQueryClient();
  const createWidgetMutation = useCreateWidget();

  // If no external spaceId, show space selector (for Quick Access / home dashboard)
  const showSpaceSelector = externalSpaceId === 0;
  const { data: spaces = [] } = useSpacesQuery();

  // Resolve active spaceId: external or user-selected
  const spaceId = externalSpaceId > 0 ? externalSpaceId : selectedSpaceId;

  // Auto-select first space when modal opens and no external spaceId
  useEffect(() => {
    if (isOpen && showSpaceSelector && spaces.length > 0 && selectedSpaceId === 0) {
      setSelectedSpaceId(spaces[0].id);
    }
  }, [isOpen, showSpaceSelector, spaces, selectedSpaceId]);

  const { data: widgets = [], isLoading: widgetsLoading, error: widgetsError } =
    useSpaceWidgets(spaceId, isOpen && spaceId > 0);
  const { data: tables = [], isLoading: tablesLoading, error: tablesError } =
    useSpaceTables(spaceId, isOpen && spaceId > 0);

  const isLoading = widgetsLoading || tablesLoading;
  const error = widgetsError || tablesError;

  // Filter widgets by search
  const filteredWidgets = useMemo(() => {
    if (!searchQuery) return widgets;
    const q = searchQuery.toLowerCase();
    return widgets.filter((w) =>
      w.title?.toLowerCase().includes(q) ||
      w.preset_name?.toLowerCase().includes(q) ||
      w.project_name?.toLowerCase().includes(q)
    );
  }, [widgets, searchQuery]);

  // Filter tables by search
  const filteredTables = useMemo(() => {
    if (!searchQuery) return tables;
    const q = searchQuery.toLowerCase();
    return tables.filter((tbl) =>
      tbl.name?.toLowerCase().includes(q) ||
      tbl.project_name?.toLowerCase().includes(q)
    );
  }, [tables, searchQuery]);

  // Get compatible widget types for a space widget
  const getWidgetCompatibleTypes = useCallback((widget: SpaceWidgetItem): WidgetTypeOption[] => {
    const presetName = widget.preset_name || '';
    return WIDGET_TYPES.filter(wt => wt.compatibleWith.includes(presetName));
  }, []);

  // Determine right-panel widget types based on selection
  const compatibleTypes = useMemo(() => {
    if (!selected) return [];
    if (selected.kind === 'table') return getCompatibleTypesForTable(selected.data);
    return getWidgetCompatibleTypes(selected.data);
  }, [selected, getWidgetCompatibleTypes]);

  // Selected item display name
  const selectedTitle = selected
    ? (selected.kind === 'widget' ? selected.data.title : selected.data.name) || t('widgets.picker.module')
    : null;

  const handleClose = useCallback(() => {
    setSearchQuery('');
    setSelected(null);
    if (showSpaceSelector) setSelectedSpaceId(0);
    onClose();
  }, [onClose, showSpaceSelector]);

  // Create widget from selected source + widget type
  const handleSelectWidgetType = useCallback(async (widgetType: WidgetTypeOption) => {
    if (!selected) return;

    let tableId: number | null = null;
    let sourceName = 'Untitled';

    if (selected.kind === 'table') {
      tableId = selected.data.table_id;
      sourceName = selected.data.name;
    } else {
      tableId = ((selected.data.config as Record<string, unknown>)?.table_id as number) || null;
      sourceName = selected.data.title || 'Untitled';
    }

    // tickets_list from a Tickets-table context (ADR-0012 §Phase 3 / ticket #131117):
    // build the standalone preset config — no registry_table_id, scope by table.
    const isTicketsListFromTable = widgetType.id === 'tickets_list' && selected.kind === 'table';

    const config: Record<string, unknown> = isTicketsListFromTable
      ? {
          preset: 'tickets-list',
          mode: 'full',
          tickets_table_id: tableId,
        }
      : {
          table_id: tableId,
          ...(selected.kind === 'widget' && selected.data.preset_name === widgetType.id && selected.data.config
            ? { column_mapping: (selected.data.config as Record<string, unknown>).column_mapping }
            : {}),
        };

    const sharedFields = {
      widget_type: 'preset' as const,
      preset_name: widgetType.id as PresetWidgetName,
      title: `${t(widgetType.nameKey as Parameters<typeof t>[0])}: ${sourceName}`,
      config,
      position: {
        x: 0,
        y: 1000,
        w: widgetType.defaultSize.w,
        h: widgetType.defaultSize.h,
      },
    };

    try {
      if (embedMode !== 'dashboard') {
        if (!ownerKind || ownerId == null) {
          logger.error('[AddWidgetModal] embedMode set but ownerKind/ownerId missing');
          return;
        }
        const payload: CreateWidgetByOwnerRequest = {
          owner_kind: ownerKind,
          owner_id: ownerId,
          ...sharedFields,
        };
        const created = await createWidgetByOwner(payload);
        onWidgetCreated?.(created);
      } else {
        const widgetData: CreateWidgetRequest = {
          dashboard_id: dashboardId,
          ...sharedFields,
        };
        const created = await createWidgetMutation.mutateAsync(widgetData);
        queryClient.invalidateQueries({ queryKey: widgetKeys.list(dashboardId) });
        onWidgetCreated?.(created);
      }
      handleClose();
    } catch (err) {
      logger.error('Failed to create widget:', err);
    }
  }, [selected, dashboardId, embedMode, ownerKind, ownerId, createWidgetMutation, queryClient, onWidgetCreated, handleClose, t]);

  const getModuleIcon = (presetName: string | null, icon: string | null) => {
    const style = presetName ? moduleIconStyles[presetName] : null;
    if (style) {
      const IconComponent = style.icon;
      return (
        <div className={`w-8 h-8 ${style.bg} rounded-lg flex items-center justify-center flex-shrink-0`}>
          <IconComponent className="w-4 h-4 text-white" />
        </div>
      );
    }
    return (
      <div className="w-8 h-8 bg-[var(--bg-tertiary)] rounded-lg flex items-center justify-center flex-shrink-0 text-base">
        {icon || '📊'}
      </div>
    );
  };

  const isWidgetSelected = (widgetId: number) =>
    selected?.kind === 'widget' && selected.data.widget_id === widgetId;

  const isTableSelected = (tableId: number) =>
    selected?.kind === 'table' && selected.data.table_id === tableId;

  const totalCount = filteredWidgets.length + filteredTables.length;

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => { if (!open) handleClose(); }}
      title={t('widgets.picker.title')}
      description={t('widgets.picker.description')}
      size="xl"
      fixedHeight
      heightOffset={200}
      footer={
        <div className="flex-1 text-xs text-[var(--text-tertiary)]">
          {totalCount} {t('widgets.picker.available')}
        </div>
      }
      secondaryAction={{
        label: t('widgets.picker.cancel'),
        variant: 'ghost',
        onClick: handleClose,
      }}
    >
      {/* Wrapper: flex column fills modal content area */}
      <div className="flex flex-col h-full min-h-0">
        {/* Space selector — shown when adding from home/Quick Access */}
        {showSpaceSelector && spaces.length > 0 && (
          <div className="mb-3 flex-shrink-0">
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {spaces.map((space) => (
                <button
                  key={space.id}
                  onClick={() => {
                    setSelectedSpaceId(space.id);
                    setSelected(null);
                    setSearchQuery('');
                  }}
                  className={cn(
                    'flex-shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-all whitespace-nowrap',
                    spaceId === space.id
                      ? 'bg-primary-500/20 text-primary-400 ring-1 ring-primary-500/50'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                  )}
                >
                  {space.icon || '📁'} {space.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Search — fixed at top */}
        <div className="relative mb-4 flex-shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
          <input
            type="text"
            placeholder={t('widgets.picker.searchAll')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-primary-500/30"
          />
        </div>

        {/* Two columns — each scrolls independently */}
        <div className="flex gap-4 min-h-0 flex-1 overflow-hidden">
          {/* Left: Modules + Tables */}
          <div className="w-1/2 overflow-y-auto pr-2">

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
            </div>
          ) : error ? (
            <div className="text-sm text-red-400 py-4">
              {t('widgets.picker.loadError')}
            </div>
          ) : (
            <>
              {/* Widgets / Modules section */}
              {filteredWidgets.length > 0 && (
                <>
                  <h3 className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
                    {t('widgets.picker.modulesInSpace')}
                  </h3>
                  <div className="space-y-1 mb-4">
                    {filteredWidgets.map((mod) => {
                      const hasTypes = getWidgetCompatibleTypes(mod).length > 0;
                      const isSel = isWidgetSelected(mod.widget_id);
                      return (
                        <button
                          key={`w-${mod.widget_id}`}
                          onClick={() => setSelected(isSel ? null : { kind: 'widget', data: mod })}
                          disabled={!hasTypes}
                          className={cn(
                            'w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all',
                            isSel
                              ? 'bg-primary-500/20 ring-1 ring-primary-500/50'
                              : 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)]',
                            !hasTypes && 'opacity-50 cursor-not-allowed'
                          )}
                        >
                          {getModuleIcon(mod.preset_name, mod.icon)}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-[var(--text-primary)] truncate">
                              {mod.title || mod.preset_name || 'Untitled'}
                            </div>
                            <div className="text-xs text-[var(--text-tertiary)]">
                              {mod.project_name} {mod.is_module && `· ${t('widgets.picker.module')}`}
                            </div>
                          </div>
                          {hasTypes && (
                            <ChevronRight className={cn(
                              'w-4 h-4 text-[var(--text-tertiary)] transition-transform',
                              isSel && 'rotate-90'
                            )} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Tables section */}
              {filteredTables.length > 0 && (
                <>
                  <h3 className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
                    {t('widgets.picker.tablesInSpace')}
                  </h3>
                  <div className="space-y-1">
                    {filteredTables.map((tbl) => {
                      const isSel = isTableSelected(tbl.table_id);
                      return (
                        <button
                          key={`t-${tbl.table_id}`}
                          onClick={() => setSelected(isSel ? null : { kind: 'table', data: tbl })}
                          className={cn(
                            'w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all',
                            isSel
                              ? 'bg-primary-500/20 ring-1 ring-primary-500/50'
                              : 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)]'
                          )}
                        >
                          <div className="w-8 h-8 bg-purple-600/20 rounded-lg flex items-center justify-center flex-shrink-0 text-base">
                            {tbl.icon || <Database className="w-4 h-4 text-purple-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-[var(--text-primary)] truncate">
                              {tbl.name}
                            </div>
                            <div className="text-xs text-[var(--text-tertiary)]">
                              {tbl.project_name}
                              {tbl.row_count > 0 && ` · ${tbl.row_count} ${t('widgets.picker.rows')}`}
                            </div>
                          </div>
                          <ChevronRight className={cn(
                            'w-4 h-4 text-[var(--text-tertiary)] transition-transform',
                            isSel && 'rotate-90'
                          )} />
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {filteredWidgets.length === 0 && filteredTables.length === 0 && (
                <div className="text-sm text-[var(--text-tertiary)] py-4">
                  {searchQuery ? t('widgets.picker.noModulesFound') : t('widgets.picker.noModulesInSpace')}
                </div>
              )}
            </>
          )}
        </div>

        {/* Right: Widget types for selected source */}
        <div className="w-1/2 overflow-y-auto pl-2 border-l border-[var(--border-primary)]">
          <h3 className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider mb-3">
            {selectedTitle
              ? `${t('widgets.picker.widgetsFor')} "${selectedTitle}"`
              : t('widgets.picker.selectModule')}
          </h3>

          {selected ? (
            <div className="grid grid-cols-2 gap-2">
              {compatibleTypes.map((wt) => (
                <button
                  key={wt.id}
                  onClick={() => handleSelectWidgetType(wt)}
                  disabled={createWidgetMutation.isPending}
                  className={cn(
                    'p-3 rounded-lg text-left transition-all',
                    'bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)]',
                    'border border-transparent hover:border-primary-500/30',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                >
                  <div className={`w-8 h-8 ${wt.color} rounded-lg flex items-center justify-center mb-2`}>
                    {wt.icon}
                  </div>
                  <div className="font-medium text-sm text-[var(--text-primary)]">
                    {t(wt.nameKey as Parameters<typeof t>[0])}
                  </div>
                  <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                    {t(wt.descKey as Parameters<typeof t>[0])}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-48 text-sm text-[var(--text-tertiary)]">
              {t('widgets.picker.selectModuleHint')}
            </div>
          )}

          {createWidgetMutation.isPending && (
            <div className="mt-4 flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('widgets.picker.creating')}
            </div>
          )}
        </div>
      </div>
      </div>
    </Modal>
  );
}
