import { ColumnModel } from '@/features/tables/types/table.types';
import React from 'react';

/**
 * Общий интерфейс для всех type-specific компонентов настроек колонок
 */
export interface ColumnSettingsProps {
  draft: ColumnModel;
  setDraft: (updaterOrValue: ((prev: ColumnModel) => ColumnModel) | ColumnModel) => void;
  allColumns?: ColumnModel[];
  rows?: Array<{ id: string; data: Record<string, unknown> }>;
  tableId?: number;
  projectId?: number;
  // Для relation настроек
  relationTableId?: number | string;
  relationTableColumns?: ColumnModel[];
  relationProjectTables?: Array<{ id: number | string; displayName?: string; name: string }>;
  // Для table настроек
  currentTableColumns?: ColumnModel[] | Array<{ name: string; displayName: string; type: string }>;
  // Данные первой строки для превью
  firstRow?: Record<string, unknown> | null;
  // Resolved значение для отображения (например, название из связанной таблицы)
  resolvedDisplayValue?: string | null;
  // Цвет для resolved значения
  resolvedDisplayColor?: string | null;
}

/**
 * Рендерит превью ячейки для конкретного типа колонки
 * @param draft - конфиг колонки
 * @param firstRow - данные первой строки
 * @param resolvedDisplayValue - resolved значение (например, название из связанной таблицы)
 * @param resolvedDisplayColor - цвет для отображения
 */
export function renderTypeCellPreview(
  draft: ColumnModel,
  firstRow?: Record<string, unknown> | null,
  resolvedDisplayValue?: string | null,
  resolvedDisplayColor?: string | null
): React.ReactNode {
  const rawValue = firstRow ? (firstRow[draft.name] ?? firstRow[draft.id] ?? null) : null;
  const draftType = draft.type as string;

  switch (draftType) {
    case 'table': {
      const tableConfig = draft.config?.table;
      const icon = tableConfig?.icon === 'list' ? '📝' :
                   tableConfig?.icon === 'grid' ? '⊞' :
                   tableConfig?.icon === 'folder' ? '📁' :
                   tableConfig?.icon === 'box' ? '📦' :
                   tableConfig?.icon === 'eye' ? '👁' :
                   tableConfig?.icon === 'link' ? '🔗' :
                   tableConfig?.icon === 'none' ? '' : '📋';
      const buttonLabel = tableConfig?.buttonLabel || 'Показать записи';
      const buttonStyle = tableConfig?.buttonStyle || 'default';

      return (
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
            buttonStyle === 'outline'
              ? 'border border-[var(--color-primary-500)] text-[var(--color-primary-500)]'
              : buttonStyle === 'ghost'
              ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
              : buttonStyle === 'link'
              ? 'text-[var(--color-primary-500)] underline p-0'
              : 'bg-[var(--color-primary-500)] text-white'
          }`}
        >
          {icon && <span>{icon}</span>}
          <span className="truncate max-w-[120px]">{buttonLabel}</span>
        </button>
      );
    }

    case 'button': {
      const buttonConfig = draft.config?.button;
      const icon = buttonConfig?.icon === 'play' ? '▶️' :
                   buttonConfig?.icon === 'send' ? '📤' :
                   buttonConfig?.icon === 'link' ? '🔗' :
                   buttonConfig?.icon === 'copy' ? '📋' :
                   buttonConfig?.icon === 'edit' ? '✏️' :
                   buttonConfig?.icon === 'trash' ? '🗑️' :
                   buttonConfig?.icon === 'more' ? '⋯' : '⚡';
      const label = buttonConfig?.label || 'Действие';
      const variant = buttonConfig?.variant || 'secondary';

      return (
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
            variant === 'primary'
              ? 'bg-[var(--color-primary-500)] text-white'
              : variant === 'danger'
              ? 'bg-red-500 text-white'
              : variant === 'ghost'
              ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-color)]'
          }`}
        >
          <span>{icon}</span>
          <span className="truncate max-w-[100px]">{label}</span>
        </button>
      );
    }

    case 'select': {
      if (resolvedDisplayValue) {
        const color = resolvedDisplayColor || '#6366f1';
        return (
          <span
            className="px-2 py-0.5 rounded text-xs font-medium truncate"
            style={{ backgroundColor: color + '20', color: color }}
          >
            {resolvedDisplayValue}
          </span>
        );
      }

      const options = (draft.config?.select as any)?.options || draft.config?.options || [];
      const strValue = String(rawValue ?? '');
      const option = options.find((o: { value: string; label: string; color?: string }) => o.value === strValue);

      if (option) {
        return (
          <span
            className="px-2 py-0.5 rounded text-xs font-medium truncate"
            style={{ backgroundColor: (option.color || '#6366f1') + '20', color: option.color || '#6366f1' }}
          >
            {option.label}
          </span>
        );
      }
      return <span className="text-[var(--text-secondary)]">{strValue || '— Не выбрано —'}</span>;
    }

    case 'checkbox': {
      const checked = Boolean(rawValue);
      return <span className="text-lg">{checked ? '☑' : '☐'}</span>;
    }

    case 'relation': {
      return (
        <div className="flex items-center gap-1.5">
          <span className="text-primary-500">🔗</span>
          <span className="text-xs text-primary-600 dark:text-primary-400 font-medium truncate">
            {rawValue ? String(rawValue) : 'Связанная запись'}
          </span>
        </div>
      );
    }

    case 'file': {
      const fileConfig = draft.config?.file;
      const displayStyle = fileConfig?.displayStyle || 'icon-name';
      return (
        <div className="flex items-center gap-1.5">
          <span>📎</span>
          {displayStyle !== 'icon-only' && (
            <span className="text-xs text-[var(--text-secondary)] truncate">
              {rawValue ? String(rawValue) : 'Файл не выбран'}
            </span>
          )}
        </div>
      );
    }

    case 'date':
    case 'datetime': {
      const dateConfig = draft.config?.date;
      const displayFormat = dateConfig?.displayFormat || 'default';

      const formatDateValue = (val: unknown): string => {
        if (!val) return new Date().toLocaleDateString('ru-RU');

        const date = new Date(String(val));
        if (isNaN(date.getTime())) return String(val);

        switch (displayFormat) {
          case 'relative': {
            const now = new Date();
            const diff = now.getTime() - date.getTime();
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            if (days === 0) return 'сегодня';
            if (days === 1) return 'вчера';
            if (days < 7) return `${days} дн. назад`;
            return `${Math.floor(days / 7)} нед. назад`;
          }
          case 'full':
            return date.toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });
          case 'short':
            return date.toLocaleDateString('ru-RU');
          case 'iso_date':
            return date.toISOString().split('T')[0];
          case 'datetime_default':
            return date.toLocaleDateString('ru-RU', { year: 'numeric', month: 'short', day: 'numeric' }) + ', ' +
                   date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
          case 'datetime_short':
            return date.toLocaleDateString('ru-RU') + ' ' +
                   date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
          case 'datetime_iso':
            return date.toISOString().replace('T', ' ').slice(0, 19);
          case 'datetime_seconds':
            return date.toLocaleDateString('ru-RU', { year: 'numeric', month: 'short', day: 'numeric' }) + ', ' +
                   date.toLocaleTimeString('ru-RU');
          case 'time_only':
            return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
          case 'time_seconds':
            return date.toLocaleTimeString('ru-RU');
          default:
            return date.toLocaleDateString('ru-RU', { year: 'numeric', month: 'short', day: 'numeric' });
        }
      };

      return (
        <div className="flex items-center gap-1.5">
          <span>📅</span>
          <span className="text-xs">
            {formatDateValue(rawValue)}
          </span>
        </div>
      );
    }

    case 'number': {
      const numberConfig = draft.config?.number;
      const numValue = Number(rawValue ?? 0);

      if (numberConfig?.showProgress) {
        return (
          <div className="w-full flex items-center gap-2">
            <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-500 rounded-full"
                style={{ width: `${Math.min(100, Math.max(0, numValue))}%` }}
              />
            </div>
            <span className="text-xs">{numValue}</span>
          </div>
        );
      }

      if (numberConfig?.displayStyle === 'rating') {
        const maxStars = numberConfig?.maxStars || 5;
        const filled = Math.min(Math.floor(numValue), maxStars);
        return (
          <span className="text-yellow-500">
            {'★'.repeat(filled)}{'☆'.repeat(maxStars - filled)}
          </span>
        );
      }

      return (
        <span className="truncate">
          {numberConfig?.prefix || ''}
          {numValue}
          {numberConfig?.suffix || ''}
        </span>
      );
    }

    case 'url': {
      const urlConfig = draft.config?.url;
      const strValue = String(rawValue ?? '');
      return (
        <div className="flex items-center gap-1.5">
          <span>🔗</span>
          <span className="text-xs text-primary-600 dark:text-primary-400 underline truncate">
            {urlConfig?.displayText || strValue || 'https://example.com'}
          </span>
        </div>
      );
    }

    default: {
      const textConfig = draft.config?.text;
      const strValue = String(rawValue ?? 'Пример текста');
      return (
        <span className="truncate">
          {textConfig?.prefix || ''}
          {strValue}
          {textConfig?.suffix || ''}
        </span>
      );
    }
  }
}
