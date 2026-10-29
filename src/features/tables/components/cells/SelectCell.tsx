import type { ColumnOption, ColumnRelationConfig } from '../../types/table.types';
import type { LensedValue } from '../../utils/resolveLens';
import { colorForKey, getDefaultColor, useLensedValue } from '../../hooks/useRelationLookup';

interface SelectCellProps {
  value: unknown;
  options?: ColumnOption[];
  relation?: ColumnRelationConfig;
  /** ADR-205: lens resolved by renderCellValue from the server map; absent → client lookup. */
  lensed?: LensedValue;
  rawMode?: boolean; // Show raw value without badge
}

const Badge = ({ color, children }: { color: string; children: string }) => (
  <span
    className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shadow-sm"
    style={{
      backgroundColor: `${color}20`,
      color: color,
      border: `1px solid ${color}40`
    }}
  >
    {children}
  </span>
);

export const SelectCell = ({ value, options = [], relation, lensed, rawMode }: SelectCellProps) => {
  const lens = useLensedValue(value, relation, lensed, 'single');

  // RAW mode - show raw value without badge styling
  if (rawMode) {
    if (value === null || value === undefined || value === '') {
      return <span className="font-mono text-xs text-[var(--text-tertiary)]">NULL</span>;
    }
    return (
      <span className="font-mono text-xs text-[var(--text-secondary)]">
        {String(value)}
      </span>
    );
  }

  // Formatted mode (default)
  if (value === null || value === undefined || value === '') {
    return <span className="text-[var(--text-tertiary)] italic text-sm">Select...</span>;
  }

  const stringValue = String(value);

  // Lens first (lookup from related table)
  const related = relation?.enabled ? lens.items.find((item) => item.resolved) : undefined;
  if (related) {
    return <Badge color={related.color || colorForKey(stringValue)}>{related.label}</Badge>;
  }

  const optionIndex = options.findIndex(opt => opt.value === value || opt.value === stringValue);
  const selectedOption = optionIndex >= 0 ? options[optionIndex] : null;

  // If option found in config, use its color
  if (selectedOption) {
    return <Badge color={selectedOption.color || getDefaultColor(optionIndex)}>{selectedOption.label}</Badge>;
  }

  // If no options defined (external table) - show value as styled badge with auto-color
  return <Badge color={colorForKey(stringValue)}>{stringValue}</Badge>;
};
