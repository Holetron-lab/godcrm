import type { PresetWidgetProps } from '../../../types/widget.types';
import type { RelationDataMap } from '../_shared/useLaneAxis';

// Column info for color mapping
export interface ColumnInfo {
  name: string;
  displayName?: string;
  type: string;
  config?: {
    options?: Array<{ value: string; label: string; color?: string }>;
    relation?: {
      enabled?: boolean;
      tableId?: string | number;
      valueColumn?: string;
      labelColumn?: string;
    };
    relatedTableId?: string | number;
  };
}

// Local type for row data
export interface TimelineRowData {
  id?: string | number;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ColorOption {
  value: string;
  label: string;
  color?: string;
}

export interface TimelineItem {
  id: string;
  row: TimelineRowData;
  title: string;
  description: string | null;
  group: string | null;
  color: string;
  progress: number | null;
  startDate: Date;
  endDate: Date;
  dependencies?: string[];  // IDs of tasks this depends on
  parentId?: string;        // For tree structure
  children?: TimelineItem[];
  level?: number;
  isCollapsed?: boolean;
  lane?: number;            // Lane assignment for compact view
}

export interface TimelineWidgetProps extends PresetWidgetProps {
  columnsInfo?: ColumnInfo[];
  /** Cross-table registry (table-id → row-id → {label, color, order}) used
   *  to resolve `relation` group-by lanes to human-readable names. */
  relationData?: RelationDataMap;
  onEventClick?: (event: TimelineRowData, initialTab?: 'details' | 'files' | 'comments') => void;
  onEventUpdate?: (eventId: string, field: string, value: unknown) => void;
  onAddEvent?: (date: Date) => void;
}

// Time scale options
export type TimeScale = 'minute' | 'hour' | 'day' | 'week' | 'month';

// View mode
export type ViewMode = 'timeline' | 'gantt';

// Step size for navigation
export type StepSize = 'division' | 'day' | 'week' | 'month' | 'quarter' | 'year';

// Drag state
export interface DragState {
  type: 'move' | 'resize-start' | 'resize-end' | null;
  item: TimelineItem | null;
  startX: number;
  originalStart: Date;
  originalEnd: Date;
}

// Calendar day info
export interface DayInfo {
  type: string;
  note?: string;
  bgColor?: string | null;
  fontColor?: string | null;
  tags?: string[];
}
