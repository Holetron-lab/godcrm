/**
 * NumberColumnSettings - Полные настройки числовой колонки
 * Включает: кнопки +/-, стили отображения (badge, progress, rating, slider и др.),
 * ограничения min/max, prefix/suffix, форматирование
 */

import React from 'react';
import { Select } from '@/shared/components/ui';
import type { ColumnSettingsProps } from './types';
import { renderTypeCellPreview } from './types';
import type { NumberColumnConfig } from '@/features/tables/types/table.types';
import { NumberPreview } from './NumberPreview';

export const NumberColumnSettings: React.FC<ColumnSettingsProps> = ({ draft, setDraft, allColumns = [], firstRow }) => {
  return (
    <div className="space-y-4 p-4 border border-[var(--border-color)] rounded-lg bg-[var(--bg-secondary)]">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        🔢 Настройки числа
      </h4>
      
      {/* Переключатель кнопок +/- */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)]">
        <div className="flex items-center gap-3">
          <span className="text-lg">➕➖</span>
          <div>
            <div className="font-medium text-[var(--text-primary)]">Кнопки +/−</div>
            <div className="text-xs text-[var(--text-secondary)]">Показывать кнопки увеличения/уменьшения при наведении</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDraft({
            ...draft,
            config: {
              ...draft.config,
              number: { ...draft.config?.number, showStepButtons: !draft.config?.number?.showStepButtons }
            }
          })}
          className={`relative w-12 h-6 rounded-full transition-colors ${
            draft.config?.number?.showStepButtons 
              ? 'bg-[var(--color-primary-500)]' 
              : 'bg-[var(--bg-tertiary)] border border-[var(--border-color)]'
          }`}
        >
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
            draft.config?.number?.showStepButtons ? 'translate-x-6' : 'translate-x-0.5'
          }`} />
        </button>
      </div>
      
      {/* Настройки кнопок +/- */}
      {draft.config?.number?.showStepButtons && (
        <div className="space-y-3 p-3 rounded-lg bg-[var(--bg-tertiary)] border border-dashed border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <label className="text-sm text-[var(--text-secondary)]">Шаг:</label>
            <input
              type="number"
              value={draft.config?.number?.step ?? 1}
              onChange={(e) => setDraft({
                ...draft,
                config: {
                  ...draft.config,
                  number: { 
                    ...draft.config?.number, 
                    step: e.target.value === '' ? undefined : parseFloat(e.target.value) 
                  }
                }
              })}
              className="w-20 px-2 py-1 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-primary)]"
              placeholder="1"
            />
          </div>
          
          {/* Настройка цвета кнопок */}
          <div className="space-y-2">
            <label className="text-sm text-[var(--text-secondary)]">Цвет кнопок:</label>
            <div className="flex items-center gap-2">
              <select
                value={draft.config?.number?.stepButtonColorType ?? 'default'}
                onChange={(e) => setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    number: { 
                      ...draft.config?.number, 
                      stepButtonColorType: (e.target.value === 'default' ? undefined : e.target.value) as NumberColumnConfig['stepButtonColorType']
                    }
                  }
                })}
                className="flex-1 px-2 py-1 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-primary)]"
              >
                <option value="default">По умолчанию</option>
                <option value="fixed">Фиксированный цвет</option>
                <option value="column">Из колонки</option>
              </select>
              
              {draft.config?.number?.stepButtonColorType === 'fixed' && (
                <input
                  type="color"
                  value={draft.config?.number?.stepButtonColor ?? '#6366f1'}
                  onChange={(e) => setDraft({
                    ...draft,
                    config: {
                      ...draft.config,
                      number: { 
                        ...draft.config?.number, 
                        stepButtonColor: e.target.value
                      }
                    }
                  })}
                  className="w-8 h-8 rounded border border-[var(--border-color)] cursor-pointer"
                />
              )}
            </div>
            
            {draft.config?.number?.stepButtonColorType === 'column' && (
              <select
                value={draft.config?.number?.stepButtonColorColumn ?? ''}
                onChange={(e) => setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    number: { 
                      ...draft.config?.number, 
                      stepButtonColorColumn: e.target.value || undefined
                    }
                  }
                })}
                className="w-full px-2 py-1 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-primary)]"
              >
                <option value="">— Выберите колонку —</option>
                {allColumns
                  .filter(col => col.id !== draft.id)
                  .map((col) => (
                    <option key={col.id} value={col.name}>
                      {col.displayName || col.name} ({col.type})
                    </option>
                  ))}
              </select>
            )}
          </div>
          
          {/* Превью кнопок */}
          <div className="flex items-center justify-center gap-1 p-2 bg-[var(--bg-primary)] rounded">
            <span 
              className="w-6 h-6 flex items-center justify-center rounded text-sm text-white"
              style={{ 
                backgroundColor: draft.config?.number?.stepButtonColorType === 'fixed' 
                  ? (draft.config?.number?.stepButtonColor ?? '#6366f1')
                  : 'var(--bg-secondary)',
                color: draft.config?.number?.stepButtonColorType === 'fixed' 
                  ? 'white'
                  : 'var(--text-primary)'
              }}
            >−</span>
            <span className="min-w-[2.5rem] text-center text-sm font-mono px-1">42</span>
            <span 
              className="w-6 h-6 flex items-center justify-center rounded text-sm"
              style={{ 
                backgroundColor: draft.config?.number?.stepButtonColorType === 'fixed' 
                  ? (draft.config?.number?.stepButtonColor ?? '#6366f1')
                  : 'var(--bg-secondary)',
                color: draft.config?.number?.stepButtonColorType === 'fixed' 
                  ? 'white'
                  : 'var(--text-primary)'
              }}
            >+</span>
          </div>
          
          {draft.config?.number?.stepButtonColorType === 'column' && (
            <p className="text-xs text-[var(--text-tertiary)]">
              💡 Цвет будет браться из указанной колонки для каждой строки
            </p>
          )}
        </div>
      )}
      
      {/* Ограничения - всегда видны */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
          Ограничения значения
        </div>
        <div className="grid grid-cols-2 gap-3">
          {/* Минимум */}
          <div className="space-y-2">
            <label className="text-sm text-[var(--text-secondary)]">Минимум</label>
            <div className="flex gap-1">
              <select
                value={draft.config?.number?.minType ?? 'fixed'}
                onChange={(e) => setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    number: { 
                      ...draft.config?.number, 
                      minType: e.target.value as 'fixed' | 'column',
                      min: e.target.value === 'column' ? undefined : draft.config?.number?.min,
                      minColumn: e.target.value === 'fixed' ? undefined : draft.config?.number?.minColumn
                    }
                  }
                })}
                className="w-20 px-2 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)]"
              >
                <option value="fixed">📝</option>
                <option value="column">📊</option>
              </select>
              {(draft.config?.number?.minType ?? 'fixed') === 'fixed' ? (
                <input
                  type="number"
                  step="any"
                  value={draft.config?.number?.min ?? ''}
                  onChange={(e) => setDraft({
                    ...draft,
                    config: {
                      ...draft.config,
                      number: { 
                        ...draft.config?.number, 
                        min: e.target.value === '' ? undefined : parseFloat(e.target.value) 
                      }
                    }
                  })}
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)]"
                  placeholder="Без ограничения"
                />
              ) : (
                <select
                  value={draft.config?.number?.minColumn ?? ''}
                  onChange={(e) => setDraft({
                    ...draft,
                    config: {
                      ...draft.config,
                      number: { 
                        ...draft.config?.number, 
                        minColumn: e.target.value || undefined
                      }
                    }
                  })}
                  className="flex-1 px-2 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)]"
                >
                  <option value="">— Колонка —</option>
                  {allColumns.filter(col => col.id !== draft.id && ['number', 'integer', 'float', 'decimal'].includes(col.type)).map((col) => (
                    <option key={col.id} value={col.name}>{col.displayName || col.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
          
          {/* Максимум */}
          <div className="space-y-2">
            <label className="text-sm text-[var(--text-secondary)]">Максимум</label>
            <div className="flex gap-1">
              <select
                value={draft.config?.number?.maxType ?? 'fixed'}
                onChange={(e) => setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    number: { 
                      ...draft.config?.number, 
                      maxType: e.target.value as 'fixed' | 'column',
                      max: e.target.value === 'column' ? undefined : draft.config?.number?.max,
                      maxColumn: e.target.value === 'fixed' ? undefined : draft.config?.number?.maxColumn
                    }
                  }
                })}
                className="w-20 px-2 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)]"
              >
                <option value="fixed">📝</option>
                <option value="column">📊</option>
              </select>
              {(draft.config?.number?.maxType ?? 'fixed') === 'fixed' ? (
                <input
                  type="number"
                  step="any"
                  value={draft.config?.number?.max ?? ''}
                  onChange={(e) => setDraft({
                    ...draft,
                    config: {
                      ...draft.config,
                      number: { 
                        ...draft.config?.number, 
                        max: e.target.value === '' ? undefined : parseFloat(e.target.value) 
                      }
                    }
                  })}
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)]"
                  placeholder="Без ограничения"
                />
              ) : (
                <select
                  value={draft.config?.number?.maxColumn ?? ''}
                  onChange={(e) => setDraft({
                    ...draft,
                    config: {
                      ...draft.config,
                      number: { 
                        ...draft.config?.number, 
                        maxColumn: e.target.value || undefined
                      }
                    }
                  })}
                  className="flex-1 px-2 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)]"
                >
                  <option value="">— Колонка —</option>
                  {allColumns.filter(col => col.id !== draft.id && ['number', 'integer', 'float', 'decimal'].includes(col.type)).map((col) => (
                    <option key={col.id} value={col.name}>{col.displayName || col.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Стиль отображения в ячейке */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
          Стиль отображения
        </div>
        <Select
          label="Вид ячейки"
          value={draft.config?.number?.displayStyle ?? 'default'}
          onChange={(value) => setDraft({
            ...draft,
            config: {
              ...draft.config,
              number: { ...draft.config?.number, displayStyle: value as NumberColumnConfig['displayStyle'] }
            }
          })}
          options={[
            { label: '📝 Обычный', value: 'default' },
            { label: '🏷️ Бейдж', value: 'badge' },
            { label: '📊 Прогресс-бар', value: 'progress' },
            { label: '📊 Прогресс (вертикальный)', value: 'progress-vertical' },
            { label: '⭕ Прогресс (кольцо)', value: 'progress-ring' },
            { label: '💰 Валюта (с разделителями)', value: 'currency' },
            { label: '📈 Процент', value: 'percent' },
            { label: '🔢 Компактный (1K, 1M)', value: 'compact' },
            { label: '⭐ Рейтинг (звёзды)', value: 'rating' },
            { label: '🎚️ Слайдер', value: 'slider' },
          ]}
        />
        
        {/* Prefix / Suffix */}
        <div className="grid grid-cols-2 gap-3">
          {/* Префикс */}
          <div className="space-y-2">
            <label className="text-sm text-[var(--text-secondary)]">Префикс</label>
            <div className="flex gap-1">
              <select
                value={draft.config?.number?.prefixType ?? 'fixed'}
                onChange={(e) => setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    number: { 
                      ...draft.config?.number, 
                      prefixType: e.target.value as 'fixed' | 'column',
                      prefix: e.target.value === 'column' ? undefined : draft.config?.number?.prefix,
                      prefixColumn: e.target.value === 'fixed' ? undefined : draft.config?.number?.prefixColumn
                    }
                  }
                })}
                className="w-12 px-1 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)]"
              >
                <option value="fixed">📝</option>
                <option value="column">📊</option>
              </select>
              {(draft.config?.number?.prefixType ?? 'fixed') === 'fixed' ? (
                <input
                  type="text"
                  value={draft.config?.number?.prefix ?? ''}
                  onChange={(e) => setDraft({
                    ...draft,
                    config: {
                      ...draft.config,
                      number: { 
                        ...draft.config?.number, 
                        prefix: e.target.value || undefined
                      }
                    }
                  })}
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)]"
                  placeholder="$ или €"
                />
              ) : (
                <select
                  value={draft.config?.number?.prefixColumn ?? ''}
                  onChange={(e) => setDraft({
                    ...draft,
                    config: {
                      ...draft.config,
                      number: { 
                        ...draft.config?.number, 
                        prefixColumn: e.target.value || undefined
                      }
                    }
                  })}
                  className="flex-1 px-2 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)]"
                >
                  <option value="">— Колонка —</option>
                  {allColumns.filter(col => col.id !== draft.id).map((col) => (
                    <option key={col.id} value={col.name}>{col.displayName || col.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
          
          {/* Суффикс */}
          <div className="space-y-2">
            <label className="text-sm text-[var(--text-secondary)]">Суффикс</label>
            <div className="flex gap-1">
              <select
                value={draft.config?.number?.suffixType ?? 'fixed'}
                onChange={(e) => setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    number: { 
                      ...draft.config?.number, 
                      suffixType: e.target.value as 'fixed' | 'column',
                      suffix: e.target.value === 'column' ? undefined : draft.config?.number?.suffix,
                      suffixColumn: e.target.value === 'fixed' ? undefined : draft.config?.number?.suffixColumn
                    }
                  }
                })}
                className="w-12 px-1 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)]"
              >
                <option value="fixed">📝</option>
                <option value="column">📊</option>
              </select>
              {(draft.config?.number?.suffixType ?? 'fixed') === 'fixed' ? (
                <input
                  type="text"
                  value={draft.config?.number?.suffix ?? ''}
                  onChange={(e) => setDraft({
                    ...draft,
                    config: {
                      ...draft.config,
                      number: { 
                        ...draft.config?.number, 
                        suffix: e.target.value || undefined
                      }
                    }
                  })}
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)]"
                  placeholder="шт. или %"
                />
              ) : (
                <select
                  value={draft.config?.number?.suffixColumn ?? ''}
                  onChange={(e) => setDraft({
                    ...draft,
                    config: {
                      ...draft.config,
                      number: { 
                        ...draft.config?.number, 
                        suffixColumn: e.target.value || undefined
                      }
                    }
                  })}
                  className="flex-1 px-2 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)]"
                >
                  <option value="">— Колонка —</option>
                  {allColumns.filter(col => col.id !== draft.id).map((col) => (
                    <option key={col.id} value={col.name}>{col.displayName || col.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>
        
        {/* Decimals */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-sm text-[var(--text-secondary)]">Десятичных знаков</label>
            <input
              type="number"
              min="0"
              max="10"
              value={draft.config?.number?.decimals ?? ''}
              onChange={(e) => setDraft({
                ...draft,
                config: {
                  ...draft.config,
                  number: { 
                    ...draft.config?.number, 
                    decimals: e.target.value === '' ? undefined : parseInt(e.target.value, 10)
                  }
                }
              })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] focus:ring-2 focus:ring-[var(--color-primary-500)] focus:border-transparent"
              placeholder="Авто"
            />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.config?.number?.thousandsSeparator ?? false}
                onChange={(e) => setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    number: { 
                      ...draft.config?.number, 
                      thousandsSeparator: e.target.checked
                    }
                  }
                })}
                className="w-4 h-4 rounded border-[var(--border-primary)] text-[var(--color-primary-500)] focus:ring-[var(--color-primary-500)]"
              />
              <span className="text-sm text-[var(--text-secondary)]">Разделитель тысяч</span>
            </label>
          </div>
        </div>
        
        {/* Progress settings */}
        {draft.config?.number?.displayStyle === 'progress' && (
          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-[var(--bg-tertiary)]">
            <div className="space-y-2">
              <label className="text-sm text-[var(--text-secondary)]">Макс. значение</label>
              <input
                type="number"
                value={draft.config?.number?.progressMax ?? 100}
                onChange={(e) => setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    number: { 
                      ...draft.config?.number, 
                      progressMax: parseFloat(e.target.value) || 100
                    }
                  }
                })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] focus:ring-2 focus:ring-[var(--color-primary-500)] focus:border-transparent"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-[var(--text-secondary)]">Цвет</label>
              <input
                type="color"
                value={draft.config?.number?.progressColor ?? '#22c55e'}
                onChange={(e) => setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    number: { 
                      ...draft.config?.number, 
                      progressColor: e.target.value
                    }
                  }
                })}
                className="w-full h-10 rounded-lg border border-[var(--border-primary)] cursor-pointer"
              />
            </div>
          </div>
        )}
        
        {/* Badge color */}
        {draft.config?.number?.displayStyle === 'badge' && (
          <div className="p-3 rounded-lg bg-[var(--bg-tertiary)]">
            <div className="space-y-2">
              <label className="text-sm text-[var(--text-secondary)]">Цвет бейджа</label>
              <input
                type="color"
                value={draft.config?.number?.badgeColor ?? '#6366f1'}
                onChange={(e) => setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    number: { 
                      ...draft.config?.number, 
                      badgeColor: e.target.value
                    }
                  }
                })}
                className="w-full h-10 rounded-lg border border-[var(--border-primary)] cursor-pointer"
              />
            </div>
          </div>
        )}
        
        {/* Rating settings */}
        {draft.config?.number?.displayStyle === 'rating' && (
          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-[var(--bg-tertiary)]">
            <div className="space-y-2">
              <label className="text-sm text-[var(--text-secondary)]">Макс. звёзд</label>
              <input
                type="number"
                min="1"
                max="10"
                value={draft.config?.number?.ratingMax ?? 5}
                onChange={(e) => setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    number: { 
                      ...draft.config?.number, 
                      ratingMax: parseInt(e.target.value, 10) || 5
                    }
                  }
                })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] focus:ring-2 focus:ring-[var(--color-primary-500)] focus:border-transparent"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-[var(--text-secondary)]">Цвет звёзд</label>
              <input
                type="color"
                value={draft.config?.number?.progressColor ?? '#fbbf24'}
                onChange={(e) => setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    number: { 
                      ...draft.config?.number, 
                      progressColor: e.target.value
                    }
                  }
                })}
                className="w-full h-10 rounded-lg border border-[var(--border-primary)] cursor-pointer"
              />
            </div>
          </div>
        )}
        
        {/* Slider settings */}
        {draft.config?.number?.displayStyle === 'slider' && (
          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-[var(--bg-tertiary)]">
            <div className="space-y-2">
              <label className="text-sm text-[var(--text-secondary)]">Макс. значение</label>
              <input
                type="number"
                value={draft.config?.number?.progressMax ?? 100}
                onChange={(e) => setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    number: { 
                      ...draft.config?.number, 
                      progressMax: parseFloat(e.target.value) || 100
                    }
                  }
                })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] focus:ring-2 focus:ring-[var(--color-primary-500)] focus:border-transparent"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-[var(--text-secondary)]">Цвет</label>
              <input
                type="color"
                value={draft.config?.number?.progressColor ?? '#6366f1'}
                onChange={(e) => setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    number: { 
                      ...draft.config?.number, 
                      progressColor: e.target.value
                    }
                  }
                })}
                className="w-full h-10 rounded-lg border border-[var(--border-primary)] cursor-pointer"
              />
            </div>
          </div>
        )}
      </div>
      
      {/* Preview */}
      <NumberPreview draft={draft} />
    </div>
  );
};
