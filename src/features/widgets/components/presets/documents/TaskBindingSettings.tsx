/**
 * TaskBindingSettings Component - ADR-038
 * 
 * UI for configuring task binding in Documents Widget settings
 * 
 * @see ADR-038-DOCUMENTS-TASKS-SYNC.md
 */

import { useState, useCallback, useMemo } from 'react';
import { 
  CheckSquare, 
  Settings2, 
  ChevronDown, 
  ChevronUp,
  Table2,
  Columns,
  Eye,
  FileOutput,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { logger } from '@/shared/utils/logger';
import type { TaskBindingConfig } from '../../../types/documents.types';

// === TYPES ===

export interface TaskBindingSettingsProps {
  config: TaskBindingConfig | undefined;
  onChange: (config: TaskBindingConfig | undefined) => void;
  tables: Array<{ id: number; name: string; display_name?: string }>;
  columns?: Array<{ name: string; display_name?: string; type: string }>;
  onTableSelect?: (tableId: number) => void;
}

// === DEFAULT CONFIG ===

const DEFAULT_CONFIG: TaskBindingConfig = {
  enabled: false,
  table_id: 0,
  columns: {
    title: 'title',
    description: 'description',
    status: 'status',
    due_date: 'due_date',
    assignee: 'assignee_id',
    priority: 'priority',
    progress: 'progress',
  },
  export_options: {
    levels: ['h2', 'h3'],
    include_content: true,
    default_status: 'todo',
    default_priority: 'medium',
  },
  display_options: {
    show_status: true,
    show_due_date: true,
    show_assignee: false,
    show_progress: false,
    compact_mode: false,
  },
};

// === COMPONENT ===

export function TaskBindingSettings({
  config,
  onChange,
  tables,
  columns = [],
  onTableSelect,
}: TaskBindingSettingsProps) {
  const [isExpanded, setIsExpanded] = useState(!!config?.enabled);

  // Merge with defaults
  const currentConfig: TaskBindingConfig = useMemo(() => ({
    ...DEFAULT_CONFIG,
    ...config,
    columns: { ...DEFAULT_CONFIG.columns, ...config?.columns },
    export_options: { ...DEFAULT_CONFIG.export_options, ...config?.export_options },
    display_options: { ...DEFAULT_CONFIG.display_options, ...config?.display_options },
  }), [config]);

  // Handle enable/disable toggle
  const handleToggle = useCallback(() => {
    const newEnabled = !currentConfig.enabled;
    logger.debug({ enabled: newEnabled }, '[TaskBindingSettings] Toggle');
    
    if (newEnabled) {
      onChange({ ...currentConfig, enabled: true });
      setIsExpanded(true);
    } else {
      onChange(undefined);
      setIsExpanded(false);
    }
  }, [currentConfig, onChange]);

  // Handle table selection
  const handleTableChange = useCallback((tableId: number) => {
    logger.debug({ tableId }, '[TaskBindingSettings] Table selected');
    onChange({ ...currentConfig, table_id: tableId });
    onTableSelect?.(tableId);
  }, [currentConfig, onChange, onTableSelect]);

  // Handle column mapping change
  const handleColumnChange = useCallback((field: keyof TaskBindingConfig['columns'], value: string) => {
    onChange({
      ...currentConfig,
      columns: { ...currentConfig.columns, [field]: value },
    });
  }, [currentConfig, onChange]);

  // Handle export option change
  const handleExportOptionChange = useCallback(<K extends keyof TaskBindingConfig['export_options']>(
    field: K, 
    value: TaskBindingConfig['export_options'][K]
  ) => {
    onChange({
      ...currentConfig,
      export_options: { ...currentConfig.export_options, [field]: value },
    });
  }, [currentConfig, onChange]);

  // Handle display option change
  const handleDisplayOptionChange = useCallback((field: keyof TaskBindingConfig['display_options'], value: boolean) => {
    onChange({
      ...currentConfig,
      display_options: { ...currentConfig.display_options, [field]: value },
    });
  }, [currentConfig, onChange]);

  // Handle levels toggle
  const handleLevelToggle = useCallback((level: 'h1' | 'h2' | 'h3' | 'checkbox') => {
    const currentLevels = currentConfig.export_options.levels;
    const newLevels = currentLevels.includes(level)
      ? currentLevels.filter(l => l !== level)
      : [...currentLevels, level];
    
    handleExportOptionChange('levels', newLevels as Array<'h1' | 'h2' | 'h3' | 'checkbox'>);
  }, [currentConfig.export_options.levels, handleExportOptionChange]);

  return (
    <div className="space-y-3">
      {/* Header with Toggle */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent-primary)]"
        >
          <CheckSquare className="w-4 h-4" />
          <span>Привязка к задачам</span>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-[var(--text-tertiary)]" />
          ) : (
            <ChevronDown className="w-4 h-4 text-[var(--text-tertiary)]" />
          )}
        </button>
        
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={currentConfig.enabled}
            onChange={handleToggle}
            className="sr-only peer"
          />
          <div className={cn(
            'w-9 h-5 rounded-full transition-colors',
            'peer-checked:bg-[var(--accent-primary)] bg-[var(--bg-tertiary)]',
            'after:content-[""] after:absolute after:top-0.5 after:left-0.5',
            'after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform',
            'peer-checked:after:translate-x-4'
          )} />
        </label>
      </div>

      {/* Expanded Content */}
      {isExpanded && currentConfig.enabled && (
        <div className="pl-6 space-y-4 border-l-2 border-[var(--border-primary)]">
          {/* Table Selection */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <Table2 className="w-3.5 h-3.5" />
              Таблица задач
            </label>
            <select
              value={currentConfig.table_id}
              onChange={(e) => handleTableChange(parseInt(e.target.value, 10))}
              className={cn(
                'w-full px-3 py-2 text-sm rounded-md',
                'bg-[var(--bg-tertiary)] border border-[var(--border-primary)]',
                'text-[var(--text-primary)]',
                'focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]'
              )}
            >
              <option value={0}>Выберите таблицу...</option>
              {tables.map(table => (
                <option key={table.id} value={table.id}>
                  {table.display_name || table.name}
                </option>
              ))}
            </select>
          </div>

          {/* Column Mapping */}
          {currentConfig.table_id > 0 && columns.length > 0 && (
            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <Columns className="w-3.5 h-3.5" />
                Маппинг колонок
              </label>
              
              <div className="grid grid-cols-2 gap-2 text-xs">
                {(['title', 'description', 'status', 'due_date', 'assignee', 'priority'] as const).map(field => (
                  <div key={field} className="flex items-center gap-2">
                    <span className="w-20 text-[var(--text-tertiary)] capitalize">
                      {field.replace('_', ' ')}
                    </span>
                    <select
                      value={currentConfig.columns[field] || ''}
                      onChange={(e) => handleColumnChange(field, e.target.value)}
                      className={cn(
                        'flex-1 px-2 py-1 text-xs rounded',
                        'bg-[var(--bg-tertiary)] border border-[var(--border-primary)]',
                        'text-[var(--text-primary)]'
                      )}
                    >
                      <option value="">—</option>
                      {columns.map(col => (
                        <option key={col.name} value={col.name}>
                          {col.display_name || col.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Export Options */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <FileOutput className="w-3.5 h-3.5" />
              Опции экспорта
            </label>
            
            <div className="flex flex-wrap gap-2">
              {(['h1', 'h2', 'h3', 'checkbox'] as const).map(level => (
                <label key={level} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={currentConfig.export_options.levels.includes(level)}
                    onChange={() => handleLevelToggle(level)}
                    className="rounded border-[var(--border-primary)] text-[var(--accent-primary)]"
                  />
                  <span className="text-[var(--text-secondary)]">
                    {level.toUpperCase()}
                  </span>
                </label>
              ))}
            </div>

            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={currentConfig.export_options.include_content}
                onChange={(e) => handleExportOptionChange('include_content', e.target.checked)}
                className="rounded border-[var(--border-primary)] text-[var(--accent-primary)]"
              />
              <span className="text-[var(--text-secondary)]">
                Включить контент в описание
              </span>
            </label>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-[var(--text-tertiary)]">Статус по умолчанию:</span>
              <input
                type="text"
                value={currentConfig.export_options.default_status}
                onChange={(e) => handleExportOptionChange('default_status', e.target.value)}
                className={cn(
                  'w-24 px-2 py-1 rounded',
                  'bg-[var(--bg-tertiary)] border border-[var(--border-primary)]',
                  'text-[var(--text-primary)]'
                )}
              />
            </div>
          </div>

          {/* Display Options */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <Eye className="w-3.5 h-3.5" />
              Отображать в документе
            </label>
            
            <div className="grid grid-cols-2 gap-1.5">
              {([
                { key: 'show_status', label: 'Статус' },
                { key: 'show_due_date', label: 'Дедлайн' },
                { key: 'show_assignee', label: 'Ответственный' },
                { key: 'show_progress', label: 'Прогресс' },
                { key: 'compact_mode', label: 'Компактный вид' },
              ] as const).map(({ key, label }) => (
                <label key={key} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={currentConfig.display_options[key]}
                    onChange={(e) => handleDisplayOptionChange(key, e.target.checked)}
                    className="rounded border-[var(--border-primary)] text-[var(--accent-primary)]"
                  />
                  <span className="text-[var(--text-secondary)]">{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TaskBindingSettings;
