// Types
export * from './types/widget.types';
export * from './types/widget-library.types';

// Store
export { useWidgetsStore } from './store/widgetsStore';

// API
export * from './api/widgetsApi';
export * from './api/widgetLibraryApi';

// Hooks
export * from './hooks/useWidgets';
export * from './hooks/useWidgetLibrary';

// Components
export { DashboardGrid } from './components/DashboardGrid';
export { WidgetContainer } from './components/WidgetContainer';
export { WidgetRenderer } from './components/WidgetRenderer';
export { AddWidgetModal } from './components/AddWidgetModal';
export { WidgetPickerModal } from './components/WidgetPickerModal';
export { WidgetPickerContent } from './components/WidgetPickerContent';
export { WidgetGrid } from './components/WidgetGrid';
export { WidgetCard } from './components/WidgetCard';
export { WidgetPreviewPanel } from './components/WidgetPreviewPanel';

// Preset Widgets
export { TableViewWidget } from './components/presets/TableViewWidget';
export { ProjectStatsWidget } from './components/presets/ProjectStatsWidget';
export { QuickLinksWidget } from './components/presets/QuickLinksWidget';
export { ChartWidget } from './components/presets/ChartWidget';
export { KanbanWidget } from './components/presets/KanbanWidget';
export { DocumentsWidget } from './components/presets/DocumentsWidget';
export { AutopilotDashboardWidget } from './components/presets/AutopilotDashboardWidget';

// Documents types & API
export * from './types/documents.types';
export * from './api/documents-v4.api';  // TODO: rename api file
export * from './api/documents-task-binding.api';  // ADR-038
export { useDocuments, useDocumentContent } from './hooks/useDocuments';
export { useTaskBinding, TASK_BINDING_KEYS } from './hooks/useTaskBinding';  // ADR-038

// Documents Task Binding Components - ADR-038
export { TaskCard } from './components/presets/documents/TaskCard';
export { TaskBindingSettings } from './components/presets/documents/TaskBindingSettings';
export { CreateTaskModal } from './components/presets/documents/CreateTaskModal';

// AI Chat Utils - ADR-038
export { buildTaskChatPrompt, buildTaskChatSummary, buildTaskChatTools, TASK_CHAT_ACTIONS } from './utils/buildTaskChatPrompt';

// Custom Widgets
export { CustomWidgetSandbox } from './components/custom/CustomWidgetSandbox';
