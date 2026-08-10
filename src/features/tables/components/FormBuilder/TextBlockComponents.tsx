import React from 'react';
import {
  FileText,
  ArrowUp,
  ArrowDown,
  Trash2,
  X,
} from 'lucide-react';
import { SafeHtml } from '@/shared/components/SafeHtml';
import type { FormTextBlock } from '../../types/form-config.types';
import { WIDTH_OPTIONS } from './types';

// Text block card preview (shows rendered content)
export function TextBlockPreview({
  block,
  isSelected,
  onClick,
  isPreviewMode = false,
}: {
  block: FormTextBlock;
  isSelected: boolean;
  onClick: () => void;
  isPreviewMode?: boolean;
}) {
  // Render content based on type
  const renderContent = () => {
    if (!block.content) {
      if (isPreviewMode) return null;
      return (
        <span className="text-[var(--text-tertiary)] italic text-sm">
          Нажмите для редактирования...
        </span>
      );
    }

    if (block.contentType === 'html') {
      return (
        <SafeHtml
          html={block.content}
          className="text-sm text-[var(--text-primary)] prose prose-sm max-w-none"
        />
      );
    }

    // Default: markdown (simple render for now)
    return (
      <div className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">
        {block.content}
      </div>
    );
  };

  // Preview mode - simple render
  if (isPreviewMode) {
    if (!block.content) return null;
    return (
      <div className="p-1.5">
        <div className="min-h-[1.5rem]">{renderContent()}</div>
      </div>
    );
  }

  return (
    <div className="p-1.5">
      <div
        onClick={onClick}
        className={`
          p-3 rounded-lg border cursor-pointer transition-all
          ${isSelected
            ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10 ring-2 ring-[var(--color-primary-500)]'
            : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-[var(--color-primary-400)]'}
        `}
      >
        <div className="flex items-center gap-2 mb-2">
          <FileText className="w-3 h-3 text-[var(--text-tertiary)]" />
          <span className="text-[10px] text-[var(--text-tertiary)]">
            Текст ({block.contentType === 'html' ? 'HTML' : 'Markdown'})
          </span>
        </div>

        <div className="min-h-[1.5rem]">{renderContent()}</div>
      </div>
    </div>
  );
}

// Text block settings panel
export function TextBlockSettingsPanel({
  block,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  onClose,
}: {
  block: FormTextBlock;
  onUpdate: (updates: Partial<FormTextBlock>) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onClose: () => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-[var(--text-tertiary)]" />
          <span className="text-sm font-medium text-[var(--text-primary)]">
            Текстовый блок
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Move arrows */}
          <button
            disabled={!canMoveUp}
            onClick={onMoveUp}
            className="p-1.5 rounded hover:bg-[var(--bg-secondary)] disabled:opacity-30 transition-colors"
            title="Переместить вверх"
          >
            <ArrowUp className="w-4 h-4 text-[var(--text-tertiary)]" />
          </button>
          <button
            disabled={!canMoveDown}
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
            defaultValue={block.order}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const newOrder = parseInt((e.target as HTMLInputElement).value) || block.order;
                onUpdate({ order: newOrder });
                (e.target as HTMLInputElement).blur();
              }
            }}
            onBlur={(e) => {
              const newOrder = parseInt(e.target.value) || block.order;
              if (newOrder !== block.order) {
                onUpdate({ order: newOrder });
              }
            }}
            className="w-14 px-2 py-1 rounded border bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs text-center focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)] border-[var(--border-primary)]"
            title="Порядок (Enter для применения)"
          />

          {/* Delete button */}
          <button
            onClick={onDelete}
            className="p-1.5 rounded hover:bg-red-500/20 text-red-500 transition-colors"
            title="Удалить"
          >
            <Trash2 className="w-4 h-4" />
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

      {/* Settings row */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Content type */}
        <div>
          <label className="block text-xs text-[var(--text-tertiary)] mb-1.5">
            Тип контента
          </label>
          <select
            value={block.contentType || 'markdown'}
            onChange={(e) => onUpdate({ contentType: e.target.value as 'markdown' | 'html' })}
            className="w-full px-3 py-2 rounded-lg border bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] border-[var(--border-primary)]"
          >
            <option value="markdown">Markdown</option>
            <option value="html">HTML</option>
          </select>
        </div>

        {/* Width */}
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
                  block.width === opt.value || (!block.width && opt.value === 'full')
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

      {/* Content editor */}
      <div>
        <label className="block text-xs text-[var(--text-tertiary)] mb-1.5">
          Содержимое ({block.contentType === 'html' ? 'HTML' : 'Markdown'})
        </label>
        <textarea
          value={block.content || ''}
          onChange={(e) => onUpdate({ content: e.target.value })}
          placeholder={block.contentType === 'html'
            ? '<p>Введите HTML код...</p>'
            : '# Заголовок\n\nВведите текст...'
          }
          rows={4}
          className="w-full p-3 rounded-lg border bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] border-[var(--border-primary)]"
        />
      </div>
    </div>
  );
}
