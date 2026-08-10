import { KanbanWidgetSettings } from './KanbanWidgetSettings';
import { CalendarWidgetSettings } from './CalendarWidgetSettings';
import { TimelineWidgetSettings } from './TimelineWidgetSettings';
import { AiAgentsWidgetSettings } from './AiAgentsWidgetSettings';
import { DocumentsWidgetSettings } from './DocumentsWidgetSettings';
import { TaskListWidgetSettings } from './TaskListWidgetSettings';
import type {
  KanbanSettingsProps,
  CalendarSettingsProps,
  TimelineSettingsProps,
  AiAgentsSettingsProps,
  DocumentsSettingsProps,
} from './types';
import type { TaskListSettingsProps } from './TaskListWidgetSettings';
import type { Widget } from '../../../types/widget.types';

export interface PresetSettingsRouterProps {
  widget: Widget;
  kanbanProps: KanbanSettingsProps;
  calendarProps: CalendarSettingsProps;
  timelineProps: TimelineSettingsProps;
  aiAgentsProps: AiAgentsSettingsProps;
  documentsProps: DocumentsSettingsProps;
  taskListProps: TaskListSettingsProps;
}

export function PresetSettingsRouter({
  widget,
  kanbanProps,
  calendarProps,
  timelineProps,
  aiAgentsProps,
  documentsProps,
  taskListProps,
}: PresetSettingsRouterProps) {
  switch (widget.preset_name) {
    case 'kanban_board':
      return <KanbanWidgetSettings {...kanbanProps} />;
    case 'calendar_widget':
      return <CalendarWidgetSettings {...calendarProps} />;
    case 'timeline_widget':
      return <TimelineWidgetSettings {...timelineProps} />;
    case 'ai_agents':
      return <AiAgentsWidgetSettings {...aiAgentsProps} />;
    case 'documents':
      return <DocumentsWidgetSettings {...documentsProps} />;
    case 'task_list':
      return <TaskListWidgetSettings {...taskListProps} />;
    default:
      return null;
  }
}
