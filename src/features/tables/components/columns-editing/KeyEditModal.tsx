/**
 * KeyEditModal - Confirmation modal for column key editing
 */
import { useState, useEffect } from 'react';
import { Modal, Button } from '@/shared/components/ui';
import type { KeyEditModalProps } from './types';

export const KeyEditModal = ({
  column,
  onClose,
  onConfirm
}: KeyEditModalProps) => {
  const [keyDraft, setKeyDraft] = useState('');

  useEffect(() => {
    if (column) {
      setKeyDraft(column.name);
    }
  }, [column]);

  return (
    <Modal
      open={!!column}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title="Изменение ключа колонки"
      size="sm"
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">
          Изменение ключа влияет на API и формулы. Введите новый ключ и подтвердите действие.
        </p>
        <div className="space-y-2">
          <label className="text-xs text-[var(--text-tertiary)]">Новый ключ</label>
          <input
            type="text"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
            className="w-full px-3 py-2 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
            placeholder="example_column"
          />
          <p className="text-[10px] text-[var(--text-tertiary)]">
            Допустимы латинские буквы, цифры и нижнее подчеркивание.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={onClose}
          >
            Отмена
          </Button>
          <button
            type="button"
            onClick={() => {
              if (column) {
                const sanitized = keyDraft.toLowerCase().replace(/[^a-z0-9_]/g, '_');
                onConfirm(column.id, sanitized);
              }
              onClose();
            }}
            className="inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary-500)] disabled:cursor-not-allowed disabled:opacity-60 bg-[var(--color-primary-600)] text-white hover:bg-[var(--color-primary-700)] px-4 py-2 text-sm"
          >
            Сохранить
          </button>
        </div>
      </div>
    </Modal>
  );
};
