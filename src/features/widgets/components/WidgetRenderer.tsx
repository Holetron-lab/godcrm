import type { WidgetRendererProps } from '../types/widget.types';
import { TableViewWidget } from './presets/TableViewWidget';
import { ProjectStatsWidget } from './presets/ProjectStatsWidget';
import { QuickLinksWidget } from './presets/QuickLinksWidget';
import { ChartWidget } from './presets/ChartWidget';
import { KanbanWidget } from './presets/KanbanWidget';
import { CalendarWidget } from './presets/CalendarWidget';
import { TimelineWidget } from './presets/TimelineWidget';
import { DataSourcesWidget } from './presets/DataSourcesWidget';
import { TaskListWidget } from './presets/TaskListWidget';
import { AIAgentsWidget } from './presets/AIAgentsWidget';
import { AgentRowWidget } from './presets/AgentRowWidget';
import { DocumentsWidget } from './presets/DocumentsWidget';
import { LabsWidget } from './presets/LabsWidget';
import { VirtualOfficeWidget } from './presets/virtual-office';
import { TerminalWidget } from './presets/TerminalWidget';
import { AutopilotDashboardWidget } from './presets/AutopilotDashboardWidget';
import { PesDashboardWidget } from './presets/PesDashboardWidget';
import { TicketsListPreset } from './presets/tickets-list/TicketsListPreset';
import { WelcomeDashboardWidget } from './presets/WelcomeDashboardWidget';
import { getWidgetPreset } from '../registry/modulePresetRegistry';
import { CustomWidgetSandbox } from './custom/CustomWidgetSandbox';

/**
 * Widget Renderer - выбирает правильный компонент виджета
 */
export function WidgetRenderer({ widget, data = [] }: WidgetRendererProps) {
  // Custom widget
  if (widget.widget_type === 'custom' && widget.code) {
    return <CustomWidgetSandbox widget={widget} data={data} />;
  }

  // Preset widgets
  if (widget.widget_type === 'preset' && widget.preset_name) {
    const presetProps = { widget, data };

    switch (widget.preset_name) {
      case 'table_view':
        return <TableViewWidget {...presetProps} />;
      case 'project_stats':
        return <ProjectStatsWidget {...presetProps} />;
      case 'quick_links':
        return <QuickLinksWidget {...presetProps} />;
      case 'chart_widget':
        return <ChartWidget {...presetProps} />;
      case 'kanban_board':
        return <KanbanWidget {...presetProps} />;
      case 'calendar_widget':
        return <CalendarWidget {...presetProps} />;
      case 'timeline_widget':
        return <TimelineWidget {...presetProps} />;
      case 'data_sources':
        return <DataSourcesWidget {...presetProps} />;
      case 'task_list':
        return <TaskListWidget {...presetProps} />;
      case 'ai_agents':
        return <AIAgentsWidget {...presetProps} />;
      case 'agent_row':
        return <AgentRowWidget {...presetProps} />;
      case 'documents':
      case 'documents_v4':  // Legacy alias
        return <DocumentsWidget {...presetProps} />;
      case 'labs':
        return <LabsWidget {...presetProps} />;
      case 'virtual_office':
        return <VirtualOfficeWidget {...presetProps} />;
      case 'terminal':
        return <TerminalWidget {...presetProps} />;
      case 'autopilot_dashboard':
        return <AutopilotDashboardWidget {...presetProps} />;
      case 'pes_dashboard':
        return <PesDashboardWidget {...presetProps} />;
      case 'tickets_list':
        return <TicketsListPreset {...presetProps} />;
      case 'welcome_dashboard':
        return <WelcomeDashboardWidget {...presetProps} />;
      case 'recent_activity':
      case 'metric_card':
        // TODO: Implement remaining presets
        return (
          <div className="flex items-center justify-center h-full text-gray-400">
            <div className="text-center">
              <p className="text-4xl mb-2">{widget.icon}</p>
              <p className="text-sm">Widget &quot;{widget.preset_name}&quot; not implemented yet</p>
            </div>
          </div>
        );
      default: {
        // Autonomous-module presets (MODULE-CONTRACT v1, seam #2): if a module
        // registered this preset key, render it; otherwise fall through to the
        // core "unknown preset" notice. No static import, no per-module case.
        const ModulePreset = getWidgetPreset(widget.preset_name);
        if (ModulePreset) return <ModulePreset {...presetProps} />;
        return (
          <div className="flex items-center justify-center h-full text-red-400">
            <p>Unknown preset: {widget.preset_name}</p>
          </div>
        );
      }
    }
  }

  // Invalid widget
  return (
    <div className="flex items-center justify-center h-full text-red-400">
      <p>Invalid widget configuration</p>
    </div>
  );
}
