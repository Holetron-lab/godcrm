import React, { useState } from 'react';
import { Input, Select, Button } from '@/shared/components/ui';
import { ColumnSettingsProps, renderTypeCellPreview } from './types';

/**
 * Компонент настроек для колонок типа select и multi-select
 */
export const SelectColumnSettings: React.FC<ColumnSettingsProps> = ({
  draft,
  setDraft,
  allColumns = [],
  rows = [],
  firstRow,
  resolvedDisplayValue,
  resolvedDisplayColor,
}) => {
  const [optionsSubTab, setOptionsSubTab] = useState<'options' | 'formula'>('options');

  const options = draft.config?.options || [];
  const relationConfig = draft.config?.relation;

  // Цветовая палитра для опций без цвета
  const defaultColors = [
    '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
    '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
  ];
  const getDefaultColor = (index: number) => defaultColors[index % defaultColors.length];

  // Собрать уникальные значения из данных таблицы
  const collectUniqueValues = (columnName: string): string[] => {
    const uniqueSet = new Set<string>();
    rows.forEach(row => {
      const value = row.data[columnName];
      if (value != null && value !== '') {
        const strValue = String(value);
        // Если multi-select, может быть массив или строка с разделителями
        if (Array.isArray(value)) {
          value.forEach(v => uniqueSet.add(String(v)));
        } else if (strValue.includes(',')) {
          strValue.split(',').forEach(v => uniqueSet.add(v.trim()));
        } else {
          uniqueSet.add(strValue);
        }
      }
    });
    return Array.from(uniqueSet).sort();
  };

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        📋 Настройки Select
      </h4>

      {/* Мини-вкладки */}
      <div className="flex gap-1 border-b border-[var(--border-primary)]">
        <button
          type="button"
          onClick={() => setOptionsSubTab('options')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            optionsSubTab === 'options'
              ? 'text-[var(--color-primary-500)] border-b-2 border-[var(--color-primary-500)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          Опции
        </button>
        <button
          type="button"
          onClick={() => setOptionsSubTab('formula')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            optionsSubTab === 'formula'
              ? 'text-[var(--color-primary-500)] border-b-2 border-[var(--color-primary-500)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          Формула
        </button>
      </div>

      {/* Вкладка Формула */}
      {optionsSubTab === 'formula' && (
        <div className="space-y-3 p-3 border border-[var(--border-color)] rounded-lg">
          <Input
            label="Формула для вычисления значения"
            placeholder="Например: CONCAT(name, '-', status)"
            value={draft.formula ?? ''}
            onChange={(event) => setDraft(prev => ({ ...prev, formula: event.target.value }))}
          />
          <p className="text-xs text-[var(--text-tertiary)]">
            Доступные функции: CONCAT, IF, SUM, AVG, COUNT, LOOKUP
          </p>
        </div>
      )}

      {/* Вкладка Опции */}
      {optionsSubTab === 'options' && (
        <div className="space-y-4">
          {/* Статус связи */}
          {relationConfig?.enabled ? (
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <span>🔗</span>
                  <span className="text-sm font-medium">
                    Опции из связанной таблицы
                  </span>
                </div>
              </div>
              <p className="text-xs text-green-600/70 dark:text-green-400/70 mt-1">
                Опции загружаются автоматически из связанной таблицы
              </p>
            </div>
          ) : (
            <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-secondary)]">
              <span className="text-sm text-[var(--text-secondary)]">
                📝 Ручные опции
              </span>
            </div>
          )}

          {/* Ручные опции - только если связь выключена */}
          {!relationConfig?.enabled && (
            <div className="space-y-3">
              {options.map((option, optionIndex) => (
                <div key={option.value ?? optionIndex} className="border border-[var(--border-primary)] rounded-lg p-3">
                  <div className="flex gap-2 items-end">
                    <div className="grid gap-2 md:grid-cols-3 flex-1">
                      <Input
                        label="Label"
                        value={option.label}
                        onChange={(event) =>
                          setDraft(prev => ({
                            ...prev,
                            config: {
                              ...prev.config,
                              options: options.map((opt, idx) =>
                                idx === optionIndex ? { ...opt, label: event.target.value } : opt
                              )
                            }
                          }))
                        }
                      />
                      <Input
                        label="Value"
                        value={option.value}
                        onChange={(event) =>
                          setDraft(prev => ({
                            ...prev,
                            config: {
                              ...prev.config,
                              options: options.map((opt, idx) =>
                                idx === optionIndex ? { ...opt, value: event.target.value } : opt
                              )
                            }
                          }))
                        }
                      />
                      <Input
                        label="Color"
                        type="color"
                        value={option.color ?? '#6366f1'}
                        onChange={(event) =>
                          setDraft(prev => ({
                            ...prev,
                            config: {
                              ...prev.config,
                              options: options.map((opt, idx) =>
                                idx === optionIndex ? { ...opt, color: event.target.value } : opt
                              )
                            }
                          }))
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 mb-1 px-2"
                      onClick={() =>
                        setDraft(prev => ({
                          ...prev,
                          config: {
                            ...prev.config,
                            options: options.filter((_, idx) => idx !== optionIndex)
                          }
                        }))
                      }
                      title="Удалить опцию"
                    >
                      🗑️
                    </Button>
                  </div>

                  {/* Вложенные опции */}
                  {option.children && option.children.length > 0 && (
                    <div className="mt-3 ml-4 pl-3 border-l-2 border-[var(--border-secondary)] space-y-2">
                      <p className="text-xs text-[var(--text-tertiary)]">Вложенные опции:</p>
                      {option.children.map((child, childIndex) => (
                        <div key={child.value ?? childIndex} className="flex gap-2 items-end">
                          <div className="grid gap-2 md:grid-cols-3 flex-1">
                            <Input
                              label="Label"
                              value={child.label}
                              onChange={(event) =>
                                setDraft(prev => ({
                                  ...prev,
                                  config: {
                                    ...prev.config,
                                    options: options.map((opt, idx) =>
                                      idx === optionIndex
                                        ? {
                                            ...opt,
                                            children: (opt.children || []).map((ch, chIdx) =>
                                              chIdx === childIndex ? { ...ch, label: event.target.value } : ch
                                            )
                                          }
                                        : opt
                                    )
                                  }
                                }))
                              }
                            />
                            <Input
                              label="Value"
                              value={child.value}
                              onChange={(event) =>
                                setDraft(prev => ({
                                  ...prev,
                                  config: {
                                    ...prev.config,
                                    options: options.map((opt, idx) =>
                                      idx === optionIndex
                                        ? {
                                            ...opt,
                                            children: (opt.children || []).map((ch, chIdx) =>
                                              chIdx === childIndex ? { ...ch, value: event.target.value } : ch
                                            )
                                          }
                                        : opt
                                    )
                                  }
                                }))
                              }
                            />
                            <Input
                              label="Color"
                              type="color"
                              value={child.color ?? option.color ?? '#6366f1'}
                              onChange={(event) =>
                                setDraft(prev => ({
                                  ...prev,
                                  config: {
                                    ...prev.config,
                                    options: options.map((opt, idx) =>
                                      idx === optionIndex
                                        ? {
                                            ...opt,
                                            children: (opt.children || []).map((ch, chIdx) =>
                                              chIdx === childIndex ? { ...ch, color: event.target.value } : ch
                                            )
                                          }
                                        : opt
                                    )
                                  }
                                }))
                              }
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 mb-1 px-2"
                            onClick={() =>
                              setDraft(prev => ({
                                ...prev,
                                config: {
                                  ...prev.config,
                                  options: options.map((opt, idx) =>
                                    idx === optionIndex
                                      ? { ...opt, children: (opt.children || []).filter((_, chIdx) => chIdx !== childIndex) }
                                      : opt
                                  )
                                }
                              }))
                            }
                            title="Удалить"
                          >
                            ✕
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Кнопка добавления вложенной опции */}
                  <Button
                    type="button"
                    variant="ghost"
                    className="mt-2 text-xs"
                    onClick={() =>
                      setDraft(prev => ({
                        ...prev,
                        config: {
                          ...prev.config,
                          options: options.map((opt, idx) =>
                            idx === optionIndex
                              ? {
                                  ...opt,
                                  children: [
                                    ...(opt.children || []),
                                    { label: 'Подопция', value: `${opt.value}_sub_${(opt.children?.length || 0) + 1}` }
                                  ]
                                }
                              : opt
                          )
                        }
                      }))
                    }
                  >
                    + Добавить подопцию
                  </Button>
                </div>
              ))}

              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setDraft(prev => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      options: [...options, { label: 'Новая опция', value: `option_${options.length + 1}` }]
                    }
                  }))
                }
              >
                + Добавить опцию
              </Button>

              {draft.name && rows.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const uniqueValues = collectUniqueValues(draft.name);
                    if (uniqueValues.length === 0) return;

                    // Merge with existing options - don't duplicate
                    const existingValues = new Set(options.map(o => o.value));
                    const newOptions = uniqueValues
                      .filter(v => !existingValues.has(v))
                      .map((value, index) => ({
                        value,
                        label: value,
                        color: getDefaultColor(options.length + index)
                      }));

                    if (newOptions.length > 0) {
                      setDraft(prev => ({
                        ...prev,
                        config: {
                          ...prev.config,
                          options: [...options, ...newOptions]
                        }
                      }));
                    }
                  }}
                  title="Собрать уникальные значения из данных таблицы"
                >
                  📊 Собрать из данных ({rows.length} строк)
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
