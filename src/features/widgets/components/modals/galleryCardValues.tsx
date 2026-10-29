import type { ColumnModel, ColumnOption } from '@/features/tables/types/table.types';

/** Media cells store a single URL or a comma-separated list, oldest first. */
export const parseMediaList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((v) => String(v ?? '').trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value.split(',').map((url) => url.trim()).filter(Boolean);
};

/** Keep relative URLs relative so images resolve against the current origin. */
export const normalizeUrl = (url: string): string => {
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  return url.startsWith('/') ? url : `/${url}`;
};

/**
 * A hand-written capture date, `YYYY-MM-DD`. Built as a LOCAL date on purpose:
 * `new Date('2025-10-13')` is UTC midnight and renders as the 12th west of
 * Greenwich, which would show the wrong day for the same stored string.
 */
export const parseDayString = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatDay = (date: Date): string =>
  date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });

/** Select options live in `table_columns.config.options`; older rows carry `settings`. */
export const columnOptions = (column: ColumnModel): ColumnOption[] => {
  const raw =
    column.config?.options ??
    (column as unknown as { settings?: { options?: unknown } }).settings?.options;
  return Array.isArray(raw) ? (raw as ColumnOption[]) : [];
};

const optionColor = (column: ColumnModel, value: unknown): string | undefined =>
  columnOptions(column).find((o) => o.value === String(value))?.color;

export const renderValue = (column: ColumnModel, value: unknown) => {
  if (value === null || value === undefined || value === '') {
    return <span className="text-sm italic text-[var(--text-tertiary)]">—</span>;
  }
  switch (column.type) {
    case 'select':
    case 'multi-select': {
      const values = Array.isArray(value) ? value : [value];
      return (
        <div className="flex flex-wrap gap-1">
          {values.map((v, i) => {
            const color = optionColor(column, v);
            return (
              <span
                key={i}
                className="inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium"
                style={
                  color
                    ? { backgroundColor: `${color}20`, color }
                    : { backgroundColor: 'var(--bg-tertiary)' }
                }
              >
                {String(v)}
              </span>
            );
          })}
        </div>
      );
    }
    case 'checkbox':
      return (
        <span className={value ? 'text-sm text-green-500' : 'text-sm text-[var(--text-tertiary)]'}>
          {value ? '✓ Да' : '✗ Нет'}
        </span>
      );
    case 'date':
    case 'datetime':
      return (
        <span className="text-sm">
          {new Date(String(value)).toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
          })}
        </span>
      );
    default:
      return <span className="text-sm text-[var(--text-primary)]">{String(value)}</span>;
  }
};
