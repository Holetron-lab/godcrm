import type { ColumnModel } from '@/features/tables/types/table.types';

export interface WidgetSettingsColumnProps {
  safeColumns: ColumnModel[];
  selectColumns: ColumnModel[];
  textColumns: ColumnModel[];
  dateColumns: ColumnModel[];
  allDisplayableColumns: ColumnModel[];
  loadingColumns: boolean;
  creatingColumn: boolean;
  handleCreatePresetColumn: (preset: 'color' | 'priority' | 'status' | 'dependency' | 'flow') => Promise<void>;
}

export interface KanbanSettingsProps extends WidgetSettingsColumnProps {
  statusColumn: string;
  setStatusColumn: (v: string) => void;
  titleColumn: string;
  setTitleColumn: (v: string) => void;
  descriptionColumn: string;
  setDescriptionColumn: (v: string) => void;
  assigneeColumn: string;
  setAssigneeColumn: (v: string) => void;
  scheduledDateColumn: string;
  setScheduledDateColumn: (v: string) => void;
  dueDateColumn: string;
  setDueDateColumn: (v: string) => void;
  colorColumn: string;
  setColorColumn: (v: string) => void;
  cardColumns: string[];
  setCardColumns: (v: string[]) => void;
  visibleColumns: string[];
  setVisibleColumns: (v: string[]) => void;
  availableCardColumns: ColumnModel[];
  availableExpandedColumns: ColumnModel[];
}

export interface CalendarSettingsProps extends WidgetSettingsColumnProps {
  dateColumn: string;
  setDateColumn: (v: string) => void;
  calendarEndDateColumn: string;
  setCalendarEndDateColumn: (v: string) => void;
  calendarTitleColumn: string;
  setCalendarTitleColumn: (v: string) => void;
  calendarDescriptionColumn: string;
  setCalendarDescriptionColumn: (v: string) => void;
  calendarColorColumn: string;
  setCalendarColorColumn: (v: string) => void;
}

export interface TimelineSettingsProps extends WidgetSettingsColumnProps {
  startDateColumn: string;
  setStartDateColumn: (v: string) => void;
  endDateColumn: string;
  setEndDateColumn: (v: string) => void;
  timelineTitleColumn: string;
  setTimelineTitleColumn: (v: string) => void;
  timelineDescriptionColumn: string;
  setTimelineDescriptionColumn: (v: string) => void;
  timelineDependsOnColumn: string;
  setTimelineDependsOnColumn: (v: string) => void;
  timelineGroupByColumn: string;
  setTimelineGroupByColumn: (v: string) => void;
  timelineCalendarProjectId: string;
  setTimelineCalendarProjectId: (v: string) => void;
  timelineCalendarTableId: string;
  setTimelineCalendarTableId: (v: string) => void;
  timelineCalendarDateColumn: string;
  setTimelineCalendarDateColumn: (v: string) => void;
  timelineCalendarTypeColumn: string;
  setTimelineCalendarTypeColumn: (v: string) => void;
  timelineCalendarTagsColumn: string;
  setTimelineCalendarTagsColumn: (v: string) => void;
  timelineCalendarNoteColumn: string;
  setTimelineCalendarNoteColumn: (v: string) => void;
  timelineCalendarBgColorColumn: string;
  setTimelineCalendarBgColorColumn: (v: string) => void;
  timelineCalendarFontColorColumn: string;
  setTimelineCalendarFontColorColumn: (v: string) => void;
  creatingCalendarTable: boolean;
  handleCreateCalendarTable: () => Promise<void>;
  spaceProjects: Array<{ id: number | string; name: string; icon?: string; type?: string }>;
  calendarProjectTables: Array<{ id: number | string; name: string; icon?: string }>;
  systemDataProject: { id: number | string } | null;
}

export interface AiAgentsSettingsProps {
  tables: Array<{ id: number | string; name: string; displayName?: string; icon?: string }>;
  aiOperatorsTableId: string;
  setAiOperatorsTableId: (v: string) => void;
  aiAgentsTableId: string;
  setAiAgentsTableId: (v: string) => void;
  aiChatHistoryTableId: string;
  setAiChatHistoryTableId: (v: string) => void;
  aiRunLogsTableId: string;
  setAiRunLogsTableId: (v: string) => void;
  aiAnalyticsTableId: string;
  setAiAnalyticsTableId: (v: string) => void;
  aiFeedbackTableId: string;
  setAiFeedbackTableId: (v: string) => void;
}

export interface DocumentsSettingsProps {
  spaces: Array<{ id: number | string; name: string; icon?: string | null }>;
  documentsSpaceId: string;
  setDocumentsSpaceId: (v: string) => void;
  documentsProjectId: string;
  setDocumentsProjectId: (v: string) => void;
  documentsTableId: string;
  setDocumentsTableId: (v: string) => void;
  sectionsTableId: string;
  setSectionsTableId: (v: string) => void;
  documentsSpaceProjects: Array<{ id: number | string; name: string; icon?: string; type?: string }>;
  documentsProjectTables: Array<{ id: number | string; name: string; displayName?: string; icon?: string; key?: string }>;
  creatingDocumentsTables: boolean;
  handleCreateDocumentsTables: () => Promise<void>;
  ticketsTableId: string;
  setTicketsTableId: (v: string) => void;
  ticketsColTitle: string;
  setTicketsColTitle: (v: string) => void;
  ticketsColDesc: string;
  setTicketsColDesc: (v: string) => void;
  ticketsColType: string;
  setTicketsColType: (v: string) => void;
  ticketsColState: string;
  setTicketsColState: (v: string) => void;
  ticketsColPriority: string;
  setTicketsColPriority: (v: string) => void;
  creatingTicketsTable: boolean;
  handleCreateTicketsTable: () => Promise<void>;
  handleTicketsTableChange: (tableId: string) => Promise<void>;
}
