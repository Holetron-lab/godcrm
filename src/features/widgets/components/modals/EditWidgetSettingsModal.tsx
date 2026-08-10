import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { logger } from '@/shared/utils/logger';
import { X, Save, Plus, Trash2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useUpdateWidget } from '../../hooks/useWidgets';
import { useTablesStore } from '@/features/tables/store/tablesStore';
import { useSpaces } from '@/features/spaces/store/spacesStore';
import { useProjectStore } from '@/features/projects/store/projectStore';
import { useDataSource } from '@/features/data-sources/hooks/useDataSources';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { EmojiPicker } from '@/features/tables/components/UniversalTable/EmojiPicker';
import type { Widget, WidgetConfig } from '../../types/widget.types';
import type { ColumnModel } from '@/features/tables/types/table.types';
import { PresetSettingsRouter } from './widget-settings';
import { readDocumentsConfigFromWidget } from './widget-settings/documentsConfigRead';
import {
  createHandleCreatePresetColumn,
  createHandleCreateCalendarTable,
  createHandleCreateDocumentsTables,
  createHandleCreateTicketsTable,
  createHandleTicketsTableChange,
  createHandleSave,
} from './widget-settings/useWidgetSettingsHandlers';

interface EditWidgetSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  widget: Widget;
  onSaved?: () => void;
}

export function EditWidgetSettingsModal({
  isOpen,
  onClose,
  widget,
  onSaved
}: EditWidgetSettingsModalProps) {
  const storeTables = useTablesStore(state => state.tables);
  const spaces = useSpaces();
  const projects = useProjectStore(state => state.projects);
  const updateWidgetMutation = useUpdateWidget();
  
  // Fetch tables from API
  const { data: apiTables } = useQuery({
    queryKey: ['tables-for-widget-settings'],
    queryFn: async () => {
      const result = await tablesApi.listTables();
      return result.tables;
    },
    enabled: isOpen,
    staleTime: 30000,
  });
  
  // Use API tables if available, otherwise fallback to store
  const tables = apiTables && apiTables.length > 0 ? apiTables : storeTables;
  
  // Form state
  const [title, setTitle] = useState(widget.title);
  const [description, setDescription] = useState(widget.description || '');
  const [icon, setIcon] = useState(widget.icon || '📊');
  const [selectedTableId, setSelectedTableId] = useState<string>(
    widget.config?.table_id?.toString() || ''
  );
  const [columns, setColumns] = useState<ColumnModel[]>([]);
  const [loadingColumns, setLoadingColumns] = useState(false);
  
  // Get linked table info
  const linkedTable = useMemo(() => 
    tables.find(t => String(t.id) === selectedTableId),
    [tables, selectedTableId]
  );
  
  const linkedProject = useMemo(() => 
    linkedTable?.projectId ? projects.find(p => p.id === linkedTable.projectId) : null,
    [linkedTable, projects]
  );
  
  const linkedSpace = useMemo(() => {
    if (!linkedProject?.space_id) return null;
    return spaces.find(s => s.id === linkedProject.space_id);
  }, [linkedProject, spaces]);
  
  // Get data source for external tables
  const { dataSource: linkedDataSource } = useDataSource(linkedTable?.data_source_id || '');
  
  // Kanban-specific config
  const [statusColumn, setStatusColumn] = useState(widget.config?.group_by_column || widget.config?.statusColumn || '');
  const [titleColumn, setTitleColumn] = useState(widget.config?.card_title_column || widget.config?.titleColumn || '');
  const [descriptionColumn, setDescriptionColumn] = useState(widget.config?.card_subtitle_column || widget.config?.descriptionColumn || '');
  const [assigneeColumn, setAssigneeColumn] = useState(widget.config?.kanban?.assigneeColumn || '');
  const [scheduledDateColumn, setScheduledDateColumn] = useState(widget.config?.kanban?.scheduledDateColumn || '');
  const [dueDateColumn, setDueDateColumn] = useState(widget.config?.kanban?.dueDateColumn || '');
  const [colorColumn, setColorColumn] = useState(widget.config?.kanban?.colorColumn || '');
  
  // Visible columns for card preview (on card)
  const [cardColumns, setCardColumns] = useState<string[]>(
    widget.config?.card_columns || []
  );
  
  // Visible columns for expanded view (on expand)
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    widget.config?.visible_columns || []
  );
  
  // Create column state
  const [creatingColumn, setCreatingColumn] = useState(false);
  
  // Calendar-specific config
  const [dateColumn, setDateColumn] = useState(widget.config?.calendar?.dateColumn || '');
  const [calendarEndDateColumn, setCalendarEndDateColumn] = useState(widget.config?.calendar?.endDateColumn || '');
  const [calendarTitleColumn, setCalendarTitleColumn] = useState(widget.config?.calendar?.titleColumn || '');
  const [calendarDescriptionColumn, setCalendarDescriptionColumn] = useState(widget.config?.calendar?.descriptionColumn || '');
  const [calendarColorColumn, setCalendarColorColumn] = useState(widget.config?.calendar?.colorColumn || '');
  
  // Timeline-specific config
  const [startDateColumn, setStartDateColumn] = useState(widget.config?.timeline?.startDateColumn || '');
  const [endDateColumn, setEndDateColumn] = useState(widget.config?.timeline?.endDateColumn || '');
  const [timelineTitleColumn, setTimelineTitleColumn] = useState(widget.config?.timeline?.titleColumn || '');
  const [timelineDescriptionColumn, setTimelineDescriptionColumn] = useState(widget.config?.timeline?.descriptionColumn || '');
  const [timelineDependsOnColumn, setTimelineDependsOnColumn] = useState(widget.config?.timeline?.dependsOnColumn || '');
  const [timelineGroupByColumn, setTimelineGroupByColumn] = useState(widget.config?.timeline?.groupByColumn || '');
  
  // Timeline calendar table config (for holidays/weekends)
  const [timelineCalendarProjectId, setTimelineCalendarProjectId] = useState(widget.config?.timeline?.calendarProjectId || '');
  const [timelineCalendarTableId, setTimelineCalendarTableId] = useState(widget.config?.timeline?.calendarTableId || '');
  const [timelineCalendarDateColumn, setTimelineCalendarDateColumn] = useState(widget.config?.timeline?.calendarDateColumn || 'date');
  const [timelineCalendarTypeColumn, setTimelineCalendarTypeColumn] = useState(widget.config?.timeline?.calendarTypeColumn || 'day_type');
  const [timelineCalendarTagsColumn, setTimelineCalendarTagsColumn] = useState(widget.config?.timeline?.calendarTagsColumn || 'tags');
  const [timelineCalendarNoteColumn, setTimelineCalendarNoteColumn] = useState(widget.config?.timeline?.calendarNoteColumn || 'note');
  const [timelineCalendarBgColorColumn, setTimelineCalendarBgColorColumn] = useState(widget.config?.timeline?.calendarBgColorColumn || 'bg_color');
  const [timelineCalendarFontColorColumn, setTimelineCalendarFontColorColumn] = useState(widget.config?.timeline?.calendarFontColorColumn || 'font_color');
  const [creatingCalendarTable, setCreatingCalendarTable] = useState(false);

  // Get System Data project for the current space (for calendar table)
  const systemDataProject = useMemo(() => {
    if (!linkedSpace) return null;
    return projects.find(p => 
      p.space_id === linkedSpace.id && 
      (p.type === 'system_data' || p.name?.toLowerCase().includes('system data'))
    );
  }, [linkedSpace, projects]);
  
  // Tables filtered by selected calendar project (or auto-selected System Data)
  const calendarProjectTables = useMemo(() => {
    const projectId = timelineCalendarProjectId || (systemDataProject ? String(systemDataProject.id) : '');
    if (!projectId) return [];
    return tables.filter(t => String(t.projectId) === projectId);
  }, [tables, timelineCalendarProjectId, systemDataProject]);
  
  // Projects in the current space (for calendar project selection)
  const spaceProjects = useMemo(() => {
    if (!linkedSpace) return [];
    return projects.filter(p => p.space_id === linkedSpace.id);
  }, [linkedSpace, projects]);

  // AI Agents-specific config
  const [aiOperatorsTableId, setAiOperatorsTableId] = useState(widget.config?.operators_table_id?.toString() || '');
  const [aiAgentsTableId, setAiAgentsTableId] = useState(widget.config?.agents_table_id?.toString() || '');
  const [aiChatHistoryTableId, setAiChatHistoryTableId] = useState(widget.config?.chat_history_table_id?.toString() || '');
  const [aiRunLogsTableId, setAiRunLogsTableId] = useState(widget.config?.run_logs_table_id?.toString() || '');
  const [aiAnalyticsTableId, setAiAnalyticsTableId] = useState(widget.config?.analytics_table_id?.toString() || '');
  const [aiFeedbackTableId, setAiFeedbackTableId] = useState(widget.config?.feedback_table_id?.toString() || '');

  // Documents-specific config (ADR-0067 P2: canonical-first read, legacy fallback)
  const initialDocsRead = readDocumentsConfigFromWidget(widget.config);
  const [documentsTableId, setDocumentsTableId] = useState(initialDocsRead.documentsTableId);
  const [sectionsTableId, setSectionsTableId] = useState(initialDocsRead.sectionsTableId);
  const [documentsSpaceId, setDocumentsSpaceId] = useState(widget.config?.documents_space_id?.toString() || '');
  const [documentsProjectId, setDocumentsProjectId] = useState(initialDocsRead.documentsProjectId);
  const [creatingDocumentsTables, setCreatingDocumentsTables] = useState(false);

  // Task List-specific config (shared with Kanban via titleColumn/descriptionColumn/etc.)
  // Re-uses: titleColumn → card_title_column, descriptionColumn → card_subtitle_column,
  // scheduledDateColumn, dueDateColumn, colorColumn, cardColumns, visibleColumns.
  // Adds: completed column + BDD-mode config.
  const [taskCompletedColumn, setTaskCompletedColumn] = useState(
    widget.config?.completed_column || widget.config?.status_column || ''
  );
  const [bddMode, setBddMode] = useState<boolean>(widget.config?.bdd_mode === true);
  const [bddCodeColumn, setBddCodeColumn] = useState(
    (widget.config?.bdd_code_column as string) || 'code'
  );
  const [bddPriorityColumn, setBddPriorityColumn] = useState(
    (widget.config?.bdd_priority_column as string) || 'priority'
  );
  const [bddStatusColumn, setBddStatusColumn] = useState(
    (widget.config?.bdd_status_column as string) || 'status'
  );

  // Tickets config
  const [ticketsTableId, setTicketsTableId] = useState(widget.config?.ticket_binding?.table_id?.toString() || '');
  const [ticketsColTitle, setTicketsColTitle] = useState(widget.config?.ticket_binding?.columns?.title || '');
  const [ticketsColDesc, setTicketsColDesc] = useState(widget.config?.ticket_binding?.columns?.description || '');
  const [ticketsColType, setTicketsColType] = useState(widget.config?.ticket_binding?.columns?.type || '');
  const [ticketsColState, setTicketsColState] = useState(widget.config?.ticket_binding?.columns?.state || '');
  const [ticketsColPriority, setTicketsColPriority] = useState(widget.config?.ticket_binding?.columns?.priority || '');
  const [creatingTicketsTable, setCreatingTicketsTable] = useState(false);

  // Documents filtered projects and tables
  const documentsSpaceProjects = useMemo(() => {
    if (!documentsSpaceId) return [];
    return projects.filter(p => String(p.space_id) === documentsSpaceId);
  }, [documentsSpaceId, projects]);

  const documentsProjectTables = useMemo(() => {
    if (!documentsProjectId) return [];
    return tables.filter(t => String(t.projectId) === documentsProjectId);
  }, [documentsProjectId, tables]);

  // Reset form when widget changes
  useEffect(() => {
    if (widget) {
      setTitle(widget.title);
      setDescription(widget.description || '');
      setIcon(widget.icon || '📊');
      setSelectedTableId(widget.config?.table_id?.toString() || '');
      setStatusColumn(widget.config?.group_by_column || widget.config?.statusColumn || '');
      setTitleColumn(widget.config?.card_title_column || widget.config?.titleColumn || '');
      setDescriptionColumn(widget.config?.card_subtitle_column || widget.config?.descriptionColumn || '');
      setAssigneeColumn(widget.config?.kanban?.assigneeColumn || '');
      setScheduledDateColumn(widget.config?.kanban?.scheduledDateColumn || '');
      setDueDateColumn(widget.config?.kanban?.dueDateColumn || '');
      setColorColumn(widget.config?.kanban?.colorColumn || '');
      setCardColumns(widget.config?.card_columns || []);
      setVisibleColumns(widget.config?.visible_columns || []);
      setDateColumn(widget.config?.calendar?.dateColumn || '');
      setCalendarEndDateColumn(widget.config?.calendar?.endDateColumn || '');
      setCalendarTitleColumn(widget.config?.calendar?.titleColumn || '');
      setCalendarDescriptionColumn(widget.config?.calendar?.descriptionColumn || '');
      setCalendarColorColumn(widget.config?.calendar?.colorColumn || '');
      setStartDateColumn(widget.config?.timeline?.startDateColumn || '');
      setEndDateColumn(widget.config?.timeline?.endDateColumn || '');
      setTimelineTitleColumn(widget.config?.timeline?.titleColumn || '');
      setTimelineDescriptionColumn(widget.config?.timeline?.descriptionColumn || '');
      setTimelineDependsOnColumn(widget.config?.timeline?.dependsOnColumn || '');
      setTimelineGroupByColumn(widget.config?.timeline?.groupByColumn || '');
      setTimelineCalendarProjectId(widget.config?.timeline?.calendarProjectId || '');
      setTimelineCalendarTableId(widget.config?.timeline?.calendarTableId || '');
      setTimelineCalendarDateColumn(widget.config?.timeline?.calendarDateColumn || 'date');
      setTimelineCalendarTypeColumn(widget.config?.timeline?.calendarTypeColumn || 'day_type');
      setTimelineCalendarTagsColumn(widget.config?.timeline?.calendarTagsColumn || 'tags');
      setTimelineCalendarNoteColumn(widget.config?.timeline?.calendarNoteColumn || 'note');
      setTimelineCalendarBgColorColumn(widget.config?.timeline?.calendarBgColorColumn || 'bg_color');
      setTimelineCalendarFontColorColumn(widget.config?.timeline?.calendarFontColorColumn || 'font_color');
      // AI Agents
      setAiOperatorsTableId(widget.config?.operators_table_id?.toString() || '');
      setAiAgentsTableId(widget.config?.agents_table_id?.toString() || '');
      setAiChatHistoryTableId(widget.config?.chat_history_table_id?.toString() || '');
      setAiRunLogsTableId(widget.config?.run_logs_table_id?.toString() || '');
      setAiAnalyticsTableId(widget.config?.analytics_table_id?.toString() || '');
      setAiFeedbackTableId(widget.config?.feedback_table_id?.toString() || '');
      // Documents (ADR-0067 P2: canonical-first read, legacy fallback)
      const docsRead = readDocumentsConfigFromWidget(widget.config);
      setDocumentsTableId(docsRead.documentsTableId);
      setSectionsTableId(docsRead.sectionsTableId);
      setDocumentsSpaceId(widget.config?.documents_space_id?.toString() || '');
      setDocumentsProjectId(docsRead.documentsProjectId);
      // Task List
      setTaskCompletedColumn(widget.config?.completed_column || widget.config?.status_column || '');
      setBddMode(widget.config?.bdd_mode === true);
      setBddCodeColumn((widget.config?.bdd_code_column as string) || 'code');
      setBddPriorityColumn((widget.config?.bdd_priority_column as string) || 'priority');
      setBddStatusColumn((widget.config?.bdd_status_column as string) || 'status');
    }
  }, [widget]);

  // Load columns when table changes
  useEffect(() => {
    if (selectedTableId) {
      setLoadingColumns(true);
      tablesApi.getColumns(selectedTableId)
        .then(cols => setColumns(Array.isArray(cols) ? cols : []))
        .catch(err => logger.error('Widget settings error:', err))
        .finally(() => setLoadingColumns(false));
    } else {
      setColumns([]);
    }
  }, [selectedTableId]);

  // BDD auto-mapping: when BDD-mode is on and the selected columns don't exist
  // in the loaded table, pick the best-matching column by name.
  useEffect(() => {
    if (!bddMode || columns.length === 0 || widget.preset_name !== 'task_list') return;
    const colNames = new Set(columns.map(c => c.name));
    const pick = (current: string, candidates: string[]) => {
      if (current && colNames.has(current)) return current;
      for (const cand of candidates) {
        if (colNames.has(cand)) return cand;
      }
      // fuzzy: first column whose name contains any candidate
      const fuzzy = columns.find(c =>
        candidates.some(cand => c.name.toLowerCase().includes(cand.toLowerCase())),
      );
      return fuzzy?.name || current;
    };
    const nextStatus = pick(bddStatusColumn, ['status', 'state', 'bdd_status']);
    const nextPriority = pick(bddPriorityColumn, ['priority', 'moscow', 'bdd_priority']);
    const nextCode = pick(bddCodeColumn, ['code', 'key', 'bdd_code', 'ref']);
    const nextTitle = pick(titleColumn, ['title', 'name', 'label']);
    if (nextStatus !== bddStatusColumn) setBddStatusColumn(nextStatus);
    if (nextPriority !== bddPriorityColumn) setBddPriorityColumn(nextPriority);
    if (nextCode !== bddCodeColumn) setBddCodeColumn(nextCode);
    if (nextTitle && nextTitle !== titleColumn) setTitleColumn(nextTitle);
  }, [bddMode, columns, widget.preset_name, bddStatusColumn, bddPriorityColumn, bddCodeColumn, titleColumn]);

  // Ensure columns is always an array
  const safeColumns = Array.isArray(columns) ? columns : [];
  
  // Filter columns by type
  const selectColumns = useMemo(() => 
    safeColumns.filter(c => ['select', 'multi-select'].includes(c.type)),
    [safeColumns]
  );
  
  const textColumns = useMemo(() => 
    safeColumns.filter(c => ['text', 'richText', 'select'].includes(c.type)),
    [safeColumns]
  );
  
  const dateColumns = useMemo(() => 
    safeColumns.filter(c => ['date', 'datetime'].includes(c.type)),
    [safeColumns]
  );
  
  // All columns except system ones
  const allDisplayableColumns = useMemo(() => 
    safeColumns.filter(c => !['id', 'created_at', 'updated_at'].includes(c.name)),
    [safeColumns]
  );
  
  // Available columns for adding to card preview (not already selected)
  const availableCardColumns = useMemo(() => 
    allDisplayableColumns.filter(c => 
      !cardColumns.includes(c.name) && 
      !visibleColumns.includes(c.name) &&
      c.name !== statusColumn && 
      c.name !== titleColumn
    ),
    [allDisplayableColumns, cardColumns, visibleColumns, statusColumn, titleColumn]
  );
  
  // Available columns for adding to expanded view (not already selected)
  const availableExpandedColumns = useMemo(() => 
    allDisplayableColumns.filter(c => 
      !cardColumns.includes(c.name) && 
      !visibleColumns.includes(c.name) &&
      c.name !== statusColumn && 
      c.name !== titleColumn
    ),
    [allDisplayableColumns, cardColumns, visibleColumns, statusColumn, titleColumn]
  );

  if (!isOpen) return null;

  const handleCreatePresetColumn = createHandleCreatePresetColumn({
    selectedTableId,
    setCreatingColumn,
    setColumns,
    setColorColumn,
    setStatusColumn,
    setTimelineDependsOnColumn,
    setTimelineGroupByColumn,
  });

  const handleCreateCalendarTable = createHandleCreateCalendarTable({
    timelineCalendarProjectId,
    systemDataProject,
    setCreatingCalendarTable,
    setTimelineCalendarTableId,
  });

  const handleCreateDocumentsTables = createHandleCreateDocumentsTables({
    documentsSpaceId,
    documentsProjectId,
    projects,
    setDocumentsProjectId,
    setCreatingDocumentsTables,
    setSectionsTableId,
    setDocumentsTableId,
  });

  const handleCreateTicketsTable = createHandleCreateTicketsTable({
    documentsProjectId,
    setCreatingTicketsTable,
    setTicketsTableId,
    setTicketsColTitle,
    setTicketsColDesc,
    setTicketsColType,
    setTicketsColState,
    setTicketsColPriority,
  });

  const handleTicketsTableChange = createHandleTicketsTableChange({
    setTicketsTableId,
    setTicketsColTitle,
    setTicketsColDesc,
    setTicketsColType,
    setTicketsColState,
    setTicketsColPriority,
  });

  const handleSave = createHandleSave({
    widget,
    title,
    description,
    icon,
    selectedTableId,
    cardColumns,
    visibleColumns,
    statusColumn,
    titleColumn,
    descriptionColumn,
    assigneeColumn,
    scheduledDateColumn,
    dueDateColumn,
    colorColumn,
    taskCompletedColumn,
    bddMode,
    bddCodeColumn,
    bddPriorityColumn,
    bddStatusColumn,
    dateColumn,
    calendarEndDateColumn,
    calendarTitleColumn,
    calendarDescriptionColumn,
    calendarColorColumn,
    startDateColumn,
    endDateColumn,
    timelineTitleColumn,
    timelineDescriptionColumn,
    timelineDependsOnColumn,
    timelineGroupByColumn,
    timelineCalendarTableId,
    timelineCalendarDateColumn,
    timelineCalendarTypeColumn,
    timelineCalendarTagsColumn,
    timelineCalendarNoteColumn,
    timelineCalendarBgColorColumn,
    timelineCalendarFontColorColumn,
    aiOperatorsTableId,
    aiAgentsTableId,
    aiChatHistoryTableId,
    aiRunLogsTableId,
    aiAnalyticsTableId,
    aiFeedbackTableId,
    documentsTableId,
    sectionsTableId,
    documentsSpaceId,
    documentsProjectId,
    ticketsTableId,
    ticketsColTitle,
    ticketsColDesc,
    ticketsColType,
    ticketsColState,
    ticketsColPriority,
    updateWidgetMutation,
    onSaved,
    onClose,
  });



  const getPresetLabel = () => {
    switch (widget.preset_name) {
      case 'kanban_board':
        return 'Канбан доска';
      case 'calendar_widget':
        return 'Календарь';
      case 'timeline_widget':
        return 'Таймлайн';
      case 'table_view':
        return 'Таблица';
      case 'chart_widget':
        return 'Диаграмма';
      case 'ai_agents':
        return 'AI Agents';
      case 'documents':
        return 'Documents';
      case 'task_list':
        return 'Task List';
      default:
        return widget.preset_name || 'Виджет';
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
      <div className="bg-[var(--bg-secondary)] rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-primary)] flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">
              Настройки виджета
            </h2>
            <p className="text-sm text-[var(--text-tertiary)]">
              {getPresetLabel()} • {widget.icon}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[var(--bg-tertiary)] rounded-lg transition"
          >
            <X className="w-5 h-5 text-[var(--text-tertiary)]" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex-1 overflow-y-auto space-y-4">
          {/* Title and Emoji in row */}
          <div className="flex gap-4">
            {/* Emoji Picker */}
            <div className="w-24 flex-shrink-0">
              <EmojiPicker 
                value={icon} 
                onChange={setIcon} 
                compact 
              />
            </div>
            
            {/* Title */}
            <div className="flex-1">
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                Название виджета
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
                placeholder="Введите название..."
              />
            </div>
          </div>
          
          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
              Описание
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] resize-none"
              placeholder="Описание виджета (необязательно)..."
              rows={2}
            />
          </div>

          {/* Table Info - read only with full path (hidden for ai_agents) */}
          {selectedTableId && linkedTable && widget.preset_name !== 'ai_agents' && (
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                Таблица данных
              </label>
              <div className="w-full px-3 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)]">
                {/* Breadcrumb path */}
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  {/* Space */}
                  {linkedSpace && (
                    <>
                      <span className="flex items-center gap-1 font-medium text-[var(--text-primary)]">
                        <span>{linkedSpace.icon || '⚙️'}</span>
                        {linkedSpace.name}
                      </span>
                      <span className="text-[var(--text-tertiary)]">/</span>
                    </>
                  )}
                  
                  {/* Project */}
                  {linkedProject && (
                    <>
                      <span className="flex items-center gap-1 font-medium text-[var(--text-secondary)]">
                        <span>{linkedProject.icon || linkedProject.logo || '📊'}</span>
                        {linkedProject.name}
                      </span>
                      <span className="text-[var(--text-tertiary)]">/</span>
                    </>
                  )}
                  
                  {/* Table */}
                  <span className="flex items-center gap-1 font-medium text-[var(--text-secondary)]">
                    <span>📋</span>
                    {linkedTable.displayName || linkedTable.name}
                  </span>
                </div>
                
                {/* Data source info */}
                {linkedTable.source_table_name && linkedDataSource && (
                  <div className="text-xs text-[var(--text-tertiary)] mt-1.5 flex items-center gap-1">
                    <span>🔗</span>
                    {linkedDataSource.name} → {linkedTable.source_table_name}
                  </div>
                )}
                {linkedTable.is_system && linkedTable.sync_target && !linkedTable.source_table_name && (
                  <div className="text-xs text-[var(--text-tertiary)] mt-1.5 flex items-center gap-1">
                    <span>🔗</span>
                    Internal CRM Database → {linkedTable.sync_target}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Preset-specific config */}
          {(selectedTableId || widget.preset_name === 'ai_agents') && (
            <PresetSettingsRouter
              widget={widget}
              kanbanProps={{
                safeColumns, selectColumns, textColumns, dateColumns, allDisplayableColumns,
                loadingColumns, creatingColumn, handleCreatePresetColumn,
                statusColumn, setStatusColumn, titleColumn, setTitleColumn,
                descriptionColumn, setDescriptionColumn, assigneeColumn, setAssigneeColumn,
                scheduledDateColumn, setScheduledDateColumn, dueDateColumn, setDueDateColumn,
                colorColumn, setColorColumn, cardColumns, setCardColumns,
                visibleColumns, setVisibleColumns, availableCardColumns, availableExpandedColumns,
              }}
              calendarProps={{
                safeColumns, selectColumns, textColumns, dateColumns, allDisplayableColumns,
                loadingColumns, creatingColumn, handleCreatePresetColumn,
                dateColumn, setDateColumn,
                calendarEndDateColumn, setCalendarEndDateColumn,
                calendarTitleColumn, setCalendarTitleColumn,
                calendarDescriptionColumn, setCalendarDescriptionColumn,
                calendarColorColumn, setCalendarColorColumn,
              }}
              timelineProps={{
                safeColumns, selectColumns, textColumns, dateColumns, allDisplayableColumns,
                loadingColumns, creatingColumn, handleCreatePresetColumn,
                startDateColumn, setStartDateColumn, endDateColumn, setEndDateColumn,
                timelineTitleColumn, setTimelineTitleColumn,
                timelineDescriptionColumn, setTimelineDescriptionColumn,
                timelineDependsOnColumn, setTimelineDependsOnColumn,
                timelineGroupByColumn, setTimelineGroupByColumn,
                timelineCalendarProjectId, setTimelineCalendarProjectId,
                timelineCalendarTableId, setTimelineCalendarTableId,
                timelineCalendarDateColumn, setTimelineCalendarDateColumn,
                timelineCalendarTypeColumn, setTimelineCalendarTypeColumn,
                timelineCalendarTagsColumn, setTimelineCalendarTagsColumn,
                timelineCalendarNoteColumn, setTimelineCalendarNoteColumn,
                timelineCalendarBgColorColumn, setTimelineCalendarBgColorColumn,
                timelineCalendarFontColorColumn, setTimelineCalendarFontColorColumn,
                creatingCalendarTable, handleCreateCalendarTable,
                spaceProjects, calendarProjectTables,
                systemDataProject: systemDataProject ?? null,
              }}
              aiAgentsProps={{
                tables,
                aiOperatorsTableId, setAiOperatorsTableId,
                aiAgentsTableId, setAiAgentsTableId,
                aiChatHistoryTableId, setAiChatHistoryTableId,
                aiRunLogsTableId, setAiRunLogsTableId,
                aiAnalyticsTableId, setAiAnalyticsTableId,
                aiFeedbackTableId, setAiFeedbackTableId,
              }}
              documentsProps={{
                spaces,
                documentsSpaceId, setDocumentsSpaceId,
                documentsProjectId, setDocumentsProjectId,
                documentsTableId, setDocumentsTableId,
                sectionsTableId, setSectionsTableId,
                documentsSpaceProjects, documentsProjectTables,
                creatingDocumentsTables, handleCreateDocumentsTables,
                ticketsTableId, setTicketsTableId,
                ticketsColTitle, setTicketsColTitle,
                ticketsColDesc, setTicketsColDesc,
                ticketsColType, setTicketsColType,
                ticketsColState, setTicketsColState,
                ticketsColPriority, setTicketsColPriority,
                creatingTicketsTable, handleCreateTicketsTable,
                handleTicketsTableChange,
              }}
              taskListProps={{
                textColumns, dateColumns, selectColumns, allDisplayableColumns, loadingColumns,
                titleColumn, setTitleColumn,
                descriptionColumn, setDescriptionColumn,
                taskCompletedColumn, setTaskCompletedColumn,
                scheduledDateColumn, setScheduledDateColumn,
                dueDateColumn, setDueDateColumn,
                colorColumn, setColorColumn,
                bddMode, setBddMode,
                bddStatusColumn, setBddStatusColumn,
                bddPriorityColumn, setBddPriorityColumn,
                bddCodeColumn, setBddCodeColumn,
              }}
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border-primary)] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={updateWidgetMutation.isPending}
            className="px-4 py-2 bg-[var(--color-primary-500)] text-white rounded-lg hover:bg-[var(--color-primary-600)] disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
          >
            {updateWidgetMutation.isPending ? (
              'Сохранение...'
            ) : (
              <>
                <Save className="w-4 h-4" />
                Сохранить
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
