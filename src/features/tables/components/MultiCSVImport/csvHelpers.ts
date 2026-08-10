// Extracted from MultiCSVImportModal.tsx — pure CSV helpers + shared types.
// Behavior must remain identical to the original inline implementations.

export interface CSVFile {
  id: string;
  file: File;
  name: string;
  tableName: string;
  tableDisplayName: string;
  icon: string;
  showInMenu: boolean;
  headers: string[];
  data: string[][];
  columns: CSVColumnDef[];
  processed: boolean;
  createdTableId?: number;
}

export interface CSVColumnDef {
  csvColumn: string;
  name: string;
  displayName: string;
  type: string;
  isRelation: boolean;
  relationConfig?: {
    targetFileId: string;  // reference to another CSV file in batch
    targetTableId?: number; // for already created tables
    labelColumn: string;
    convertNotion: boolean;
  };
}

// Parse Notion relation format: "name (https://www.notion.so/name-xxx?pvs=21)"
export function parseNotionRelation(value: string): string[] {
  if (!value) return [];

  // Split by comma and extract names
  const parts = value.split(/,\s*/);
  return parts.map(part => {
    // Extract name before the (https://... part
    const match = part.match(/^([^(]+?)(?:\s*\(https:\/\/www\.notion\.so\/|$)/);
    if (match) {
      return match[1].trim();
    }
    return part.trim();
  }).filter(Boolean);
}

// Find matching row IDs by name
export function findMatchingIds(
  names: string[],
  targetRows: Array<{ id: number; data: Record<string, unknown> }>,
  labelColumn: string
): number[] {
  const ids: number[] = [];
  for (const name of names) {
    const normalizedName = name.toLowerCase().trim();
    const match = targetRows.find(row => {
      const rowValue = String(row.data[labelColumn] || '').toLowerCase().trim();
      return rowValue === normalizedName;
    });
    if (match) {
      ids.push(match.id);
    }
  }
  return ids;
}

// Parse CSV
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

// Detect if column contains Notion relations
export function detectNotionRelation(values: string[]): boolean {
  const sample = values.slice(0, 10).filter(v => v && v.trim());
  if (sample.length === 0) return false;

  // Check if values contain notion.so links
  return sample.some(v => v.includes('notion.so/'));
}

// Guess column type
export function guessColumnType(name: string, values: string[]): string {
  const nameLower = name.toLowerCase();

  if (nameLower.includes('email')) return 'email';
  if (nameLower.includes('phone') || nameLower.includes('tel')) return 'phone';
  if (nameLower.includes('url') || nameLower.includes('link') || nameLower.includes('website')) return 'url';
  if (nameLower.includes('date') || nameLower.includes('created') || nameLower.includes('updated')) return 'date';
  if (nameLower.includes('amount') || nameLower.includes('price') || nameLower.includes('cost')) return 'number';

  const sampleValues = values.filter(v => v && v.trim()).slice(0, 10);
  if (sampleValues.length === 0) return 'text';

  // Check for Notion relations first
  if (detectNotionRelation(sampleValues)) {
    return 'relation'; // Will be processed specially
  }

  if (sampleValues.every(v => !isNaN(Number(v.replace(',', '.'))))) {
    return 'number';
  }

  const boolValues = ['true', 'false', '1', '0', 'yes', 'no', 'да', 'нет'];
  if (sampleValues.every(v => boolValues.includes(v.toLowerCase()))) {
    return 'checkbox';
  }

  return 'text';
}

// Convert value based on type
export function convertValue(value: string, type: string): unknown {
  if (!value || value.trim() === '') return null;

  switch (type) {
    case 'number': {
      const num = Number(value.replace(',', '.').replace(/\s/g, ''));
      return isNaN(num) ? null : num;
    }
    case 'checkbox': {
      const lower = value.toLowerCase();
      return ['true', '1', 'yes', 'да'].includes(lower);
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
