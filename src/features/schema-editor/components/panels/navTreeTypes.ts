/**
 * Types and constants for NavTreePanel
 */

export interface NavTreePanelProps {
  className?: string;
  onClose?: () => void;
}

// Selection state for projects/folders (4-state: none, self, all, children-only)
export type ParentSelectionState = 'none' | 'self' | 'all' | 'children-only';

// Constants for resizable panel
export const MIN_WIDTH = 240;
export const MAX_WIDTH = 480;
export const DEFAULT_WIDTH = 280;
