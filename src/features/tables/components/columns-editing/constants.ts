/**
 * Shared constants for ColumnsEditingTab sub-components
 */
import { AlignLeft, AlignCenter, AlignRight } from 'lucide-react';

// Column colors
export const COLUMN_COLORS = [
  null, '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#64748b'
];

// Text wrap options
export const TEXT_WRAP_OPTIONS = [
  { value: 'nowrap', label: 'В одну строку' },
  { value: 'wrap', label: 'Перенос' },
  { value: 'truncate', label: 'Обрезать...' }
];

// Alignment options
export const ALIGN_OPTIONS = [
  { value: 'left', label: 'Слева', icon: AlignLeft },
  { value: 'center', label: 'По центру', icon: AlignCenter },
  { value: 'right', label: 'Справа', icon: AlignRight }
];
