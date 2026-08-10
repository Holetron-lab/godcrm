import { useMemo, useState } from 'react';
import { HelpCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { FieldRenderer } from '../modals/FieldRenderer';
import { Button } from '@/shared/components/ui';
import { SafeHtml } from '@/shared/components/SafeHtml';
import type { ColumnModel } from '../../types/table.types';
import type { FormConfig, FormField, FormElement, FormDivider, FormTextBlock, FormPageBreak } from '../../types/form-config.types';

type ViewMode = 'with-keys' | 'standard' | 'compact';

interface DynamicFormRendererProps {
  config: FormConfig;
  columns: ColumnModel[];
  formData: Record<string, unknown>;
  onChange: (fieldId: string, value: unknown) => void;
  mode?: 'edit' | 'add';
  // Column IDs whose values were supplied by the caller (e.g. kanban "+" prefill).
  // Hidden fields in this set are forced visible so the user can see the prefilled value.
  prefilledColumnIds?: Set<string>;
}

// Type guards
const isField = (item: FormField | FormElement): item is FormField =>
  !('type' in item) || item.type === 'field' || item.type === undefined;
const isDivider = (item: FormField | FormElement): item is FormDivider =>
  'type' in item && item.type === 'divider';
const isTextBlock = (item: FormField | FormElement): item is FormTextBlock =>
  'type' in item && item.type === 'text';
const isPageBreak = (item: FormField | FormElement): item is FormPageBreak =>
  'type' in item && item.type === 'page-break';

// Parse variables like {{column_key}} in text
function parseVariables(text: string, data: Record<string, unknown>, columns: ColumnModel[]): string {
  if (!text) return '';
  
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    // Try to find by column name or id
    const column = columns.find(c => c.name === key || c.id === key);
    if (column) {
      const value = data[column.id] ?? data[column.name];
      return value !== undefined ? String(value) : match;
    }
    // Direct key lookup
    if (data[key] !== undefined) {
      return String(data[key]);
    }
    return match;
  });
}

// Render description with HTML/Markdown support
function RenderDescription({ 
  text, 
  data, 
  columns 
}: { 
  text: string; 
  data: Record<string, unknown>; 
  columns: ColumnModel[];
}) {
  const parsed = parseVariables(text, data, columns);
  
  // Simple markdown: **bold**, *italic*, `code`, [link](url)
  const html = parsed
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="px-1 py-0.5 bg-[var(--bg-tertiary)] rounded text-xs">$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-[var(--color-primary-500)] hover:underline" target="_blank">$1</a>');

  return (
    <SafeHtml 
      html={html}
      as="span"
      className="text-xs text-[var(--text-tertiary)]"
    />
  );
}

/**
 * Renders a dynamic form based on FormConfig
 * Supports grid layout, field widths, help text, conditions, variables
 */
export function DynamicFormRenderer({
  config,
  columns,
  formData,
  onChange,
  mode = 'edit',
  prefilledColumnIds
}: DynamicFormRendererProps) {
  const [currentPage, setCurrentPage] = useState(1);
  
  // Build column lookup map
  const columnMap = useMemo(() => {
    const map = new Map<string, ColumnModel>();
    columns.forEach(col => map.set(col.id, col));
    return map;
  }, [columns]);

  // Settings
  const showLabels = config.settings?.showLabels !== false;
  const viewMode: ViewMode = config.settings?.viewMode || 'standard';
  const spacing = config.settings?.spacing || 'normal';
  const spacingClass = spacing === 'compact' ? 'gap-2' : spacing === 'relaxed' ? 'gap-6' : 'gap-4';

  // Check field conditions
  const isFieldVisible = (field: FormField): boolean => {
    if (field.hidden && !prefilledColumnIds?.has(field.columnId)) return false;
    if (!field.conditions || field.conditions.length === 0) return true;

    return field.conditions.every(condition => {
      const conditionField = config.fields.find(f => f.columnId === condition.field);
      if (!conditionField) return true;

      const fieldValue = formData[conditionField.columnId];

      switch (condition.operator) {
        case 'equals':
          return fieldValue === condition.value;
        case 'not_equals':
          return fieldValue !== condition.value;
        case 'contains':
          return String(fieldValue || '').includes(String(condition.value || ''));
        case 'not_contains':
          return !String(fieldValue || '').includes(String(condition.value || ''));
        case 'is_empty':
          return fieldValue === null || fieldValue === undefined || fieldValue === '';
        case 'is_not_empty':
          return fieldValue !== null && fieldValue !== undefined && fieldValue !== '';
        case 'greater_than':
          return Number(fieldValue) > Number(condition.value);
        case 'less_than':
          return Number(fieldValue) < Number(condition.value);
        default:
          return true;
      }
    });
  };

  // Combine fields and elements, sort by order
  const allItems = useMemo(() => {
    const fields = config.fields.filter(isFieldVisible);
    const elements = config.elements || [];
    return [...fields, ...elements].sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [config.fields, config.elements, formData]);

  // Split items into pages
  const pages = useMemo(() => {
    const result: (FormField | FormElement)[][] = [[]];
    let pageIndex = 0;

    for (const item of allItems) {
      if (isPageBreak(item)) {
        pageIndex++;
        result[pageIndex] = [];
      } else {
        result[pageIndex].push(item);
      }
    }

    return result;
  }, [allItems]);

  const totalPages = pages.length;
  const currentPageItems = pages[currentPage - 1] || [];

  // Get width class for field
  const getWidthClass = (width: FormField['width']): string => {
    switch (width) {
      case 'quarter': return 'w-1/4';
      case 'third': return 'w-1/3';
      case 'half': return 'w-1/2';
      case 'full':
      default: return 'w-full';
    }
  };

  // Render a single field
  const renderField = (field: FormField) => {
    const column = columnMap.get(field.columnId);
    if (!column) return null;

    const fieldValue = formData[field.columnId];
    const isDisabled = field.readonly || (mode === 'edit' && column.isReadonly);
    const isCheckbox = column.type === 'checkbox';
    const displayName = field.label || column.displayName || column.name;
    const isRequired = field.required || column.isRequired;

    // Checkbox rendering - clean style without borders
    if (isCheckbox) {
      return (
        <div key={field.id} className={`${getWidthClass(field.width)} px-2 py-3`}>
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm font-medium text-[var(--text-primary)] truncate">
              {displayName}
              {isRequired && <span className="text-red-500 ml-1">*</span>}
            </label>
            <input
              className="w-5 h-5 rounded border-[var(--border-primary)] text-[var(--color-primary-500)] focus:ring-[var(--color-primary-500)] flex-shrink-0"
              type="checkbox"
              checked={Boolean(fieldValue)}
              onChange={(e) => onChange(field.columnId, e.target.checked)}
              disabled={isDisabled}
            />
          </div>
        </div>
      );
    }

    // Regular field - clean style without extra borders
    return (
      <div key={field.id} className={`${getWidthClass(field.width)} p-1`}>
        {/* Label */}
        {showLabels && (
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
            {displayName}
            {isRequired && <span className="text-red-500 ml-1">*</span>}
          </label>
        )}

        {/* Field Input */}
        <FieldRenderer
          column={{
            ...column,
            displayName: field.label || column.displayName,
          }}
          value={fieldValue}
          onChange={(value) => onChange(field.columnId, value)}
          disabled={isDisabled}
          showLabel={false}
        />

        {/* Help Text (below field) */}
        {field.helpText && (
          <p className="mt-1">
            <RenderDescription text={field.helpText} data={formData} columns={columns} />
          </p>
        )}
      </div>
    );
  };

  // Render divider
  const renderDivider = (divider: FormDivider) => (
    <div key={divider.id} className="w-full p-1.5">
      <div className="flex items-center">
        <div className="flex-1 h-px bg-[var(--border-primary)]" />
      </div>
    </div>
  );

  // Render text block
  const renderTextBlock = (block: FormTextBlock) => {
    const parsed = parseVariables(block.content || '', formData, columns);
    const html = parsed
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code class="px-1 py-0.5 bg-[var(--bg-tertiary)] rounded text-xs">$1</code>')
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-[var(--color-primary-500)] hover:underline" target="_blank">$1</a>');

    return (
      <div key={block.id} className="p-1.5" style={getWidthStyle(block.width || 'full')}>
        <SafeHtml
          html={html || '<span class="text-[var(--text-tertiary)] italic">Пустой текстовый блок</span>'}
          className="p-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]"
        />
      </div>
    );
  };

  // Render item
  const renderItem = (item: FormField | FormElement) => {
    if (isField(item)) return renderField(item);
    if (isDivider(item)) return renderDivider(item);
    if (isTextBlock(item)) return renderTextBlock(item);
    return null;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Form Content - scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="flex flex-wrap">
          {currentPageItems.map(renderItem)}

          {currentPageItems.length === 0 && (
            <div className="w-full text-center py-8 text-[var(--text-tertiary)]">
              Нет доступных полей для отображения
            </div>
          )}
        </div>
      </div>

      {/* Page Navigation */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-4 pt-4 border-t border-[var(--border-primary)] flex-shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Назад
          </Button>
          <span className="text-sm text-[var(--text-secondary)]">
            Страница {currentPage} из {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
          >
            Далее
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default DynamicFormRenderer;
