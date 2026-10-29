import type { ColumnOption, ColumnRelationConfig } from '../../types/table.types';
import { parseRelationValues, type LensedValue } from '../../utils/resolveLens';
import { colorForKey, getDefaultColor, useLensedValue } from '../../hooks/useRelationLookup';

interface MultiSelectCellProps {
  value: unknown;
  options?: ColumnOption[];
  relation?: ColumnRelationConfig;  // Can link to table for dynamic options
  /** ADR-205: lens resolved by renderCellValue from the server map; absent → client lookup. */
  lensed?: LensedValue;
  rawMode?: boolean;
}

export const MultiSelectCell = ({ value, options = [], relation, lensed, rawMode }: MultiSelectCellProps) => {
  const lens = useLensedValue(value, relation, lensed, 'auto');

  // RAW mode - show comma-separated values
  if (rawMode) {
    if (value === null || value === undefined) {
      return <span className="font-mono text-xs text-[var(--text-tertiary)]">NULL</span>;
    }
    const rawValue = parseRelationValues(value, relation?.storageFormat).join(', ');
    return (
      <span className="font-mono text-xs text-[var(--text-secondary)]">
        {rawValue || 'NULL'}
      </span>
    );
  }

  // Formatted mode (default)
  if (value === null || value === undefined || value === '') {
    return <span className="text-[var(--text-tertiary)] italic text-sm">—</span>;
  }

  const values = parseRelationValues(value, relation?.storageFormat);

  if (values.length === 0) {
    return <span className="text-[var(--text-tertiary)] italic text-sm">—</span>;
  }

  const lensByKey = new Map(lens.items.map((item) => [item.key, item]));

  // Get display data for each value
  const items = values.map((val, index) => {
    // Lens first (lookup from related table)
    const related = lensByKey.get(val);
    if (relation?.enabled && related?.resolved) {
      return { value: val, label: related.label, color: related.color || colorForKey(val) };
    }

    // Check local options
    const optionIndex = options.findIndex(opt => opt.value === val);
    const selectedOption = optionIndex >= 0 ? options[optionIndex] : null;

    if (selectedOption) {
      return {
        value: val,
        label: selectedOption.label,
        color: selectedOption.color || getDefaultColor(optionIndex)
      };
    }

    // Fallback - use value as label with auto-color
    return { value: val, label: val, color: colorForKey(val, index) };
  });

  // Display mode (from relation config or default to 'badges')
  const displayMode = relation?.displayMode || 'badges';

  // === COUNT MODE ===
  if (displayMode === 'count') {
    return (
      <span className="inline-flex items-center justify-center min-w-[24px] px-2 py-0.5 rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-xs font-medium">
        {items.length}
      </span>
    );
  }

  // === LIST MODE ===
  if (displayMode === 'list') {
    return (
      <span className="text-sm text-[var(--text-primary)]">
        {items.map(i => i.label).join(', ')}
      </span>
    );
  }

  // === FIRST ONLY MODE ===
  if (displayMode === 'first' && items.length > 0) {
    const first = items[0];
    return (
      <span
        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shadow-sm"
        style={{
          backgroundColor: `${first.color}20`,
          color: first.color,
          border: `1px solid ${first.color}40`
        }}
      >
        {first.label}
        {items.length > 1 && (
          <span className="ml-1 opacity-60">+{items.length - 1}</span>
        )}
      </span>
    );
  }

  // === BADGES MODE (default) - круглые карточки ===
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item, index) => (
        <span
          key={index}
          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shadow-sm"
          style={{
            backgroundColor: `${item.color}20`,
            color: item.color,
            border: `1px solid ${item.color}40`
          }}
        >
          {item.label}
        </span>
      ))}
    </div>
  );
};
