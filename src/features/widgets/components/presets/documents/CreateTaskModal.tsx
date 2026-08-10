/**
 * CreateTaskModal Component - ADR-038
 * 
 * Modal for creating a task from a document item
 * 
 * @see ADR-038-DOCUMENTS-TASKS-SYNC.md
 */

import { useState, useCallback, useMemo } from 'react';
import { X, Plus, Calendar, User, Flag, Loader2 } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { logger } from '@/shared/utils/logger';
import type { DocumentItem, TaskBindingConfig } from '../../../types/documents.types';

// === TYPES ===

export interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateTaskData) => Promise<void>;
  documentItem: DocumentItem | null;
  config: TaskBindingConfig | undefined;
  isSubmitting?: boolean;
}

export interface CreateTaskData {
  title: string;
  description: string;
  status: string;
  due_date: string;
  priority: string;
}

// === STATUS & PRIORITY OPTIONS ===

const STATUS_OPTIONS = [
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'blocked', label: 'Blocked' },
];

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low', color: 'text-gray-400' },
  { value: 'medium', label: 'Medium', color: 'text-yellow-500' },
  { value: 'high', label: 'High', color: 'text-orange-500' },
  { value: 'urgent', label: 'Urgent', color: 'text-red-500' },
];

// === COMPONENT ===

export function CreateTaskModal({
  isOpen,
  onClose,
  onSubmit,
  documentItem,
  config,
  isSubmitting = false,
}: CreateTaskModalProps) {
  // Extract title from document item content
  const defaultTitle = useMemo(() => {
    if (!documentItem) return '';
    const content = documentItem.content_en || documentItem.content || '';
    // Remove markdown heading prefix
    return content.replace(/^#+\s*/, '').trim();
  }, [documentItem]);

  // Form state
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState(config?.export_options?.default_status || 'todo');
  const [priority, setPriority] = useState(config?.export_options?.default_priority || 'medium');
  const [dueDate, setDueDate] = useState('');

  // Reset form when modal opens with new item
  useMemo(() => {
    if (isOpen && documentItem) {
      const content = documentItem.content_en || documentItem.content || '';
      setTitle(content.replace(/^#+\s*/, '').trim());
      setDescription('');
      setStatus(config?.export_options?.default_status || 'todo');
      setPriority(config?.export_options?.default_priority || 'medium');
      setDueDate('');
    }
  }, [isOpen, documentItem, config]);

  // Handle submit
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim()) {
      return;
    }

    logger.debug({ title, status, priority, dueDate }, '[CreateTaskModal] Submitting');

    await onSubmit({
      title: title.trim(),
      description: description.trim(),
      status,
      due_date: dueDate,
      priority,
    });
  }, [title, description, status, priority, dueDate, onSubmit]);

  // Handle close
  const handleClose = useCallback(() => {
    if (!isSubmitting) {
      onClose();
    }
  }, [isSubmitting, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />
      
      {/* Modal */}
      <div className={cn(
        'relative w-full max-w-md mx-4',
        'bg-[var(--bg-primary)] rounded-xl shadow-2xl',
        'border border-[var(--border-primary)]'
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-[var(--accent-primary)]" />
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">
              Создать задачу
            </h3>
          </div>
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className={cn(
              'p-1.5 rounded-md transition-colors',
              'hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)]',
              'hover:text-[var(--text-primary)]',
              isSubmitting && 'opacity-50 cursor-not-allowed'
            )}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--text-secondary)]">
              Название *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Введите название задачи..."
              required
              disabled={isSubmitting}
              className={cn(
                'w-full px-3 py-2 text-sm rounded-lg',
                'bg-[var(--bg-secondary)] border border-[var(--border-primary)]',
                'text-[var(--text-primary)] placeholder-[var(--text-tertiary)]',
                'focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]',
                isSubmitting && 'opacity-50'
              )}
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--text-secondary)]">
              Описание
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Добавьте описание..."
              rows={3}
              disabled={isSubmitting}
              className={cn(
                'w-full px-3 py-2 text-sm rounded-lg resize-none',
                'bg-[var(--bg-secondary)] border border-[var(--border-primary)]',
                'text-[var(--text-primary)] placeholder-[var(--text-tertiary)]',
                'focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]',
                isSubmitting && 'opacity-50'
              )}
            />
          </div>

          {/* Status & Priority Row */}
          <div className="grid grid-cols-2 gap-3">
            {/* Status */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--text-secondary)]">
                Статус
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                disabled={isSubmitting}
                className={cn(
                  'w-full px-3 py-2 text-sm rounded-lg',
                  'bg-[var(--bg-secondary)] border border-[var(--border-primary)]',
                  'text-[var(--text-primary)]',
                  'focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]',
                  isSubmitting && 'opacity-50'
                )}
              >
                {STATUS_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Priority */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1 text-sm font-medium text-[var(--text-secondary)]">
                <Flag className="w-3.5 h-3.5" />
                Приоритет
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                disabled={isSubmitting}
                className={cn(
                  'w-full px-3 py-2 text-sm rounded-lg',
                  'bg-[var(--bg-secondary)] border border-[var(--border-primary)]',
                  'text-[var(--text-primary)]',
                  'focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]',
                  isSubmitting && 'opacity-50'
                )}
              >
                {PRIORITY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Due Date */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1 text-sm font-medium text-[var(--text-secondary)]">
              <Calendar className="w-3.5 h-3.5" />
              Дедлайн
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={isSubmitting}
              className={cn(
                'w-full px-3 py-2 text-sm rounded-lg',
                'bg-[var(--bg-secondary)] border border-[var(--border-primary)]',
                'text-[var(--text-primary)]',
                'focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]',
                isSubmitting && 'opacity-50'
              )}
            />
          </div>

          {/* Source Info */}
          {documentItem && (
            <div className="px-3 py-2 text-xs text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] rounded-lg">
              <span className="font-medium">Источник:</span>{' '}
              {documentItem.level?.toUpperCase() || 'item'} элемент документа #{documentItem.id}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className={cn(
                'px-4 py-2 text-sm rounded-lg transition-colors',
                'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
                isSubmitting && 'opacity-50 cursor-not-allowed'
              )}
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title.trim()}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                'bg-[var(--accent-primary)] text-white',
                'hover:bg-[var(--accent-primary-hover)]',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'flex items-center gap-2'
              )}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Создание...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Создать
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateTaskModal;
