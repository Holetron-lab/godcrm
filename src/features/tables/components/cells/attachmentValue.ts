/**
 * Shared normalisation for image/file cell values.
 *
 * Native CRM rows store attachments as a comma-separated string of URLs.
 * External data sources (MySQL JSON columns, e.g. Laravel media arrays) hand
 * the frontend the parsed JSON instead: an array of strings, an array of
 * objects like `{ main: true, path: "level/products/x.jpg", order: 0 }`, or a
 * single such object. Before this helper every renderer did `String(value)`
 * and showed "[object Object]" for anything that was not a plain string.
 */

const URL_KEYS = ['url', 'path', 'src', 'file', 'filename', 'href'] as const;

interface AttachmentObject {
  [key: string]: unknown;
  main?: unknown;
  order?: unknown;
}

const isRecord = (v: unknown): v is AttachmentObject => typeof v === 'object' && v !== null && !Array.isArray(v);

const urlFromObject = (obj: AttachmentObject): string | null => {
  for (const key of URL_KEYS) {
    const candidate = obj[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
};

const splitCommaList = (str: string): string[] =>
  str.split(',').map((url) => url.trim()).filter(Boolean);

/**
 * Normalise an attachment cell value into an ordered list of URL-or-path strings.
 * Object entries are ordered main-first, then by their numeric `order`; entries
 * without a recognisable URL key are dropped.
 */
export const parseAttachmentUrls = (value: unknown): string[] => {
  if (value === null || value === undefined || value === '') return [];

  if (typeof value === 'string') {
    const str = value.trim();
    if (!str) return [];
    if (str.startsWith('[') || str.startsWith('{')) {
      try {
        return parseAttachmentUrls(JSON.parse(str));
      } catch {
        return splitCommaList(str);
      }
    }
    return splitCommaList(str);
  }

  if (Array.isArray(value)) {
    const objects = value.filter(isRecord);
    if (objects.length === value.length && objects.length > 0) {
      return objects
        .map((obj, index) => ({ obj, index }))
        .sort((a, b) => {
          const mainDiff = Number(Boolean(b.obj.main)) - Number(Boolean(a.obj.main));
          if (mainDiff !== 0) return mainDiff;
          const orderA = typeof a.obj.order === 'number' ? a.obj.order : Number.POSITIVE_INFINITY;
          const orderB = typeof b.obj.order === 'number' ? b.obj.order : Number.POSITIVE_INFINITY;
          if (orderA !== orderB) return orderA - orderB;
          return a.index - b.index;
        })
        .map(({ obj }) => urlFromObject(obj))
        .filter((url): url is string => Boolean(url));
    }
    return value.flatMap((entry) => parseAttachmentUrls(entry));
  }

  if (isRecord(value)) {
    const url = urlFromObject(value);
    return url ? [url] : [];
  }

  return splitCommaList(String(value));
};

/** Alias kept for readability at image call sites. */
export const parseImageUrls = parseAttachmentUrls;

/** Resolve `{{column}}` / `{{row_id}}` placeholders against the row. */
export const resolveAttachmentFormula = (formula: string, rowData?: Record<string, unknown>): string => {
  if (!formula || !rowData) return formula || '';
  return formula.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    if (key === 'row_id') {
      const rowId = rowData['id'] ?? rowData['row_id'] ?? rowData['_id'];
      return rowId !== undefined && rowId !== null ? String(rowId) : '';
    }
    const val = rowData[key];
    return val !== undefined && val !== null ? String(val) : '';
  });
};

export interface AttachmentFileConfig {
  prefix?: string;
  suffix?: string;
  formula?: string;
  saveFormat?: 'url' | 'filename' | 'path';
}

const isAbsoluteUrl = (url: string): boolean => /^(https?:)?\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:');

/**
 * Turn a stored URL-or-path into a displayable URL: absolute URLs pass through,
 * relative paths get the configured prefix/suffix (with placeholders resolved).
 */
export const resolveAttachmentUrl = (url: string, fileConfig?: AttachmentFileConfig, rowData?: Record<string, unknown>): string => {
  // Space uploads already carry a complete local URL, independent of a
  // column's external-source prefix/suffix configuration.
  if (isAbsoluteUrl(url) || /^\/uploads\/spaces\/[1-9]\d*\//.test(url)) return url;
  const prefix = fileConfig?.prefix ? resolveAttachmentFormula(fileConfig.prefix, rowData) : '';
  const suffix = fileConfig?.suffix ? resolveAttachmentFormula(fileConfig.suffix, rowData) : '';
  return `${prefix}${url}${suffix}`;
};
