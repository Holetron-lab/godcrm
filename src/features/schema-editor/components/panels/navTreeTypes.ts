/**
 * Types and constants for NavTreePanel
 */

import type { ReactNode } from 'react';
import type { NavTreeNode, TableNodeData, TableVisibilityState } from '../../types/schema-editor.types';

export interface NavTreePanelProps {
  className?: string;
  onClose?: () => void;
}

// Everything SchemaTree needs beyond the nodes themselves. The schema-editor feeds it from its store
// (useSchemaTreeStore); other screens (ADR-207 §2.6 install plan) can feed it from plain data.
export interface SchemaTreeModel {
  isExpanded: (node: NavTreeNode) => boolean;
  getVisibility: (node: NavTreeNode) => TableVisibilityState;
  getTableColumns: (tableId: number) => Pick<TableNodeData, 'columns' | 'rowsPreview' | 'rowsLoading'> | undefined;
  onToggleExpand: (node: NavTreeNode) => void;
  onVisibilityChange: (node: NavTreeNode, state: TableVisibilityState) => void;
  onLoadTableRows: (tableId: number) => void;
}

// Install-plan overlay (ADR-207 §2.6). A row keeps its expander, icon and name; the editor's own chrome
// (selection, visibility, settings, ⋮ menu, column rows) gives way to the state and controls of the plan.
export interface SchemaTreeOverlay {
  /** Shown in place of VisibilityCheckbox. */
  renderState: (node: NavTreeNode) => ReactNode;
  /** Shown under an expanded row, in place of the table's column rows. */
  renderDetails: (node: NavTreeNode) => ReactNode;
  rowClassName: (node: NavTreeNode) => string;
}

// Selection state for projects/folders (4-state: none, self, all, children-only)
export type ParentSelectionState = 'none' | 'self' | 'all' | 'children-only';

// Constants for resizable panel
export const MIN_WIDTH = 240;
export const MAX_WIDTH = 480;
export const DEFAULT_WIDTH = 280;
