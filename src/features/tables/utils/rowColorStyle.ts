import type { CSSProperties } from 'react';
import type { ColumnModel } from '../types/table.types';
import { isValidHex, getDisplayValue, type ColorValue } from './color-utils';

/**
 * ADR-028: Get row coloring styles based on color column value.
 *
 * Looks for the first column of type `color` with `config.color.applyToRow=true`,
 * reads its value from the row data, and returns the CSSProperties for the
 * configured mode (`background` / `border-left` / `gradient`). Returns `{}`
 * when no eligible column exists, the cell is empty, or the value is not hex.
 */
export function getRowColorStyle(
  rowData: Record<string, unknown>,
  columns: ColumnModel[]
): CSSProperties {
  const colorColumn = columns.find(
    col => col.type === 'color' && col.config?.color?.applyToRow
  );

  if (!colorColumn) return {};

  const value = rowData[colorColumn.name] ?? rowData[colorColumn.id];
  if (!value) return {};

  const displayValue = getDisplayValue(value as ColorValue);
  if (!isValidHex(displayValue)) return {};

  const config = colorColumn.config?.color;
  const opacity = config?.rowColorOpacity ?? 0.15;
  const mode = config?.rowColorMode || 'background';

  switch (mode) {
    case 'background':
      return {
        backgroundColor: `${displayValue}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`,
      };
    case 'border-left':
      return {
        borderLeft: `4px solid ${displayValue}`,
      };
    case 'gradient':
      return {
        background: `linear-gradient(90deg, ${displayValue}33 0%, transparent 100%)`,
      };
    default:
      return {};
  }
}
