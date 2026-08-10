import type { WidgetTableRequirement } from '@/features/widgets/config/widget-presets.config';

export interface WidgetPresetOption {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  tables: WidgetTableRequirement[];
}

export interface SpaceInfo {
  id: number;
  name: string;
  icon?: string;
  color?: string;
}

export interface ProjectInfo {
  id: number;
  name: string;
  icon?: string;
  spaceId?: number;
  space_id?: number;
}

export interface TableInfo {
  id: number;
  name: string;
  display_name?: string;
  icon?: string;
  projectId?: number;
  project_id?: number;
}

export interface ColumnInfo {
  id: string | number;
  name: string;
  display_name?: string;
  type?: string;
  column_type?: string;
  config?: { isBacklink?: boolean };
}

/** Widget creation request payload */
export interface CreateWidgetPayload {
  widget_type: string;
  title: string;
  icon?: string | null;
  config: WidgetCreateConfig;
  [key: string]: unknown;
}

/** Widget config with dynamic table/column mappings */
export interface WidgetCreateConfig {
  table_id?: string | number;
  visible_columns?: string[];
  kanban?: {
    tableId: string;
    statusColumn: string;
    columns?: Array<{ id: string; title: string; color: string }>;
    cardTitleColumn?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type WizardStep = 'preset' | 'table' | 'mapping' | 'config';
