import React from 'react';
import {
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  X,
} from 'lucide-react';
import type { FormField } from '../../types/form-config.types';
import type { ColumnModel } from '../../types/table.types';
import { WIDTH_OPTIONS } from './types';

// Inline field settings panel (opens below selected field)
export function FieldSettingsPanel({
  field,
  column,
  totalFields,
  currentIndex,
  onUpdate,
  onMoveUp,
  onMoveDown,
  onToggleVisibility,
  onClose,
}: {
  field: FormField;
  column: ColumnModel | undefined;
  totalFields: number;
  currentIndex: number;
  onUpdate: (updates: Partial<FormField>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleVisibility: () => void;
  onClose: () => void;
}) {
  const displayName = field.label || column?.displayName || column?.name || '';

  return (
    <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-4">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {displayName}
          </span>
          <span className="text-xs text-[var(--text-tertiary)] font-mono">
            ({column?.name})
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Move arrows */}
          <button
            disabled={currentIndex === 0}
            onClick={onMoveUp}
            className="p-1.5 rounded hover:bg-[var(--bg-secondary)] disabled:opacity-30 transition-colors"
            title="Переместить вверх"
          >
            <ArrowUp className="w-4 h-4 text-[var(--text-tertiary)]" />
          </button>
          <button
            disabled={currentIndex >= totalFields - 1}
            onClick={onMoveDown}
            className="p-1.5 rounded hover:bg-[var(--bg-secondary)] disabled:opacity-30 transition-colors"
            title="Переместить вниз"
          >
            <ArrowDown className="w-4 h-4 text-[var(--text-tertiary)]" />
          </button>

          {/* Order input */}
          <input
            type="number"
            min={1}
            max={totalFields}
            defaultValue={field.order ?? currentIndex + 1}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const newOrder = parseInt((e.target as HTMLInputElement).value) || currentIndex + 1;
                onUpdate({ order: newOrder });
                (e.target as HTMLInputElement).blur();
              }
            }}
            onBlur={(e) => {
              const newOrder = parseInt(e.target.value) || currentIndex + 1;
              if (newOrder !== (field.order ?? currentIndex + 1)) {
                onUpdate({ order: newOrder });
              }
            }}
            className="w-14 px-2 py-1 rounded border bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs text-center focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)] border-[var(--border-primary)]"
            title="Порядок (Enter для применения)"
          />

          {/* Visibility toggle */}
          <button
            onClick={onToggleVisibility}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
              field.hidden
                ? 'bg-red-500/10 text-red-500'
                : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
            }`}
          >
            {field.hidden ? (
              <>
                <EyeOff className="w-3.5 h-3.5" />
                Скрыть
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5" />
                Скрыть
              </>
            )}
          </button>

          {/* Close button */}
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-[var(--bg-secondary)] transition-colors"
            >
              <X className="w-4 h-4 text-[var(--text-tertiary)]" />
            </button>
          </div>
        </div>

        {/* Settings grid */}
        <div className="grid grid-cols-3 gap-4">
          {/* Column 1: Label */}
          <div>
            <label className="block text-xs text-[var(--text-tertiary)] mb-1.5">
              Название поля
            </label>
            <input
              type="text"
              value={field.label || ''}
              onChange={(e) => onUpdate({ label: e.target.value })}
              placeholder={column?.displayName || column?.name}
              className="w-full px-3 py-2 rounded-lg border bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] border-[var(--border-primary)]"
            />
          </div>

          {/* Column 2: Default value */}
          <div>
            <label className="block text-xs text-[var(--text-tertiary)] mb-1.5">
              Значение по умолчанию <span className="opacity-50">{'{{ключ}}'}</span>
            </label>
            {/* For date/datetime fields - show special options */}
            {(column?.type === 'datetime') ? (
              <select
                value={field.defaultValue as string || ''}
                onChange={(e) => onUpdate({ defaultValue: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] border-[var(--border-primary)]"
              >
                <option value="">Не задано</option>
                <option value="{{NOW}}">⏱ Время сохранения</option>
                <option value="{{TODAY}}">📅 Сегодня (начало дня)</option>
              </select>
            ) : (
              <input
                type="text"
                value={field.defaultValue as string || ''}
                onChange={(e) => onUpdate({ defaultValue: e.target.value })}
                placeholder="{{column_name}} или текст"
                className="w-full px-3 py-2 rounded-lg border bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] border-[var(--border-primary)]"
              />
            )}
          </div>

          {/* Column 3: Width */}
          <div>
            <label className="block text-xs text-[var(--text-tertiary)] mb-1.5">
              Ширина
            </label>
            <div className="flex gap-1">
              {WIDTH_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => onUpdate({ width: opt.value })}
                  className={`flex-1 p-2 rounded transition-colors flex items-center justify-center ${
                    field.width === opt.value
                      ? 'bg-[var(--color-primary-500)] text-white'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
                  }`}
                  title={opt.label}
                >
                  {opt.icon}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Description / Hint row */}
        <div className="mt-4">
          <label className="block text-xs text-[var(--text-tertiary)] mb-1.5">
            Описание / Подсказка
          </label>
          <textarea
            value={field.description || ''}
            onChange={(e) => onUpdate({ description: e.target.value })}
            placeholder="Поддержка: {{column_name}}, **жирный**, *курсив*, `код`, [ссылка](url)"
            rows={2}
            className="w-full px-3 py-2 rounded-lg border bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] border-[var(--border-primary)] resize-none"
          />
        </div>

        {/* Checkboxes row */}
        <div className="mt-4 flex items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={field.required || false}
              onChange={(e) => onUpdate({ required: e.target.checked })}
              className="w-3.5 h-3.5 rounded border-[var(--border-primary)] text-[var(--color-primary-500)] focus:ring-[var(--color-primary-500)]"
            />
            <span className="text-xs text-[var(--text-secondary)]">Обязательное</span>
          </label>

          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={field.readonly || false}
              onChange={(e) => onUpdate({ readonly: e.target.checked })}
              className="w-3.5 h-3.5 rounded border-[var(--border-primary)] text-[var(--color-primary-500)] focus:ring-[var(--color-primary-500)]"
            />
            <span className="text-xs text-[var(--text-secondary)]">Только чтение</span>
          </label>

          {/* Text field specific options - inline with other checkboxes */}
          {(column?.type === 'text') && (
            <>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={field.expandable || false}
                  onChange={(e) => onUpdate({ expandable: e.target.checked })}
                  className="w-3.5 h-3.5 rounded border-[var(--border-primary)] text-[var(--color-primary-500)] focus:ring-[var(--color-primary-500)]"
                />
                <span className="text-xs text-[var(--text-secondary)]">Расширяемое</span>
              </label>

              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[var(--text-secondary)]">Строк:</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={field.rows || 3}
                  onChange={(e) => onUpdate({ rows: parseInt(e.target.value) || 3 })}
                  className="w-12 px-1.5 py-0.5 rounded border bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)] border-[var(--border-primary)]"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer info */}
        <div className="mt-4 pt-3 border-t border-[var(--border-primary)]">
          <span className="text-xs text-[var(--text-tertiary)]">
            Ключ: {column?.name} · Позиция: {currentIndex + 1} из {totalFields}
          </span>
        </div>
      </div>
  );
}
