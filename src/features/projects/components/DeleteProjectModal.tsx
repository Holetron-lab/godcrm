import { useState, useEffect } from 'react';
import { logger } from '@/shared/utils/logger';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useDeleteProjectMutation } from '@/features/projects/hooks/useProjectsQuery';

interface DeleteProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: {
    id: number;
    name: string;
    space_id?: number;
  };
}

export const DeleteProjectModal = ({ open, onOpenChange, project }: DeleteProjectModalProps) => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [error, setError] = useState('');

  const deleteProject = useDeleteProjectMutation();
  
  const canDelete = deleteConfirmText.toLowerCase() === 'delete';

  // Reset form when modal opens/closes
  useEffect(() => {
    if (open) {
      setDeleteConfirmText('');
      setError('');
    }
  }, [open]);

  const handleDelete = () => {
    if (!canDelete) return;
    
    deleteProject.mutate(project.id, {
      onSuccess: () => {
        onOpenChange(false);
        // Navigate to space dashboard after deletion
        if (project.space_id) {
          navigate(`/spaces/${project.space_id}/dashboard`);
        } else {
          navigate('/spaces');
        }
      },
      onError: (err) => {
        logger.error('Failed to delete project:', err);
        setError(t('projects.errors.generic'));
      },
    });
  };

  return (
    <Modal 
      open={open} 
      onOpenChange={onOpenChange} 
      title={`⚠️ ${t('projects.delete.modalTitle')}`}
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <p className="mb-2 text-sm text-[var(--text-secondary)]">
            {t('projects.delete.warningText')} <strong className="text-red-400">"{project.name}"</strong> {t('projects.delete.warningTextSuffix')}
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm text-[var(--text-secondary)]">
            {t('projects.delete.typeToConfirm')} <strong className="font-mono text-red-400">delete</strong> {t('projects.delete.typeToConfirmSuffix')}
          </p>
          <input
            type="text"
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder={t('projects.delete.placeholder')}
            autoComplete="off"
            className="w-full rounded-lg border border-red-500/30 bg-[var(--bg-secondary)] px-3 py-2.5 text-sm font-mono 
              text-[var(--text-primary)]
              focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20
              placeholder:text-[var(--text-tertiary)]"
            autoFocus
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
            disabled={!canDelete || deleteProject.isPending}
            className={`flex-1 transition-all ${
              canDelete 
                ? '!bg-red-600 !text-white hover:!bg-red-700' 
                : '!bg-[var(--bg-tertiary)] !text-[var(--text-tertiary)] cursor-not-allowed'
            }`}
          >
            {deleteProject.isPending ? t('projects.delete.deleting') : `🗑️ ${t('projects.delete.deleteForever')}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
