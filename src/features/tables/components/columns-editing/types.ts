/**
 * Shared types for ColumnsEditingTab sub-components
 */
import type { ColumnModel } from '../../types/table.types';

// Re-export for convenience
export type { ColumnModel };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConfig = any;

export interface ColorPickerProps {
  value: string | null;
  onChange: (color: string | null) => void;
  compact?: boolean;
}

export interface ProjectWithTables {
  id: number;
  name: string;
  icon?: string;
  tables: Array<{
    id: string;
    name: string;
    displayName: string;
    icon?: string;
  }>;
}

export interface ColumnCardProps {
  column: ColumnModel;
  isExpanded: boolean;
  isHidden: boolean;
  onToggleExpand: () => void;
  onToggleHidden: () => void;
  onUpdate: (field: string, value: unknown) => void;
  onDelete: () => void;
  onRequestKeyEdit: () => void;
  onOpenSettings?: () => void;
  keyEditable: boolean;
  columnTypes: Array<{ value: string; label: string; icon: string }>;
  sampleValues?: string[];
  currentSampleIndex: number;
  onSampleNavigate: (delta: number) => void;
  projects: ProjectWithTables[];
  currentProjectId?: number | null;
  currentRow?: Record<string, unknown> | null;
}

export interface ColumnCardHeaderProps {
  column: ColumnModel;
  isExpanded: boolean;
  isHidden: boolean;
  onToggleExpand: () => void;
  onToggleHidden: () => void;
  onUpdate: (field: string, value: unknown) => void;
  onDelete: () => void;
  onRequestKeyEdit: () => void;
  onOpenSettings?: () => void;
  keyEditable: boolean;
  columnTypes: Array<{ value: string; label: string; icon: string }>;
}

export interface CellPreviewProps {
  column: ColumnModel;
  width: number;
  fontFamily: string;
  fontSize: number;
  textColor: string | null;
  align: string;
  rawValue: unknown;
  currentRow?: Record<string, unknown> | null;
}

export interface ColumnSettingsProps {
  column: ColumnModel;
  config: AnyConfig;
  onUpdate: (field: string, value: unknown) => void;
  projects: ProjectWithTables[];
  sampleValues: string[];
  currentSampleIndex: number;
  onSampleNavigate: (delta: number) => void;
  currentRow?: Record<string, unknown> | null;
}

export interface DeleteColumnModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  column: ColumnModel | null;
  onConfirm: () => void;
  isPending: boolean;
}

export interface KeyEditModalProps {
  column: ColumnModel | null;
  onClose: () => void;
  onConfirm: (columnId: string, sanitizedKey: string) => void;
}
