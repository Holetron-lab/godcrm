import { BarChart3, Calendar, Component, FileText, Image, Kanban, List, PackageCheck, Table2, type LucideIcon } from 'lucide-react';

/**
 * Icon for a module (widget) by its preset name (`widgets.preset_name`, e.g. `table_view`,
 * `kanban_board`, `documents`). Legacy short types ('kanban', 'table') match by substring too.
 */
export const getWidgetIcon = (presetName?: string, config?: unknown): LucideIcon => {
  // The tree API may serialize config; match the same discriminator as TableViewWidget.
  try {
    const parsed: unknown = typeof config === 'string' ? JSON.parse(config) : config;
    if (parsed && typeof parsed === 'object' && 'procurement' in parsed && parsed.procurement) return PackageCheck;
  } catch {
    // Malformed config keeps the normal preset fallback.
  }
  const key = (presetName || '').toLowerCase();
  if (key.includes('table')) return Table2;
  if (key.includes('kanban')) return Kanban;
  if (key.includes('doc')) return FileText;
  if (key.includes('calendar') || key.includes('timeline')) return Calendar;
  if (key.includes('gallery')) return Image;
  if (key.includes('chart') || key.includes('stats') || key.includes('number')) return BarChart3;
  if (key.includes('list')) return List;
  return Component;
};

// Table modules get the table menu (add row / view / edit / move / delete) of their main table.
export const isTableWidget = (presetName?: string): boolean => (presetName || '').toLowerCase().includes('table');
