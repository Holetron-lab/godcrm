import React from 'react';
import {
  Minus,
  Plus,
  SquareSplitHorizontal,
  FileText,
  RotateCcw,
  SplitSquareVertical,
  Link,
  Copy,
} from 'lucide-react';
import type { ModalSize } from '../../types/form-config.types';
import type { ViewMode, FormTypeValue } from './types';
import { MODAL_SIZE_OPTIONS, FORM_TYPE_OPTIONS } from './types';

export interface FormBuilderToolbarProps {
  formTypes: FormTypeValue[];
  onFormTypeToggle: (type: FormTypeValue) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  modalSize: ModalSize;
  onModalSizeChange: (size: ModalSize) => void;
  stats: { pages: number };
  currentPage: number;
  onPageChange: (page: number) => void;
  onAddDivider: () => void;
  onAddPageBreak: () => void;
  onAddTextBlock: () => void;
  onResetToDefault: () => void;
  tableId?: number;
  formUrl: string | null;
  embedCode: string | null;
}

export function FormBuilderToolbar({
  formTypes,
  onFormTypeToggle,
  viewMode,
  onViewModeChange,
  modalSize,
  onModalSizeChange,
  stats,
  currentPage,
  onPageChange,
  onAddDivider,
  onAddPageBreak,
  onAddTextBlock,
  onResetToDefault,
  tableId,
  formUrl,
  embedCode,
}: FormBuilderToolbarProps) {
  return (
    <div className="px-6 py-3 border-y border-[var(--border-primary)] bg-[var(--bg-tertiary)]/50 space-y-3">
      {/* Top row: Form label + type icons + settings */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Form type icons */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-[var(--text-tertiary)]">Форма:</span>
          <div className="flex items-center gap-0.5">
            {FORM_TYPE_OPTIONS.map(opt => {
              const IconComponent = opt.IconComponent;
              const isSelected = formTypes.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  onClick={() => onFormTypeToggle(opt.value)}
                  className={`p-2 rounded-lg transition-all relative ${
                    isSelected
                      ? 'bg-[var(--color-primary-500)] text-white'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]'
                  }`}
                  title={opt.label}
                >
                  <IconComponent className="w-4 h-4" />
                  {isSelected && (
                    <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="h-5 w-px bg-[var(--border-primary)]" />

        {/* View mode selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-[var(--text-tertiary)]">Вид:</span>
          <select
            value={viewMode}
            onChange={(e) => onViewModeChange(e.target.value as ViewMode)}
            className="px-2 py-1 rounded border bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] border-[var(--border-primary)]"
          >
            <option value="with-keys">С ключами</option>
            <option value="standard">Стандартный</option>
            <option value="compact">Компактный</option>
          </select>
        </div>

        <div className="h-5 w-px bg-[var(--border-primary)]" />

        {/* Modal size selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-[var(--text-tertiary)]">Окно:</span>
          <select
            value={modalSize}
            onChange={(e) => onModalSizeChange(e.target.value as ModalSize)}
            className="px-2 py-1 rounded border bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] border-[var(--border-primary)]"
          >
            {MODAL_SIZE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Page navigation */}
        {stats.pages > 1 && (
          <>
            <div className="h-5 w-px bg-[var(--border-primary)]" />
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
              <span>Стр:</span>
              <button
                className="w-6 h-6 rounded flex items-center justify-center bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] disabled:opacity-30"
                disabled={currentPage <= 1}
                onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="w-8 text-center font-medium text-[var(--text-primary)]">
                {currentPage}/{stats.pages}
              </span>
              <button
                className="w-6 h-6 rounded flex items-center justify-center bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] disabled:opacity-30"
                disabled={currentPage >= stats.pages}
                onClick={() => onPageChange(Math.min(stats.pages, currentPage + 1))}
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right toolbar - Icon buttons */}
        <div className="flex items-center gap-1 border-l border-[var(--border-primary)] pl-3">
          <button
            onClick={onAddDivider}
            className="p-2 rounded-lg hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            title="Добавить разделитель"
          >
            <SquareSplitHorizontal className="w-4 h-4" />
          </button>
          <button
            onClick={onAddPageBreak}
            className="p-2 rounded-lg hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            title="Добавить разделитель страницы"
          >
            <SplitSquareVertical className="w-4 h-4" />
          </button>
          <button
            onClick={onAddTextBlock}
            className="p-2 rounded-lg hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            title="Добавить текстовый блок"
          >
            <FileText className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-[var(--border-primary)] mx-1" />
          <button
            onClick={onResetToDefault}
            className="p-2 rounded-lg hover:bg-red-500/10 text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
            title="Сбросить форму"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Custom form URL row - show only when custom is selected */}
      {formTypes.includes('custom') && tableId && (
        <div className="flex items-center gap-3 pt-2 border-t border-[var(--border-primary)]/50">
          <span className="text-xs text-[var(--text-tertiary)]">Ссылка:</span>
          <div className="flex items-center gap-1.5 flex-1 max-w-[350px]">
            <Link className="w-4 h-4 text-[var(--text-tertiary)]" />
            <input
              type="text"
              readOnly
              value={formUrl || ''}
              className="flex-1 px-2 py-1.5 rounded border bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs border-[var(--border-primary)] truncate"
              title={formUrl || ''}
            />
            <button
              onClick={() => formUrl && navigator.clipboard.writeText(formUrl)}
              className="p-1.5 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              title="Копировать URL"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="h-5 w-px bg-[var(--border-primary)]" />

          <span className="text-xs text-[var(--text-tertiary)]">Embed:</span>
          <div className="flex items-center gap-1.5 flex-1 max-w-[400px]">
            <input
              type="text"
              readOnly
              value={embedCode || ''}
              className="flex-1 px-2 py-1.5 rounded border bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs border-[var(--border-primary)] font-mono truncate"
              title={embedCode || ''}
            />
            <button
              onClick={() => embedCode && navigator.clipboard.writeText(embedCode)}
              className="p-1.5 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              title="Копировать код"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
