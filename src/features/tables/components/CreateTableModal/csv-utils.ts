import { allAreBooleans } from '@/shared/utils/i18n-utils';

// Parse CSV with support for both comma and semicolon delimiters
export function parseCSV(text: string): string[][] {
  const firstLine = text.split('\n')[0];
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const delimiter = semicolonCount > commaCount ? ';' : ',';

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (insideQuotes) {
      if (char === '"' && nextChar === '"') {
        currentCell += '"';
        i++;
      } else if (char === '"') {
        insideQuotes = false;
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === delimiter) {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
        currentRow.push(currentCell.trim());
        if (currentRow.some(cell => cell !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
        if (char === '\r') i++;
      } else if (char !== '\r') {
        currentCell += char;
      }
    }
  }

  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some(cell => cell !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}

// Guess column type from values
export function guessColumnType(name: string, values: string[]): string {
  const nameLower = name.toLowerCase();

  if (nameLower.includes('email')) return 'email';
  if (nameLower.includes('phone') || nameLower.includes('tel')) return 'phone';
  if (nameLower.includes('url') || nameLower.includes('link') || nameLower.includes('website')) return 'url';
  if (nameLower.includes('date') || nameLower.includes('created') || nameLower.includes('updated')) return 'date';
  if (nameLower.includes('amount') || nameLower.includes('price') || nameLower.includes('cost') || nameLower.includes('total')) return 'number';

  const sampleValues = values.filter(v => v && v.trim()).slice(0, 10);
  if (sampleValues.length === 0) return 'text';

  if (sampleValues.every(v => !isNaN(Number(v.replace(',', '.'))))) {
    return 'number';
  }

  // Use multi-language boolean detection from i18n-utils
  if (allAreBooleans(sampleValues)) {
    return 'checkbox';
  }

  if (sampleValues.every(v => !isNaN(Date.parse(v)))) {
    return 'date';
  }

  if (sampleValues.every(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) {
    return 'email';
  }

  // Check if values look like comma-separated lists (multi-select from Notion)
  // If most values contain commas and no Notion URLs - likely a select/tags field
  const hasCommaLists = sampleValues.filter(v => v.includes(',') && !v.includes('notion.so')).length;
  if (hasCommaLists >= sampleValues.length * 0.3) {
    return 'select'; // Will be treated as multi-select
  }

  return 'text';
}
