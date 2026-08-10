import type { ColumnModel, RowModel } from '@/features/tables/types/table.types';

type Orientation = 'portrait' | 'landscape';

export type RelationOptionsMap = Map<string, Map<string, { label: string; color?: string }>>;

export interface GeneratePageHTMLParams {
  printData: { columns: ColumnModel[]; rows: RowModel[]; tableName: string };
  selectedColumns: ColumnModel[];
  orientation: Orientation;
  scale: number;
  colorMode: boolean;
  relationOptionsMap: RelationOptionsMap | undefined;
  totalPages: number;
  pageNum: number;
  forPrint: boolean;
  getPageRange: (pageNum: number) => { startIdx: number; endIdx: number };
}

// Get label and color from column options (config.options, settings.options, or loaded relation data)
export const getOptionInfo = (
  value: string,
  column: ColumnModel,
  relationOptionsMap: RelationOptionsMap | undefined
): { label: string; color?: string } => {
  // First check loaded relation data
  if (relationOptionsMap) {
    const colRelationMap = relationOptionsMap.get(column.id);
    if (colRelationMap) {
      const relatedItem = colRelationMap.get(String(value));
      if (relatedItem) {
        return relatedItem;
      }
    }
  }

  // Check config.options (primary location)
  const options = column.config?.options || column.settings?.options || [];
  const option = options.find((opt: { value: string; label?: string; color?: string }) =>
    String(opt.value) === String(value)
  );
  return {
    label: option?.label || value,
    color: option?.color
  };
};

export const getBadgeColor = (
  value: string,
  column: ColumnModel,
  relationOptionsMap: RelationOptionsMap | undefined
): { bg: string; text: string } => {
  const optionInfo = getOptionInfo(value, column, relationOptionsMap);
  if (optionInfo.color) {
    return { bg: optionInfo.color, text: '#fff' };
  }
  const colorMap: Record<string, { bg: string; text: string }> = {
    'Размер': { bg: '#6366f1', text: '#fff' },
    'new': { bg: '#10b981', text: '#fff' },
    'pending': { bg: '#f59e0b', text: '#fff' },
    'done': { bg: '#22c55e', text: '#fff' },
    'active': { bg: '#3b82f6', text: '#fff' },
    'inactive': { bg: '#6b7280', text: '#fff' },
  };
  return colorMap[value] || { bg: '#e5e7eb', text: '#374151' };
};

export const escapeHtml = (str: string): string => {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
};

export const formatCellValue = (
  column: ColumnModel,
  value: unknown,
  useColor: boolean,
  relationOptionsMap: RelationOptionsMap | undefined
): string => {
  if (value === null || value === undefined) return '';

  switch (column.type) {
    case 'checkbox':
      if (useColor) {
        const isChecked = value === true || value === 1 || value === '1' || value === 'true';
        return isChecked
          ? '<span style="color: #22c55e; font-weight: bold;">✓</span>'
          : '<span style="color: #ef4444;">✗</span>';
      }
      return value === true || value === 1 || value === '1' || value === 'true' ? '✓' : '✗';

    case 'date':
      if (!value) return '';
      try {
        return new Date(value as string).toLocaleDateString('ru-RU');
      } catch {
        return String(value);
      }

    case 'datetime':
      if (!value) return '';
      try {
        return new Date(value as string).toLocaleString('ru-RU');
      } catch {
        return String(value);
      }

    case 'number':
    case 'integer':
    case 'float':
    case 'decimal':
      return typeof value === 'number' ? value.toLocaleString('ru-RU') : String(value);

    case 'select': {
      const optInfo = getOptionInfo(String(value), column, relationOptionsMap);
      if (useColor && value) {
        const { bg, text } = getBadgeColor(String(value), column, relationOptionsMap);
        return '<span style="display: inline-block; padding: 2px 8px; border-radius: 9999px; background-color: ' + bg + '; color: ' + text + '; font-size: 0.85em; white-space: nowrap;">' + escapeHtml(optInfo.label) + '</span>';
      }
      return optInfo.label;
    }

    case 'multi-select':
    case 'multi_select':
      if (Array.isArray(value)) {
        if (useColor) {
          return value.map(v => {
            const optInfo = getOptionInfo(String(v), column, relationOptionsMap);
            const { bg, text } = getBadgeColor(String(v), column, relationOptionsMap);
            return '<span style="display: inline-block; padding: 2px 8px; border-radius: 9999px; background-color: ' + bg + '; color: ' + text + '; font-size: 0.85em; margin: 1px; white-space: nowrap;">' + escapeHtml(optInfo.label) + '</span>';
          }).join(' ');
        }
        return value.map(v => getOptionInfo(String(v), column, relationOptionsMap).label).join(', ');
      }
      return getOptionInfo(String(value), column, relationOptionsMap).label;

    case 'relation':
      if (Array.isArray(value)) {
        const values = value.map(v => {
          if (typeof v === 'object' && v !== null) {
            return (v as Record<string, unknown>).display_value || (v as Record<string, unknown>).id || '';
          }
          // Try to get label from options for relation columns with relation config
          return getOptionInfo(String(v), column, relationOptionsMap).label;
        });
        if (useColor) {
          return values.map(v =>
            '<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; background-color: #dbeafe; color: #1e40af; font-size: 0.85em; margin: 1px;">' + escapeHtml(String(v)) + '</span>'
          ).join(' ');
        }
        return values.join(', ');
      }
      if (typeof value === 'object' && value !== null) {
        const display = (value as Record<string, unknown>).display_value as string || String((value as Record<string, unknown>).id || '');
        if (useColor) {
          return '<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; background-color: #dbeafe; color: #1e40af; font-size: 0.85em;">' + escapeHtml(display) + '</span>';
        }
        return display;
      }
      // Single value - try to get label from options
      return getOptionInfo(String(value), column, relationOptionsMap).label;

    case 'url':
    case 'link':
      if (useColor && value) {
        return '<a href="' + escapeHtml(String(value)) + '" style="color: #3b82f6; text-decoration: underline;">' + escapeHtml(String(value)) + '</a>';
      }
      return String(value);

    case 'email':
      if (useColor && value) {
        return '<a href="mailto:' + escapeHtml(String(value)) + '" style="color: #3b82f6; text-decoration: underline;">' + escapeHtml(String(value)) + '</a>';
      }
      return String(value);

    default:
      return escapeHtml(String(value));
  }
};

// Get column style for printing
export const getColumnStyle = (col: ColumnModel): string => {
  const styles: string[] = [];

  // Width (convert px to mm approximately, assuming 96dpi: 1px ≈ 0.26mm)
  if (col.width && col.width > 0) {
    const widthMm = Math.round(col.width * 0.26);
    styles.push('width: ' + widthMm + 'mm');
    styles.push('min-width: ' + widthMm + 'mm');
  }

  // Alignment
  const align = col.config?.appearance?.align;
  if (align) {
    styles.push('text-align: ' + align);
  }

  // Text wrap
  const textWrap = col.config?.cellFormat?.textWrap;
  if (textWrap === 'nowrap') {
    styles.push('white-space: nowrap');
    styles.push('overflow: hidden');
    styles.push('text-overflow: ellipsis');
  } else if (textWrap === 'wrap-ellipsis') {
    styles.push('overflow: hidden');
    styles.push('text-overflow: ellipsis');
    styles.push('display: -webkit-box');
    styles.push('-webkit-line-clamp: 3');
    styles.push('-webkit-box-orient: vertical');
  } else {
    // Default: wrap
    styles.push('word-break: break-word');
  }

  return styles.length > 0 ? ' style="' + styles.join('; ') + '"' : '';
};

export const generatePageHTML = (params: GeneratePageHTMLParams): string => {
  const {
    printData,
    selectedColumns,
    orientation,
    scale,
    colorMode,
    relationOptionsMap,
    totalPages,
    pageNum,
    forPrint,
    getPageRange,
  } = params;

  if (!printData || selectedColumns.length === 0) return '';

  const allRows = printData.rows;
  let startIdx: number;
  let endIdx: number;

  if (forPrint) {
    // For full print, include all rows
    startIdx = 0;
    endIdx = allRows.length;
  } else {
    // For preview, use page-specific range
    const range = getPageRange(pageNum);
    startIdx = range.startIdx;
    endIdx = range.endIdx;
  }
  const pageRows = allRows.slice(startIdx, endIdx);

  const tableRows = pageRows.map((row, idx) => {
    const cells = selectedColumns.map(col => {
      const value = row.data[col.name] ?? row.data[col.id];
      const cellStyle = getColumnStyle(col);
      return '<td' + cellStyle + '>' + formatCellValue(col, value, colorMode, relationOptionsMap) + '</td>';
    }).join('');
    const rowClass = colorMode && idx % 2 === 1 ? 'class="even-row"' : '';
    return '<tr ' + rowClass + '>' + cells + '</tr>';
  }).join('');

  const headerCells = selectedColumns.map(col => {
    const headerStyle = getColumnStyle(col);
    return '<th' + headerStyle + '>' + escapeHtml(col.displayName || col.name) + '</th>';
  }).join('');

  const pageSize = orientation === 'portrait'
    ? '@page { size: A4 portrait; margin: 15mm; }'
    : '@page { size: A4 landscape; margin: 10mm; }';

  const colorStyles = colorMode ? '\n      th {\n        background-color: #1e40af !important;\n        color: white !important;\n      }\n      .even-row {\n        background-color: #f8fafc !important;\n      }\n      tr:hover {\n        background-color: #f1f5f9 !important;\n      }\n    ' : '\n      th {\n        background-color: #f0f0f0;\n      }\n      tr:nth-child(even) {\n        background-color: #fafafa;\n      }\n    ';

  const pageBreakStyles = forPrint ? '\n      .page-break {\n        page-break-before: always;\n      }\n      tr {\n        page-break-inside: avoid;\n        page-break-after: auto;\n      }\n      thead {\n        display: table-header-group;\n      }\n    ' : '';

  const printInfo = forPrint
    ? 'Дата: ' + new Date().toLocaleString('ru-RU') + ' | Записей: ' + allRows.length + ' | Колонок: ' + selectedColumns.length
    : 'Страница ' + pageNum + ' из ' + totalPages + ' | Записей на странице: ' + pageRows.length;

  const borderColor = colorMode ? '#e2e8f0' : '#ddd';
  const titleColor = colorMode ? 'color: #1e40af;' : '';
  const borderBottomColor = colorMode ? '#1e40af' : '#333';

  const titleText = printData.tableName;

  // Calculate scale factor for CSS (use zoom for proper sizing)
  const scaleValue = scale / 100;

  return '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n  <title>' + escapeHtml(printData.tableName) + ' - Печать</title>\n  <style>\n    * {\n      box-sizing: border-box;\n    }\n    ' + pageSize + '\n    html, body {\n      margin: 0;\n      padding: 0;\n    }\n    body {\n      font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, \'Helvetica Neue\', Arial, sans-serif;\n      font-size: 10pt;\n      line-height: 1.3;\n      padding: 10mm;\n      color: #000;\n      background: #fff;\n      zoom: ' + scaleValue + ';\n      overflow-x: auto;\n      overflow-y: hidden;\n    }\n    h1 {\n      font-size: 12pt;\n      margin: 0 0 4px 0;\n      padding-bottom: 4px;\n      border-bottom: 1px solid ' + borderBottomColor + ';\n      ' + titleColor + '\n    }\n    .meta {\n      font-size: 8pt;\n      color: #666;\n      margin-bottom: 8px;\n    }\n    table {\n      width: 100%;\n      border-collapse: collapse;\n      margin-top: 4px;\n    }\n    th, td {\n      border: 1px solid ' + borderColor + ';\n      padding: 2px 4px;\n      text-align: left;\n      vertical-align: top;\n      line-height: 1.3;\n    }\n    th {\n      font-weight: 600;\n      font-size: 9pt;\n      white-space: nowrap;\n    }\n    td {\n      font-size: 9pt;\n    }\n    ' + colorStyles + '\n    @media print {\n      body {\n        padding: 0;\n        zoom: ' + scaleValue + ';\n        overflow: visible;\n        -webkit-print-color-adjust: exact;\n        print-color-adjust: exact;\n        color-adjust: exact;\n      }\n      ' + pageBreakStyles + '\n    }\n  </style>\n</head>\n<body>\n  <h1>' + escapeHtml(titleText) + '</h1>\n  <div class="meta">\n    ' + printInfo + '\n  </div>\n  <table>\n    <thead>\n      <tr>' + headerCells + '</tr>\n    </thead>\n    <tbody>\n      ' + tableRows + '\n    </tbody>\n  </table>\n</body>\n</html>';
};
