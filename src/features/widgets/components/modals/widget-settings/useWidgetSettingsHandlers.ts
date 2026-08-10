import { logger } from '@/shared/utils/logger';
import { tablesApi } from '@/features/tables/api/tablesApi';
import type { ColumnModel } from '@/features/tables/types/table.types';
import type { Widget, WidgetConfig } from '../../../types/widget.types';

interface PresetColumnHandlerDeps {
  selectedTableId: string;
  setCreatingColumn: (v: boolean) => void;
  setColumns: (cols: ColumnModel[]) => void;
  setColorColumn: (v: string) => void;
  setStatusColumn: (v: string) => void;
  setTimelineDependsOnColumn: (v: string) => void;
  setTimelineGroupByColumn: (v: string) => void;
}

// Default color options for color column
const defaultColorOptions = [
  { value: 'red', label: 'Red', color: '#ef4444' },
  { value: 'orange', label: 'Orange', color: '#f97316' },
  { value: 'yellow', label: 'Yellow', color: '#eab308' },
  { value: 'green', label: 'Green', color: '#22c55e' },
  { value: 'blue', label: 'Blue', color: '#3b82f6' },
  { value: 'purple', label: 'Purple', color: '#a855f7' },
  { value: 'pink', label: 'Pink', color: '#ec4899' },
  { value: 'gray', label: 'Gray', color: '#6b7280' },
];

export function createHandleCreatePresetColumn(deps: PresetColumnHandlerDeps) {
  return async (preset: 'color' | 'priority' | 'status' | 'dependency' | 'flow') => {
    if (!deps.selectedTableId) return;

    deps.setCreatingColumn(true);
    try {
      let columnData: { name: string; displayName: string; type: string; config: Record<string, unknown> };

      switch (preset) {
        case 'color':
          columnData = {
            name: 'color_tag',
            displayName: 'Color',
            type: 'select',
            config: { options: defaultColorOptions }
          };
          break;
        case 'priority':
          columnData = {
            name: 'priority',
            displayName: 'Priority',
            type: 'select',
            config: {
              options: [
                { value: 'urgent', label: '🔴 Urgent', color: '#ef4444' },
                { value: 'high', label: '🟠 High', color: '#f97316' },
                { value: 'medium', label: '🟡 Medium', color: '#eab308' },
                { value: 'low', label: '🟢 Low', color: '#22c55e' },
              ]
            }
          };
          break;
        case 'status':
          columnData = {
            name: 'status',
            displayName: 'Status',
            type: 'select',
            config: {
              options: [
                { value: 'backlog', label: 'Backlog', color: '#6b7280' },
                { value: 'todo', label: 'To Do', color: '#3b82f6' },
                { value: 'in_progress', label: 'In Progress', color: '#f59e0b' },
                { value: 'done', label: 'Done', color: '#22c55e' },
              ]
            }
          };
          break;
        case 'dependency':
          columnData = {
            name: 'depends_on',
            displayName: 'Depends On',
            type: 'text',
            config: {
              placeholder: 'Task IDs separated by comma'
            }
          };
          break;
        case 'flow':
          columnData = {
            name: 'flow',
            displayName: 'Flow',
            type: 'select',
            config: {
              options: [
                { value: 'development', label: '💻 Development', color: '#3b82f6' },
                { value: 'design', label: '🎨 Design', color: '#a855f7' },
                { value: 'testing', label: '🧪 Testing', color: '#22c55e' },
                { value: 'marketing', label: '📢 Marketing', color: '#f97316' },
              ]
            }
          };
          break;
        default:
          throw new Error(`Unknown preset: ${preset}`);
      }

      logger.debug('[handleCreatePresetColumn] Creating column:', columnData);
      await tablesApi.createColumn(deps.selectedTableId, columnData);

      // Reload columns
      const result = await tablesApi.getColumns(deps.selectedTableId);
      deps.setColumns(Array.isArray(result) ? result : result.columns || []);

      // Auto-select the new column
      if (preset === 'color') {
        deps.setColorColumn(columnData.name);
      } else if (preset === 'status') {
        deps.setStatusColumn(columnData.name);
      } else if (preset === 'dependency') {
        deps.setTimelineDependsOnColumn(columnData.name);
      } else if (preset === 'flow') {
        deps.setTimelineGroupByColumn(columnData.name);
      }
    } catch (error) {
      logger.error('Failed to create preset column:', error);
      alert('Ошибка создания колонки: ' + (error as Error).message);
    } finally {
      deps.setCreatingColumn(false);
    }
  };
}

interface CalendarTableHandlerDeps {
  timelineCalendarProjectId: string;
  systemDataProject: { id: number | string } | null;
  setCreatingCalendarTable: (v: boolean) => void;
  setTimelineCalendarTableId: (v: string) => void;
}

export function createHandleCreateCalendarTable(deps: CalendarTableHandlerDeps) {
  return async () => {
    const projectId = deps.timelineCalendarProjectId || (deps.systemDataProject ? String(deps.systemDataProject.id) : '');

    if (!projectId) {
      alert('Сначала выберите проект для таблицы календаря');
      return;
    }

    try {
      deps.setCreatingCalendarTable(true);

      const result = await tablesApi.createCalendarTable(Number(projectId), 'Calendar');

      // Auto-select the new calendar table
      deps.setTimelineCalendarTableId(String(result.tableId));

      alert(`✅ Таблица календаря создана!\nID: ${result.tableId}\nС данными на 2 года вперед.`);
    } catch (error) {
      logger.error('Failed to create calendar table:', error);
      alert('Ошибка создания таблицы календаря: ' + (error as Error).message);
    } finally {
      deps.setCreatingCalendarTable(false);
    }
  };
}

interface DocumentsTablesHandlerDeps {
  documentsSpaceId: string;
  documentsProjectId: string;
  projects: Array<{ id: number | string; space_id?: number | string; type?: string; name?: string }>;
  setDocumentsProjectId: (v: string) => void;
  setCreatingDocumentsTables: (v: boolean) => void;
  setSectionsTableId: (v: string) => void;
  setDocumentsTableId: (v: string) => void;
}

export function createHandleCreateDocumentsTables(deps: DocumentsTablesHandlerDeps) {
  return async () => {
    const spaceId = deps.documentsSpaceId;
    if (!spaceId) {
      alert('Сначала выберите пространство');
      return;
    }

    try {
      deps.setCreatingDocumentsTables(true);

      // Find or create System Data project in selected space
      let projectId = deps.documentsProjectId;
      if (!projectId) {
        const existingProject = deps.projects.find(p =>
          String(p.space_id) === spaceId &&
          (p.type === 'system_data' || p.name?.toLowerCase().includes('system data'))
        );

        if (existingProject) {
          projectId = String(existingProject.id);
        } else {
          const createRes = await fetch('/api/v3/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: 'System Data',
              type: 'system_data',
              icon: '⚙️',
              description: 'System tables for automation',
              space_id: Number(spaceId)
            })
          });
          const createData = await createRes.json();
          projectId = String(createData.data?.id || createData.id);
        }
        deps.setDocumentsProjectId(projectId);
      }

      if (!projectId) {
        throw new Error('Failed to get/create System Data project');
      }

      // Create Document Sections table
      const sectionsRes = await fetch('/api/v3/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Document Sections',
          displayName: 'Document Sections',
          icon: '📑',
          project_id: Number(projectId),
          columns: [
            { name: 'type', displayName: 'Type', type: 'select', config: { options: [
              { value: 'endpoint', label: 'API Endpoint', color: '#3b82f6' },
              { value: 'concept', label: 'Concept', color: '#8b5cf6' },
              { value: 'howto', label: 'How-to', color: '#10b981' },
              { value: 'code', label: 'Code', color: '#f59e0b' },
              { value: 'reference', label: 'Reference', color: '#6b7280' }
            ]}},
            { name: 'title', displayName: 'Title', type: 'text' },
            { name: 'content', displayName: 'Content', type: 'richText' },
            { name: 'scope', displayName: 'Scope', type: 'text' },
            { name: 'parent', displayName: 'Parent Section', type: 'number' },
            { name: 'order_index', displayName: 'Order', type: 'number' },
            { name: 'http_method', displayName: 'HTTP Method', type: 'select', config: { options: [
              { value: 'GET', label: 'GET', color: '#10b981' },
              { value: 'POST', label: 'POST', color: '#3b82f6' },
              { value: 'PUT', label: 'PUT', color: '#f59e0b' },
              { value: 'PATCH', label: 'PATCH', color: '#f97316' },
              { value: 'DELETE', label: 'DELETE', color: '#ef4444' }
            ]}},
            { name: 'http_path', displayName: 'HTTP Path', type: 'text' },
            { name: 'params', displayName: 'Parameters', type: 'json' },
            { name: 'response', displayName: 'Response', type: 'json' },
            { name: 'code', displayName: 'Code Example', type: 'code' },
            { name: 'tags', displayName: 'Tags', type: 'multiselect' }
          ]
        })
      });
      const sectionsData = await sectionsRes.json();
      const newSectionsId = sectionsData.data?.id || sectionsData.id;

      // Create Documents table
      const docsRes = await fetch('/api/v3/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Documents',
          displayName: 'Documents',
          icon: '📄',
          project_id: Number(projectId),
          columns: [
            { name: 'name', displayName: 'Name', type: 'text' },
            { name: 'description', displayName: 'Description', type: 'text' },
            { name: 'icon', displayName: 'Icon', type: 'text' },
            { name: 'category', displayName: 'Category', type: 'select', config: { options: [
              { value: 'API', label: 'API', color: '#3b82f6' },
              { value: 'Frontend', label: 'Frontend', color: '#8b5cf6' },
              { value: 'Backend', label: 'Backend', color: '#10b981' },
              { value: 'DevOps', label: 'DevOps', color: '#f59e0b' },
              { value: 'Guide', label: 'Guide', color: '#ec4899' }
            ]}},
            { name: 'status', displayName: 'Status', type: 'select', config: { options: [
              { value: 'draft', label: 'Draft', color: '#f59e0b' },
              { value: 'published', label: 'Published', color: '#10b981' },
              { value: 'deprecated', label: 'Deprecated', color: '#ef4444' }
            ]}},
            { name: 'sections', displayName: 'Sections', type: 'json' }
          ]
        })
      });
      const docsData = await docsRes.json();
      const newDocsId = docsData.data?.id || docsData.id;

      deps.setSectionsTableId(String(newSectionsId));
      deps.setDocumentsTableId(String(newDocsId));

      alert(`✅ Таблицы созданы!\n📄 Documents: ${newDocsId}\n📑 Sections: ${newSectionsId}`);
    } catch (error) {
      logger.error('Failed to create documents tables:', error);
      alert('Ошибка создания таблиц: ' + (error as Error).message);
    } finally {
      deps.setCreatingDocumentsTables(false);
    }
  };
}

interface TicketsTableHandlerDeps {
  documentsProjectId: string;
  setCreatingTicketsTable: (v: boolean) => void;
  setTicketsTableId: (v: string) => void;
  setTicketsColTitle: (v: string) => void;
  setTicketsColDesc: (v: string) => void;
  setTicketsColType: (v: string) => void;
  setTicketsColState: (v: string) => void;
  setTicketsColPriority: (v: string) => void;
}

export function createHandleCreateTicketsTable(deps: TicketsTableHandlerDeps) {
  return async () => {
    const projectId = deps.documentsProjectId;
    if (!projectId) {
      alert('Сначала выберите проект');
      return;
    }
    try {
      deps.setCreatingTicketsTable(true);

      const res = await fetch('/api/v3/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Tickets',
          displayName: 'Tickets',
          icon: '\uD83C\uDFAB',
          project_id: Number(projectId),
          columns: [
            { name: 'what', displayName: 'What', type: 'text' },
            { name: 'why', displayName: 'Why', type: 'textarea' },
            { name: 'type', displayName: 'Type', type: 'select', config: { options: [
              { value: 'bug', label: 'Bug', color: '#ef4444' },
              { value: 'story', label: 'Story', color: '#3b82f6' },
              { value: 'task', label: 'Task', color: '#22c55e' },
              { value: 'spike', label: 'Spike', color: '#a855f7' },
            ]}},
            { name: 'state', displayName: 'State', type: 'select', config: { options: [
              { value: 'backlog', label: 'Backlog', color: '#6b7280' },
              { value: 'in progress', label: 'In Progress', color: '#3b82f6' },
              { value: 'review', label: 'Review', color: '#a855f7' },
              { value: 'done', label: 'Done', color: '#22c55e' },
              { value: 'on hold', label: 'On Hold', color: '#f59e0b' },
            ]}},
            { name: 'priority', displayName: 'Priority', type: 'select', config: { options: [
              { value: 'low', label: 'Low', color: '#6b7280' },
              { value: 'medium', label: 'Medium', color: '#f59e0b' },
              { value: 'high', label: 'High', color: '#f97316' },
              { value: 'critical', label: 'Critical', color: '#ef4444' },
            ]}},
            { name: 'acceptance_criteria', displayName: 'Acceptance Criteria', type: 'textarea' },
            { name: 'test_steps', displayName: 'Test Steps', type: 'textarea' },
            { name: 'created_date', displayName: 'Created', type: 'datetime' },
          ]
        })
      });
      const data = await res.json();
      const newTableId = data.data?.id || data.id;

      deps.setTicketsTableId(String(newTableId));
      deps.setTicketsColTitle('what');
      deps.setTicketsColDesc('why');
      deps.setTicketsColType('type');
      deps.setTicketsColState('state');
      deps.setTicketsColPriority('priority');

      alert(`Таблица Tickets создана (ID: ${newTableId})`);
    } catch (error) {
      logger.error('Failed to create tickets table:', error);
      alert('Ошибка создания таблицы: ' + (error as Error).message);
    } finally {
      deps.setCreatingTicketsTable(false);
    }
  };
}

interface TicketsTableChangeDeps {
  setTicketsTableId: (v: string) => void;
  setTicketsColTitle: (v: string) => void;
  setTicketsColDesc: (v: string) => void;
  setTicketsColType: (v: string) => void;
  setTicketsColState: (v: string) => void;
  setTicketsColPriority: (v: string) => void;
}

export function createHandleTicketsTableChange(deps: TicketsTableChangeDeps) {
  return async (tableId: string) => {
    deps.setTicketsTableId(tableId);
    if (!tableId) return;
    try {
      const res = await fetch(`/api/v3/tables/${tableId}/columns`);
      const data = await res.json();
      const cols: Array<{ column_name: string; type: string; config?: string }> = data.data || data || [];
      const colNames = cols.map(c => c.column_name);
      const aliases: Record<string, string[]> = {
        title: ['title', 'what', 'name', 'subject'],
        description: ['description', 'why', 'details', 'body'],
        type: ['type', 'task_type', 'ticket_type', 'kind'],
        state: ['state', 'status', 'task_status'],
        priority: ['priority', 'urgency'],
      };
      const findCol = (names: string[]) => names.find(n => colNames.includes(n)) || '';
      deps.setTicketsColTitle(findCol(aliases.title));
      deps.setTicketsColDesc(findCol(aliases.description));
      deps.setTicketsColType(findCol(aliases.type));
      deps.setTicketsColState(findCol(aliases.state));
      deps.setTicketsColPriority(findCol(aliases.priority));
    } catch {
      // Ignore - user can map manually
    }
  };
}

interface SaveHandlerDeps {
  widget: Widget;
  title: string;
  description: string;
  icon: string;
  selectedTableId: string;
  cardColumns: string[];
  visibleColumns: string[];
  statusColumn: string;
  titleColumn: string;
  descriptionColumn: string;
  assigneeColumn: string;
  scheduledDateColumn: string;
  dueDateColumn: string;
  colorColumn: string;
  taskCompletedColumn: string;
  bddMode: boolean;
  bddCodeColumn: string;
  bddPriorityColumn: string;
  bddStatusColumn: string;
  dateColumn: string;
  calendarEndDateColumn: string;
  calendarTitleColumn: string;
  calendarDescriptionColumn: string;
  calendarColorColumn: string;
  startDateColumn: string;
  endDateColumn: string;
  timelineTitleColumn: string;
  timelineDescriptionColumn: string;
  timelineDependsOnColumn: string;
  timelineGroupByColumn: string;
  timelineCalendarTableId: string;
  timelineCalendarDateColumn: string;
  timelineCalendarTypeColumn: string;
  timelineCalendarTagsColumn: string;
  timelineCalendarNoteColumn: string;
  timelineCalendarBgColorColumn: string;
  timelineCalendarFontColorColumn: string;
  aiOperatorsTableId: string;
  aiAgentsTableId: string;
  aiChatHistoryTableId: string;
  aiRunLogsTableId: string;
  aiAnalyticsTableId: string;
  aiFeedbackTableId: string;
  documentsTableId: string;
  sectionsTableId: string;
  documentsSpaceId: string;
  documentsProjectId: string;
  ticketsTableId: string;
  ticketsColTitle: string;
  ticketsColDesc: string;
  ticketsColType: string;
  ticketsColState: string;
  ticketsColPriority: string;
  updateWidgetMutation: {
    mutateAsync: (args: {
      widgetId: string | number;
      updates: { title: string; description?: string; icon: string; config: WidgetConfig };
    }) => Promise<unknown>;
  };
  onSaved?: () => void;
  onClose: () => void;
}

export function createHandleSave(deps: SaveHandlerDeps) {
  return async () => {
    const config: WidgetConfig = {
      ...deps.widget.config,
      table_id: deps.selectedTableId ? Number(deps.selectedTableId) : null,
      card_columns: deps.cardColumns,
      visible_columns: deps.visibleColumns,
    };

    if (deps.widget.preset_name === 'kanban_board') {
      config.group_by_column = deps.statusColumn;
      config.statusColumn = deps.statusColumn;
      config.card_title_column = deps.titleColumn;
      config.titleColumn = deps.titleColumn;
      config.card_subtitle_column = deps.descriptionColumn;
      config.descriptionColumn = deps.descriptionColumn;
      config.kanban = {
        tableId: deps.selectedTableId,
        statusColumn: deps.statusColumn,
        titleColumn: deps.titleColumn,
        descriptionColumn: deps.descriptionColumn || undefined,
        assigneeColumn: deps.assigneeColumn || undefined,
        scheduledDateColumn: deps.scheduledDateColumn || undefined,
        dueDateColumn: deps.dueDateColumn || undefined,
        colorColumn: deps.colorColumn || undefined,
        lanes: deps.widget.config?.kanban?.lanes || [],
      };
    }

    if (deps.widget.preset_name === 'task_list') {
      config.card_title_column = deps.titleColumn || undefined;
      config.card_subtitle_column = deps.descriptionColumn || undefined;
      config.completed_column = deps.taskCompletedColumn || undefined;
      config.scheduled_date_column = deps.scheduledDateColumn || undefined;
      config.due_date_column = deps.dueDateColumn || undefined;
      config.color_column = deps.colorColumn || undefined;
      config.bdd_mode = deps.bddMode;
      if (deps.bddMode) {
        config.bdd_code_column = deps.bddCodeColumn || 'code';
        config.bdd_priority_column = deps.bddPriorityColumn || 'priority';
        config.bdd_status_column = deps.bddStatusColumn || 'status';
      }
    }

    if (deps.widget.preset_name === 'calendar_widget') {
      config.calendar = {
        tableId: deps.selectedTableId,
        dateColumn: deps.dateColumn,
        endDateColumn: deps.calendarEndDateColumn || undefined,
        titleColumn: deps.calendarTitleColumn,
        descriptionColumn: deps.calendarDescriptionColumn || undefined,
        colorColumn: deps.calendarColorColumn || undefined,
      };
    }

    if (deps.widget.preset_name === 'timeline_widget') {
      config.timeline = {
        tableId: deps.selectedTableId,
        startDateColumn: deps.startDateColumn,
        endDateColumn: deps.endDateColumn,
        titleColumn: deps.timelineTitleColumn,
        descriptionColumn: deps.timelineDescriptionColumn || undefined,
        dependsOnColumn: deps.timelineDependsOnColumn || undefined,
        groupByColumn: deps.timelineGroupByColumn || undefined,
        calendarTableId: deps.timelineCalendarTableId || undefined,
        calendarDateColumn: deps.timelineCalendarDateColumn || 'date',
        calendarTypeColumn: deps.timelineCalendarTypeColumn || 'day_type',
        calendarTagsColumn: deps.timelineCalendarTagsColumn || 'tags',
        calendarNoteColumn: deps.timelineCalendarNoteColumn || 'note',
        calendarBgColorColumn: deps.timelineCalendarBgColorColumn || 'bg_color',
        calendarFontColorColumn: deps.timelineCalendarFontColorColumn || 'font_color',
      };
    }

    if (deps.widget.preset_name === 'ai_agents') {
      config.operators_table_id = deps.aiOperatorsTableId ? Number(deps.aiOperatorsTableId) : null;
      config.agents_table_id = deps.aiAgentsTableId ? Number(deps.aiAgentsTableId) : null;
      config.chat_history_table_id = deps.aiChatHistoryTableId ? Number(deps.aiChatHistoryTableId) : null;
      config.run_logs_table_id = deps.aiRunLogsTableId ? Number(deps.aiRunLogsTableId) : null;
      config.analytics_table_id = deps.aiAnalyticsTableId ? Number(deps.aiAnalyticsTableId) : null;
      config.feedback_table_id = deps.aiFeedbackTableId ? Number(deps.aiFeedbackTableId) : null;
      config.table_id = deps.aiAgentsTableId ? Number(deps.aiAgentsTableId) : null;
    }

    if (deps.widget.preset_name === 'documents') {
      // Legacy keys (kept writing until ADR-0067 P5)
      config.documents_table_id = deps.documentsTableId ? Number(deps.documentsTableId) : null;
      config.sections_table_id = deps.sectionsTableId ? Number(deps.sectionsTableId) : null;
      config.documents_space_id = deps.documentsSpaceId ? Number(deps.documentsSpaceId) : null;
      config.documents_project_id = deps.documentsProjectId ? Number(deps.documentsProjectId) : null;
      config.table_id = deps.documentsTableId ? Number(deps.documentsTableId) : null;
      // Canonical keys (ADR-0067 P1 dual-write)
      config.registry_table_id = deps.documentsTableId ? Number(deps.documentsTableId) : null;
      config.atoms_table_id = deps.sectionsTableId ? Number(deps.sectionsTableId) : null;
      config.project_id = deps.documentsProjectId ? Number(deps.documentsProjectId) : null;

      if (deps.ticketsTableId) {
        config.ticket_binding = {
          table_id: Number(deps.ticketsTableId),
          columns: {
            title: deps.ticketsColTitle || 'what',
            description: deps.ticketsColDesc || undefined,
            type: deps.ticketsColType || undefined,
            state: deps.ticketsColState || undefined,
            priority: deps.ticketsColPriority || undefined,
          },
        };
      } else {
        config.ticket_binding = undefined;
      }
    }

    try {
      await deps.updateWidgetMutation.mutateAsync({
        widgetId: deps.widget.id,
        updates: {
          title: deps.title,
          description: deps.description || undefined,
          icon: deps.icon,
          config,
        },
      });
      deps.onSaved?.();
      deps.onClose();
    } catch (error) {
      logger.error('Failed to update widget:', error);
    }
  };
}
