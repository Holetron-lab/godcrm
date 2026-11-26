// Moved verbatim from features/tables/components/CreateTableModal/csv-utils.ts
// (ADR-207 W3.1). This is the heuristic the live CreateTableModal CSV/Excel
// path uses; the dead copies in ImportCSVModal / CreateTableFromCSVModal /
// MultiCSVImport differed (English-only booleans, 'date' instead of
// 'datetime') and were removed in favour of this one.
import { allAreBooleans } from '@/shared/utils/i18n-utils';

/** Guess a column type from its header and a sample of raw text values. */
export function guessColumnType(name: string, values: string[]): string {
  const nameLower = name.toLowerCase();

  if (nameLower.includes('email')) return 'email';
  if (nameLower.includes('phone') || nameLower.includes('tel')) return 'phone';
  if (nameLower.includes('url') || nameLower.includes('link') || nameLower.includes('website')) return 'url';
  if (nameLower.includes('date') || nameLower.includes('created') || nameLower.includes('updated')) return 'datetime';
  if (nameLower.includes('amount') || nameLower.includes('price') || nameLower.includes('cost') || nameLower.includes('total')) return 'number';

  const sampleValues = values.filter(v => v && v.trim()).slice(0, 10);
  if (sampleValues.length === 0) return 'text';

  if (sampleValues.every(v => !isNaN(Number(v.replace(',', '.'))))) {
    return 'number';
  }

  // Multi-language boolean detection from i18n-utils
  if (allAreBooleans(sampleValues)) {
    return 'checkbox';
  }

  if (sampleValues.every(v => !isNaN(Date.parse(v)))) {
    return 'datetime';
  }

  if (sampleValues.every(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) {
    return 'email';
  }

  // Comma-separated lists without Notion URLs read as a (multi-)select field
  const hasCommaLists = sampleValues.filter(v => v.includes(',') && !v.includes('notion.so')).length;
  if (hasCommaLists >= sampleValues.length * 0.3) {
    return 'select';
  }

  return 'text';
}
