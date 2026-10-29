import { useState, useEffect, useId, useRef } from 'react';
import { logger } from '@/shared/utils/logger';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useDeleteSpaceMutation } from '@/features/spaces/hooks/useSpacesQuery';

interface DeleteSpaceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  space: {
    id: number;
    name: string;
  };
}

export const DeleteSpaceModal = ({ open, onOpenChange, space }: DeleteSpaceModalProps) => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [error, setError] = useState('');
  const confirmationId = useId();
  const confirmationRef = useRef<HTMLInputElement>(null);

  const deleteSpace = useDeleteSpaceMutation();
  
  const canDelete = deleteConfirmText.toLowerCase() === 'delete';

  // Reset form when modal opens/closes
  useEffect(() => {
    if (open) {
      setDeleteConfirmText('');
      setError('');
    }
  }, [open]);

  const handleDelete = () => {
    if (!canDelete || deleteSpace.isPending) return;
    setError('');
    // Keep focus inside the dialog before the submit button becomes disabled.
    confirmationRef.current?.focus();
    
    deleteSpace.mutate(space.id, {
      onSuccess: () => {
        onOpenChange(false);
        // Navigate to spaces list after deletion
        navigate('/spaces');
      },
      onError: (err) => {
        logger.error('Failed to delete space:', err);
        setError(err instanceof Error && err.message.trim() ? err.message : t('spaces.delete.failed'));
      },
    });
  };

  return (
    <Modal 
      restoreFocus
      open={open} 
      onOpenChange={onOpenChange} 
      title={`⚠️ ${t('spaces.delete.modalTitle')}`}
    >
      <div className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <p className="mb-2 text-sm text-[var(--text-secondary)]">
            {t('spaces.delete.warningText')} <strong className="text-red-700 dark:text-red-300">&quot;{space.name}&quot;</strong>{t('spaces.delete.warningTextSuffix')}
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor={confirmationId} className="block text-sm text-[var(--text-secondary)]">
            {t('spaces.delete.typeToConfirm')} <strong className="font-mono text-red-700 dark:text-red-300">delete</strong> {t('spaces.delete.typeToConfirmSuffix')}
          </label>
          <input
            id={confirmationId}
            ref={confirmationRef}
            type="text"
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder={t('spaces.delete.placeholder')}
            autoComplete="off"
            className="w-full rounded-lg border border-red-500/30 bg-[var(--bg-secondary)] px-3 py-2.5 text-sm font-mono 
              text-[var(--text-primary)]
              focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20
              placeholder:text-[var(--text-tertiary)]"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="flex-1"
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="ghost"
            onClick={handleDelete}
            disabled={!canDelete || deleteSpace.isPending}
            className={`flex-1 transition-all ${
              canDelete 
                ? '!bg-red-600 !text-white hover:!bg-red-700' 
                : '!bg-[var(--bg-tertiary)] !text-[var(--text-tertiary)] cursor-not-allowed'
            }`}
          >
            {deleteSpace.isPending ? t('spaces.delete.deleting') : `🗑️ ${t('spaces.delete.deleteForever')}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
