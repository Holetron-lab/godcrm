// Moved verbatim from features/tables/components/CreateTableModal/notion-utils.ts
// (ADR-207 W3.1). Pinned by __tests__/csv-parity.test.ts.
import { BOOL_TRUE_VALUES } from '@/shared/utils/i18n-utils';

/** Convert one raw text cell into the JSON value stored for a column of `type`. */
export function convertValue(value: string, type: string): unknown {
  if (!value || value.trim() === '') return null;

  switch (type) {
    case 'number': {
      const num = Number(value.replace(',', '.').replace(/\s/g, ''));
      return isNaN(num) ? null : num;
    }
    case 'checkbox': {
      const lower = value.toLowerCase().trim();
      return BOOL_TRUE_VALUES.includes(lower as typeof BOOL_TRUE_VALUES[number]);
    }
    case 'date':
    case 'datetime': {
      const date = new Date(value);
      return isNaN(date.getTime()) ? value : date.toISOString();
    }
    default:
      return value;
  }
}
