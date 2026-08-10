/**
 * DeleteColumnModal - Confirmation modal for column deletion
 */
import { AlertTriangle } from 'lucide-react';
import { Modal, Button } from '@/shared/components/ui';
import type { DeleteColumnModalProps } from './types';

export const DeleteColumnModal = ({
  open,
  onOpenChange,
  column,
  onConfirm,
  isPending
}: DeleteColumnModalProps) => {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Удаление колонки"
      size="sm"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-4 bg-red-500/10 rounded-lg border border-red-500/30">
          <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-[var(--text-primary)] mb-2">
              Вы уверены, что хотите удалить колонку <strong>"{column?.displayName || column?.name}"</strong>?
            </p>
            <p className="text-xs text-[var(--text-tertiary)]">
              Это действие необратимо. Все данные в этой колонке будут удалены.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Отмена
          </Button>
          <Button
            variant="primary"
            className="!bg-red-600 hover:!bg-red-700"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? 'Удаление...' : 'Удалить'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
