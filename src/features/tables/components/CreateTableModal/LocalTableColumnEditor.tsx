import React from 'react';
import { ChevronDown, X } from 'lucide-react';
import { Button } from '@/shared/components/ui';
import { EmojiPicker } from '../UniversalTable/EmojiPicker';
import type { ColumnDefinitionInput, ColumnModel } from '../../types/table.types';

interface LocalTableColumnEditorProps {
  columns: ColumnDefinitionInput[];
  expandedLocalColumns: Set<number>;
  setExpandedLocalColumns: React.Dispatch<React.SetStateAction<Set<number>>>;
  updateColumn: (index: number, updater: (column: ColumnDefinitionInput) => ColumnDefinitionInput) => void;
  handleAddColumn: () => void;
  handleRemoveColumn: (index: number) => void;
  columnTypeOptions: Array<{ label: string; value: string }>;
  t: (key: string) => string;
}

export const LocalTableColumnEditor = ({
  columns,
  expandedLocalColumns,
  setExpandedLocalColumns,
  updateColumn,
  handleAddColumn,
  handleRemoveColumn,
  columnTypeOptions,
  t,
}: LocalTableColumnEditorProps) => {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">{t('tables.create.columns')} ({columns.length})</h3>
        <Button type="button" variant="secondary" onClick={handleAddColumn}>
          {t('tables.create.addColumn')}
        </Button>
      </div>
      <div className="max-h-[400px] overflow-y-auto space-y-2 pr-1">
        {columns.map((column, index) => {
          const indicator = column.config?.appearance?.indicator;
          const options = column.config?.options ?? [];
          const isExpanded = expandedLocalColumns.has(index);

          return (
            <div
              key={`column-${index}`}
              className="rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] overflow-hidden"
            >
              {/* Compact row - matching EditTableModal style */}
              <div className="flex items-center gap-2 p-2">
                {/* Expand button - ChevronRight with rotation */}
                <button
                  type="button"
                  onClick={() => {
                    setExpandedLocalColumns(prev => {
                      const next = new Set(prev);
                      if (next.has(index)) {
                        next.delete(index);
                      } else {
                        next.add(index);
                      }
                      return next;
                    });
                  }}
                  className="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
                  title={t('tables.create.details')}
                >
                  <ChevronDown className={`w-4 h-4 text-[var(--text-tertiary)] transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </button>

                {/* Column display name (readonly) */}
                <span className="text-sm flex-shrink-0 w-24 truncate text-[var(--text-secondary)]">
                  {column.displayName || column.name || t('tables.create.columnPlaceholder')}
                </span>

                {/* Arrow separator */}
                <span className="text-[var(--text-tertiary)]">&rarr;</span>

                {/* Column key (technical name) */}
                <input
                  type="text"
                  value={column.name ?? ''}
                  onChange={(event) =>
                    updateColumn(index, (prevCol) => ({ ...prevCol, name: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))
                  }
                  placeholder="key"
                  className="flex-shrink-0 w-28 px-2 py-1 rounded bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
                  title={t('tables.create.columnKey')}
                />

                {/* Emoji picker */}
                <EmojiPicker
                  value={indicator?.value || '\u{1F4C1}'}
                  onChange={(emoji) =>
                    updateColumn(index, (prevCol) => ({
                      ...prevCol,
                      config: {
                        ...prevCol.config,
                        appearance: {
                          align: prevCol.config?.appearance?.align ?? 'left',
                          ...prevCol.config?.appearance,
                          indicator: {
                            ...(prevCol.config?.appearance?.indicator ?? { type: 'emoji' }),
                            value: emoji
                          }
                        }
                      }
                    }))
                  }
                  compact
                  size="sm"
                  portal
                />

                {/* Display name */}
                <input
                  type="text"
                  value={column.displayName ?? ''}
                  onChange={(event) =>
                    updateColumn(index, (prevCol) => ({ ...prevCol, displayName: event.target.value }))
                  }
                  placeholder={t('tables.create.displayName')}
                  className="flex-1 min-w-0 px-2 py-1 rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
                />

                {/* Type selector */}
                <select
                  value={column.type ?? 'text'}
                  onChange={(event) =>
                    updateColumn(index, (prevCol) => ({
                      ...prevCol,
                      type: event.target.value as ColumnModel['type']
                    }))
                  }
                  className="flex-shrink-0 w-28 px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
                >
                  {columnTypeOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>

                {/* Delete button */}
                {columns.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveColumn(index)}
                    className="p-1.5 rounded transition-colors text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-500/10"
                    title={t('tables.create.deleteColumn')}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Expanded settings */}
              {isExpanded && (
                <div className="px-3 pb-3 pt-0 border-t border-[var(--border-primary)] bg-[var(--bg-tertiary)]/30">
                  <div className="pt-3">
                    {/* Single row: Default value, Color, Required, Readonly */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <input
                          type="text"
                          value={column.defaultValue ?? ''}
                          onChange={(event) =>
                            updateColumn(index, (prevCol) => ({
                              ...prevCol,
                              defaultValue: event.target.value
                            }))
                          }
                          placeholder={t('tables.create.defaultValue')}
                          className="w-full h-8 px-3 rounded-md bg-[var(--bg-primary)] border border-[var(--border-primary)] text-xs text-[var(--text-primary)]"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={indicator?.color ?? '#6366f1'}
                          onChange={(event) =>
                            updateColumn(index, (prevCol) => ({
                              ...prevCol,
                              config: {
                                ...prevCol.config,
                                appearance: {
                                  align: prevCol.config?.appearance?.align ?? 'left',
                                  ...prevCol.config?.appearance,
                                  indicator: {
                                    ...(prevCol.config?.appearance?.indicator ?? { type: 'emoji' }),
                                    color: event.target.value
                                  }
                                }
                              }
                            }))
                          }
                          className="w-8 h-8 rounded-md border border-[var(--border-primary)] cursor-pointer"
                          title={t('tables.create.color')}
                        />
                      </div>
                      <label className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={Boolean(column.isRequired)}
                          onChange={(e) =>
                            updateColumn(index, (prevCol) => ({ ...prevCol, isRequired: e.target.checked }))
                          }
                          className="w-4 h-4 rounded border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--color-primary-500)]"
                        />
                        <span className="text-xs text-[var(--text-secondary)]">{t('tables.create.requiredField')}</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={Boolean(column.isReadonly)}
                          onChange={(e) =>
                            updateColumn(index, (prevCol) => ({ ...prevCol, isReadonly: e.target.checked }))
                          }
                          className="w-4 h-4 rounded border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--color-primary-500)]"
                        />
                        <span className="text-xs text-[var(--text-secondary)]">{t('tables.create.readOnly')}</span>
                      </label>
                    </div>

                    {/* Select options */}
                    {column.type === 'select' && (
                      <div className="space-y-2 pt-2 border-t border-[var(--border-primary)]">
                        <label className="text-[10px] block text-[var(--text-secondary)] uppercase tracking-wide">
                          {t('tables.create.options')}
                        </label>
                        {options.map((option, optionIndex) => (
                          <div key={option.value ?? optionIndex} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={option.label}
                              onChange={(event) =>
                                updateColumn(index, (prevCol) => ({
                                  ...prevCol,
                                  config: {
                                    ...prevCol.config,
                                    options: options.map((opt, idx) =>
                                      idx === optionIndex ? { ...opt, label: event.target.value } : opt
                                    )
                                  }
                                }))
                              }
                              placeholder="Label"
                              className="flex-1 px-2 py-1.5 rounded-md bg-[var(--bg-primary)] border border-[var(--border-primary)] text-xs text-[var(--text-primary)]"
                            />
                            <input
                              type="text"
                              value={option.value}
                              onChange={(event) =>
                                updateColumn(index, (prevCol) => ({
                                  ...prevCol,
                                  config: {
                                    ...prevCol.config,
                                    options: options.map((opt, idx) =>
                                      idx === optionIndex ? { ...opt, value: event.target.value } : opt
                                    )
                                  }
                                }))
                              }
                              placeholder="value"
                              className="w-24 px-2 py-1.5 rounded-md bg-[var(--bg-primary)] border border-[var(--border-primary)] text-xs font-mono text-[var(--text-primary)]"
                            />
                            <input
                              type="color"
                              value={option.color ?? '#6366f1'}
                              onChange={(event) =>
                                updateColumn(index, (prevCol) => ({
                                  ...prevCol,
                                  config: {
                                    ...prevCol.config,
                                    options: options.map((opt, idx) =>
                                      idx === optionIndex ? { ...opt, color: event.target.value } : opt
                                    )
                                  }
                                }))
                              }
                              className="w-8 h-7 rounded border border-[var(--border-primary)] cursor-pointer"
                            />
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            updateColumn(index, (prevCol) => ({
                              ...prevCol,
                              config: {
                                ...prevCol.config,
                                options: [
                                  ...(prevCol.config?.options ?? []),
                                  { label: 'New option', value: `option_${options.length + 1}` }
                                ]
                              }
                            }))
                          }
                          className="text-xs text-[var(--color-primary-500)] hover:text-[var(--color-primary-400)] transition"
                        >
                          {t('tables.create.addOption')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
