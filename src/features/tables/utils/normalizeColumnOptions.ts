import type { ColumnOption } from '../types/table.types';

type PersistedOption = string | number | {
  label?: string | number;
  value?: string | number;
  color?: string;
  children?: PersistedOption[];
};

// Legacy strings and label-only objects use their label as the stored value.
// ColumnModel consumers share the canonical string-valued shape, including children.
export function normalizeColumnOptions(options: readonly PersistedOption[]): ColumnOption[] {
  return options.map(option => {
    if (typeof option === 'string' || typeof option === 'number') {
      return { label: String(option), value: String(option) };
    }
    const { children, ...fields } = option;
    return {
      ...fields,
      label: String(option.label ?? option.value ?? ''),
      value: String(option.value ?? option.label ?? ''),
      ...(children ? { children: normalizeColumnOptions(children) } : {}),
    };
  });
}
