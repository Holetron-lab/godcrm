import type { DocumentLevel } from '../../../../types/documents.types';

export const TYPE_OPTIONS = [
  { value: 'heading', label: 'Заголовок', color: 'text-blue-400' },
  { value: 'endpoint', label: 'API Endpoint', color: 'text-green-400' },
  { value: 'reference', label: 'Reference', color: 'text-purple-400' },
  { value: 'concept', label: 'Concept', color: 'text-orange-400' },
  { value: 'code', label: 'Code', color: 'text-cyan-400' },
];

export const getLevelBadgeClass = (level: DocumentLevel): string => {
  switch (level) {
    case 'h1': return 'bg-purple-500/20 text-purple-400';
    case 'h2': return 'bg-blue-500/20 text-blue-400';
    case 'h3': return 'bg-green-500/20 text-green-400';
    case 'text': return 'bg-gray-500/20 text-gray-400';
    case 'atom': return 'bg-purple-500/20 text-purple-400';
    case 'image': return 'bg-pink-500/20 text-pink-400';
    case 'divider': return 'bg-gray-500/20 text-gray-400';
    case 'page_break': return 'bg-orange-500/20 text-orange-400';
    case 'widget': return 'bg-cyan-500/20 text-cyan-400';
    default: return 'bg-gray-500/20 text-gray-400';
  }
};

// Preset icon mapping — mirrors dashboard WidgetCard (keep in sync).
export const WIDGET_PRESET_ICONS: Record<string, string> = {
  table_view: '📋',
  kanban_board: '📊',
  calendar_widget: '📅',
  timeline_widget: '⏱️',
  chart_widget: '📈',
  task_list: '✅',
  recent_activity: '📰',
  ai_agents: '🤖',
  documents: '📄',
  virtual_office: '🏢',
  data_sources: '🔗',
  labs: '🧪',
  gallery: '🖼️',
  metric_card: '📈',
  tickets_list: '🎫',
};
