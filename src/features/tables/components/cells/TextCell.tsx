import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import { SafeHtml } from '@/shared/components/SafeHtml';
import type { TextColumnConfig, ColumnRelationConfig } from '../../types/table.types';
import type { LensedValue } from '../../utils/resolveLens';
import { useLensedValue } from '../../hooks/useRelationLookup';
import { resolveRowTemplate } from '../../utils/resolveRowTemplate';

interface TextCellProps {
  value: unknown;
  rawMode?: boolean;
  cellFormat?: {
    mode?: 'text' | 'html' | 'markdown' | 'formula';
  };
  textConfig?: TextColumnConfig;
  relation?: ColumnRelationConfig;
  /** ADR-205: lens resolved by renderCellValue from the server map; absent → client lookup. */
  lensed?: LensedValue;
  rowData?: Record<string, unknown>;
  /** Callback for inline content updates (enables interactive checkboxes in markdown mode) */
  onValueChange?: (newValue: string) => void;
}

// `{{variable}}` substitution lives in utils/resolveRowTemplate (ADR-0035-A §Amendment 1):
// one resolver shared with AddressCell, behaviour unchanged (incl. the {{row_id}} system variable).
const replaceVariables = resolveRowTemplate;

export const TextCell = ({ value, rawMode, cellFormat, textConfig, relation, lensed, rowData = {}, onValueChange }: TextCellProps) => {
  // Lens: server map when the grid delivered one, shared client lookup otherwise.
  const lens = useLensedValue(value, relation, lensed, 'single');

  // RAW mode - show data as-is with NULL for empty
  if (rawMode) {
    if (value === null || value === undefined) {
      return <span className="font-mono text-xs text-[var(--text-tertiary)]">NULL</span>;
    }
    return (
      <span className="font-mono text-xs text-[var(--text-secondary)]">
        {String(value)}
      </span>
    );
  }

  // Calculate display value
  let displayValue: string;
  
  // If formula is set, use it to compute the value
  if (textConfig?.formula) {
    displayValue = replaceVariables(textConfig.formula, rowData);
  } else if (relation?.enabled && value !== null && value !== undefined && value !== '') {
    // If relation is enabled, show the related row's label (raw key until resolved)
    displayValue = lens.label || String(value);
  } else {
    // Use the cell value directly
    if (value === null || value === undefined || value === '') {
      // Even empty values can have prefix/suffix
      if (!textConfig?.prefix && !textConfig?.suffix) {
        return <span className="text-[var(--text-tertiary)] italic">Empty</span>;
      }
      displayValue = '';
    } else {
      displayValue = String(value);
    }
  }
  
  // Apply prefix and suffix (they can also contain variables)
  const prefix = textConfig?.prefix ? replaceVariables(textConfig.prefix, rowData) : '';
  const suffix = textConfig?.suffix ? replaceVariables(textConfig.suffix, rowData) : '';
  
  const finalValue = `${prefix}${displayValue}${suffix}`;
  
  // If final value is empty after all processing
  if (!finalValue.trim()) {
    return <span className="text-[var(--text-tertiary)] italic">Empty</span>;
  }
  
  // HTML mode - render HTML content (sanitized for XSS protection)
  if (cellFormat?.mode === 'html') {
    return (
      <SafeHtml 
        html={finalValue} 
        className="text-sm prose prose-sm max-w-none dark:prose-invert"
      />
    );
  }
  
  // Markdown mode - render Markdown content
  if (cellFormat?.mode === 'markdown') {
    return (
      <MarkdownPreview
        content={finalValue}
        className="text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
        onContentChange={onValueChange}
      />
    );
  }
  
  return (
    <span className="text-sm">
      {finalValue}
    </span>
  );
};
