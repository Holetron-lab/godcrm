import React, { useId } from 'react';
import type { FormField } from '../../types/form-config.types';
import type { ColumnModel } from '../../types/table.types';
import type { ViewMode } from './types';

// Field preview component for editor mode
export function FieldPreviewEditor({
  field,
  column,
  viewMode,
  isSelected,
  onClick,
  sampleValue,
}: {
  field: FormField;
  column: ColumnModel | undefined;
  viewMode: ViewMode;
  isSelected: boolean;
  onClick: () => void;
  sampleValue?: unknown;
}) {
  const inputId = useId();
  if (!column) return null;

  const isCheckbox = column.type === 'checkbox';
  const displayName = field.label || column.displayName || column.name;
  // "Расширяемое": a text column previewed as the textarea the live form will render.
  const isMultiline = column.type === 'text' && Boolean(field.expandable);
  const previewRows = field.rows && field.rows > 0 ? field.rows : 3;
  const previewValue = sampleValue !== undefined && sampleValue !== null ? String(sampleValue) : '';
  const previewInputClass = 'w-full border-none bg-transparent text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]';

  // Width calculation
  const widthStyle = { width: { quarter: '25%', third: '33.333%', half: '50%', full: '100%', auto: '100%' }[field.width] };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onClick();
    }
  };

  // Checkbox rendering
  if (isCheckbox) {
    return (
      <div className="p-1.5" style={widthStyle}>
        <div
          onClick={onClick}
          role="button"
          tabIndex={0}
          aria-label={`Выбрать поле: ${displayName}`}
          aria-pressed={isSelected}
          onKeyDown={handleKeyDown}
          className={`
            rounded-lg border transition-all h-full cursor-pointer
            ${isSelected
              ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10 ring-2 ring-[var(--color-primary-500)]'
              : 'border-[var(--border-primary)] bg-[var(--bg-secondary)]'}
            hover:border-[var(--color-primary-400)]
          `}
        >
          <div className="px-3 py-2">
            {viewMode === 'with-keys' ? (
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <label htmlFor={inputId} className="text-sm font-medium text-[var(--text-primary)]">
                    {displayName}
                  </label>
                  <span className="text-[var(--text-tertiary)] font-mono text-xs">
                    ({column.name})
                  </span>
                </div>
                <input id={inputId} aria-label={displayName}
                  disabled
                  className="w-5 h-5 rounded border-[var(--border-primary)] text-[var(--color-primary-500)] focus:ring-[var(--color-primary-500)] mt-0.5"
                  type="checkbox"
                  checked={Boolean(sampleValue)}
                />
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={inputId} className="text-sm font-medium text-[var(--text-primary)] truncate">
                  {displayName}
                </label>
                <input id={inputId} aria-label={displayName}
                  disabled
                  className="w-5 h-5 rounded border-[var(--border-primary)] text-[var(--color-primary-500)] focus:ring-[var(--color-primary-500)] flex-shrink-0"
                  type="checkbox"
                  checked={Boolean(sampleValue)}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Compact mode - label as placeholder
  if (viewMode === 'compact') {
    return (
      <div className="p-1.5" style={widthStyle}>
        <div
          onClick={onClick}
          role="button"
          tabIndex={0}
          aria-label={`Выбрать поле: ${displayName}`}
          aria-pressed={isSelected}
          onKeyDown={handleKeyDown}
          className={`
            rounded-lg border transition-all h-full cursor-pointer
            ${isSelected
              ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10 ring-2 ring-[var(--color-primary-500)]'
              : 'border-[var(--border-primary)] bg-[var(--bg-secondary)]'}
            hover:border-[var(--color-primary-400)]
          `}
        >
          <div className="px-3 py-2">
            {column.type === 'select' || column.type === 'relation' ? (
              <select id={inputId} aria-label={displayName}
                disabled
                className="w-full px-3 py-2 rounded-lg border bg-[var(--bg-primary)] text-[var(--text-tertiary)] focus:outline-none border-[var(--border-primary)] cursor-not-allowed"
              >
                <option value="">{displayName}</option>
              </select>
            ) : (
              <div className="flex items-center gap-2 rounded-md border bg-[var(--bg-primary)] px-3 py-2 border-[var(--border-primary)]">
                {isMultiline ? (
                  <textarea id={inputId} aria-label={displayName}
                    className={`${previewInputClass} resize-none`}
                    disabled
                    placeholder={displayName}
                    rows={previewRows}
                    value={previewValue}
                  />
                ) : (
                  <input id={inputId} aria-label={displayName}
                    className={previewInputClass}
                    disabled
                    placeholder={displayName}
                    type={column.type === 'datetime' ? 'date' : column.type === 'number' ? 'number' : 'text'}
                    value={previewValue}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Regular field rendering (with-keys or standard)
  return (
    <div className="p-1.5" style={widthStyle}>
      <div
        onClick={onClick}
          role="button"
          tabIndex={0}
          aria-label={`Выбрать поле: ${displayName}`}
          aria-pressed={isSelected}
          onKeyDown={handleKeyDown}
        className={`
          rounded-lg border transition-all h-full cursor-pointer
          ${isSelected
            ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10 ring-2 ring-[var(--color-primary-500)]'
            : 'border-[var(--border-primary)] bg-[var(--bg-secondary)]'}
          hover:border-[var(--color-primary-400)]
        `}
      >
        {/* Label */}
        <div className="px-3 pt-2 pb-1">
          {viewMode === 'with-keys' ? (
            <label htmlFor={inputId} className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
              {displayName}
              <span className="text-[var(--text-tertiary)] font-mono font-normal">
                ({column.name})
              </span>
            </label>
          ) : (
            <label htmlFor={inputId} className="text-sm font-medium text-[var(--text-primary)]">
              {displayName}
            </label>
          )}
        </div>

        {/* Input preview */}
        <div className="px-3 pb-2">
          {column.type === 'select' || column.type === 'relation' ? (
            <select id={inputId} aria-label={displayName}
              disabled
              className="w-full px-3 py-2 rounded-lg border bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none opacity-50 cursor-not-allowed border-[var(--border-primary)]"
            >
              <option value="">Выберите...</option>
              {column.config?.options?.slice(0, 5).map((opt: { value: string; label?: string }) => (
                <option key={opt.value} value={opt.value}>{opt.label || opt.value}</option>
              ))}
            </select>
          ) : (
            <div className="flex items-center gap-2 rounded-md border bg-[var(--bg-primary)] px-3 py-2 border-[var(--border-primary)]">
              {isMultiline ? (
                <textarea id={inputId} aria-label={displayName}
                  className={`${previewInputClass} resize-none`}
                  disabled
                  placeholder={field.placeholder || displayName}
                  rows={previewRows}
                  value={previewValue}
                />
              ) : (
                <input id={inputId} aria-label={displayName}
                  className={previewInputClass}
                  disabled
                  placeholder={field.placeholder || displayName}
                  type={column.type === 'datetime' ? 'date' : column.type === 'number' ? 'number' : column.type === 'url' ? 'url' : 'text'}
                  value={previewValue}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
