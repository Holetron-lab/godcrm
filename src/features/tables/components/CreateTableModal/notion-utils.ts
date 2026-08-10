import { BOOL_TRUE_VALUES } from '@/shared/utils/i18n-utils';

// Generate our own ID for items without Notion URL
// Format: 00000_{name_hash}_{timestamp} - 00000 prefix makes it easy to identify as ours
export function generateLocalId(name: string): string {
  const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 10);
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `00000${cleanName}${timestamp}${random}`;
}

// Check if an ID is our generated one (starts with 00000)
export function isGeneratedId(id: string): boolean {
  return id.startsWith('00000');
}

// Extract pure 32-char ID from name-id format
export function getIdFromNameId(nameId: string): string {
  if (!nameId) return '';
  // Check if in name-id format: xxx-32hexchars
  const match = nameId.match(/-([a-f0-9]{32})$/i);
  if (match) return match[1].toLowerCase();
  // Check if already pure 32-char id
  if (/^[a-f0-9]{32}$/i.test(nameId)) return nameId.toLowerCase();
  return nameId;
}

// Convert name to Notion key format: "Piercing By Tesla" -> "piercing_by_tesla"
// Supports all Unicode letters (Latin, Cyrillic, Chinese, Japanese, Arabic, Hebrew, etc.)
export function toNotionKey(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')           // spaces -> underscores
    .replace(/[^\p{L}\p{N}_]/gu, '') // remove non-letters, non-numbers (Unicode-aware)
    .replace(/_+/g, '_')            // collapse multiple underscores
    .replace(/^_|_$/g, '');         // trim underscores
}

// Extract Notion URLs from a value
export function extractNotionUrls(value: string): string[] {
  if (!value) return [];
  const matches = value.match(/https?:\/\/(?:www\.)?notion\.so[^)\s]+/g);
  return matches || [];
}

// Extract pure 32-char Notion ID from URL
export function extractNotionIdPure(value: string): string | null {
  if (!value) return null;

  // First, check if value itself is a 32-char hex ID
  const directId = value.trim().replace(/[^a-f0-9]/gi, '');
  if (directId.length === 32 && /^[a-f0-9]+$/i.test(directId)) {
    return directId.toLowerCase();
  }

  // Look for Notion URL pattern
  const urlMatch = value.match(/https?:\/\/(?:www\.)?notion\.so\/[^)\s]+/);
  if (!urlMatch) {
    // Try to find 32-char hex anywhere in the string
    const hexMatch = value.match(/[a-f0-9]{32}/i);
    if (hexMatch) return hexMatch[0].toLowerCase();
    return null;
  }

  let url = urlMatch[0];

  // Remove query string parameters (e.g., ?pvs=21) before extracting ID
  url = url.replace(/\?.*$/, '');

  // Pattern 1: Look for 32-char hex ID directly (may be hyphenated with name: name-32hexchars)
  // The ID format in Notion URLs is typically: pagename-32hexchars OR just 32hexchars
  const idMatch = url.match(/-([a-f0-9]{32})$/i) || url.match(/\/([a-f0-9]{32})$/i);
  if (idMatch) return idMatch[1].toLowerCase();

  // Pattern 2: ID might be in segments separated by hyphens
  // e.g., https://www.notion.so/piercing_By_tesla-2640daec7d5a81fe9c2af5f1346452dd
  const lastHyphenIndex = url.lastIndexOf('-');
  if (lastHyphenIndex !== -1) {
    const potentialId = url.substring(lastHyphenIndex + 1).replace(/[^a-f0-9]/gi, '');
    if (potentialId.length === 32 && /^[a-f0-9]+$/i.test(potentialId)) {
      return potentialId.toLowerCase();
    }
  }

  // Pattern 3: Try to find any 32-char hex sequence in the URL
  const hexMatch = url.match(/[a-f0-9]{32}/i);
  if (hexMatch) return hexMatch[0].toLowerCase();

  // Pattern 4: Split by segments and find the one that looks like an ID
  const segments = url.split(/[-/]/);
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i].replace(/[^a-f0-9]/gi, '');
    if (seg.length >= 32) {
      return seg.substring(0, 32).toLowerCase();
    }
  }

  return null;
}

// Extract Notion ID with name prefix: "name-id" format
// Example: "piercing_By_tesla-2640daec7d5a81fe9c2af5f1346452dd"
// Input: "piercing_By_tesla (https://www.notion.so/piercing_By_tesla-2640daec7d5a81fe9c2af5f1346452dd?pvs=21)"
// Output: "piercing_By_tesla-2640daec7d5a81fe9c2af5f1346452dd"
export function extractNotionId(value: string): string | null {
  if (!value) return null;

  // Check if already in name-id format (has name part + 32 hex chars at end)
  const nameIdMatch = value.match(/^(.+)-([a-f0-9]{32})$/i);
  if (nameIdMatch) {
    return value.toLowerCase();
  }

  // Extract URL from the value (handles format: "Name (https://notion.so/...)")
  const urlMatch = value.match(/https?:\/\/(?:www\.)?notion\.so\/([^?\s)]+)/i);
  if (urlMatch) {
    // URL path contains the name-id: e.g., "piercing_By_tesla-2640daec7d5a81fe9c2af5f1346452dd"
    const pathPart = urlMatch[1];

    // The path should be in format: name-32hexchars
    // Find the last occurrence of a 32-char hex ID (it comes after the last hyphen before any query params)
    const pathClean = pathPart.replace(/\?.*$/, ''); // Remove query params

    // Match the pattern: anything + hyphen + 32 hex chars at the end
    const fullIdMatch = pathClean.match(/^(.+)-([a-f0-9]{32})$/i);
    if (fullIdMatch) {
      const namePart = fullIdMatch[1];
      const hexPart = fullIdMatch[2].toLowerCase();
      return `${namePart}-${hexPart}`;
    }

    // Fallback: just find 32-char hex anywhere
    const hexMatch = pathClean.match(/[a-f0-9]{32}/i);
    if (hexMatch) {
      // Try to get name from before the URL
      const nameBeforeUrl = value.match(/^([^(]+)\s*\(/i);
      if (nameBeforeUrl) {
        const name = nameBeforeUrl[1].trim()
          .replace(/[^a-zA-Z0-9\u0400-\u04FF_.-]/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_|_$/g, '');
        if (name) {
          return `${name}-${hexMatch[0].toLowerCase()}`;
        }
      }
      return hexMatch[0].toLowerCase();
    }
  }

  // No URL found, try to extract pure ID from the value directly
  const pureId = extractNotionIdPure(value);
  if (!pureId) return null;

  // Try to get name from the value (before any URL or special chars)
  const nameBeforeUrl = value.match(/^([^(]+)\s*\(/i);
  if (nameBeforeUrl) {
    const name = nameBeforeUrl[1].trim()
      .replace(/[^a-zA-Z0-9\u0400-\u04FF_.-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 50);
    if (name) {
      return `${name}-${pureId}`;
    }
  }

  return pureId;
}

// Extract all Notion IDs from a cell (for relations with multiple values)
export function extractAllNotionIds(value: string): string[] {
  if (!value) return [];

  const urls = extractNotionUrls(value);
  const ids: string[] = [];

  for (const url of urls) {
    const id = extractNotionId(url);
    if (id) ids.push(id);
  }

  return ids;
}

// Parse Notion relation format: "Name (https://notion.so/...)" or "Name1, Name2 (https://...)"
// Returns extracted names without the Notion URLs
export function parseNotionRelation(value: string): string[] | null {
  if (!value) return null;

  // Pattern for Notion URL
  const notionUrlPattern = /\(https?:\/\/(?:www\.)?notion\.so[^)]+\)/g;

  // Check if value contains Notion URLs
  if (!notionUrlPattern.test(value)) return null;

  // Remove all Notion URLs and extract names
  const cleanedValue = value.replace(notionUrlPattern, '').trim();

  // Split by comma and clean up
  const names = cleanedValue
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  return names.length > 0 ? names : null;
}

// Check if column values look like Notion relations
export function isNotionRelationColumn(values: string[]): boolean {
  const sampleValues = values.filter(v => v && v.trim()).slice(0, 10);
  if (sampleValues.length === 0) return false;

  // At least 30% of non-empty values should contain Notion URLs
  const notionCount = sampleValues.filter(v =>
    /\(https?:\/\/(?:www\.)?notion\.so[^)]+\)/.test(v)
  ).length;

  return notionCount / sampleValues.length >= 0.3;
}

// Convert value based on type
export function convertValue(value: string, type: string): unknown {
  if (!value || value.trim() === '') return null;

  switch (type) {
    case 'number':
      const num = Number(value.replace(',', '.').replace(/\s/g, ''));
      return isNaN(num) ? null : num;
    case 'checkbox':
      const lower = value.toLowerCase().trim();
      return BOOL_TRUE_VALUES.includes(lower as typeof BOOL_TRUE_VALUES[number]);
    case 'date':
    case 'datetime':
      const date = new Date(value);
      return isNaN(date.getTime()) ? value : date.toISOString();
    default:
      return value;
  }
}
