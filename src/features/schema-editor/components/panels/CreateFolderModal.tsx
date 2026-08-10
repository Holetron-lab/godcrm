/**
 * CreateFolderModal - Modal for creating a new folder in a project
 */

import { useState, useCallback } from 'react';
import { logger } from '@/shared/utils/logger';
import { Loader2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { Input } from '@/shared/components/ui/Input';
import { Modal } from '@/shared/components/ui/Modal';
import { toast } from 'react-hot-toast';
import { useSchemaEditorStore } from '../../store/schemaEditorStore';
import type { NavTreeNode } from '../../types/schema-editor.types';

interface CreateFolderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: NavTreeNode[];
  spaceId: number | null;
  t: (key: string) => string;
}

export const CreateFolderModal = ({
  open,
  onOpenChange,
  projects,
  spaceId,
  t,
}: CreateFolderModalProps) => {
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderIcon, setNewFolderIcon] = useState('📁');
  const [newFolderProjectId, setNewFolderProjectId] = useState<number | null>(
    projects.length > 0 ? projects[0].numericId : null
  );
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim() || !newFolderProjectId || !spaceId) return;

    setIsCreatingFolder(true);
    try {
      const response = await fetch(`/api/v3/projects/${newFolderProjectId}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newFolderName.trim(),
          icon: newFolderIcon,
        }),
      });

      const data = await response.json();
      if (data.success) {
        toast.success(t('schemaEditor.folderCreated') || 'Folder created');
        onOpenChange(false);
        setNewFolderName('');
        setNewFolderIcon('📁');
        setNewFolderProjectId(null);
        // Refresh tree
        useSchemaEditorStore.getState().loadSchema(spaceId);
      } else {
        toast.error(data.error?.message || 'Failed to create folder');
      }
    } catch (error) {
      logger.error('Failed to create folder:', error);
      toast.error('Failed to create folder');
    } finally {
      setIsCreatingFolder(false);
    }
  }, [newFolderName, newFolderIcon, newFolderProjectId, spaceId, t, onOpenChange]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('schemaEditor.createFolder') || 'Create Folder'}
      size="sm"
    >
      <div className="space-y-4">
        {/* Project Selection */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
            {t('common.project') || 'Project'}
          </label>
          <select
            value={newFolderProjectId ?? ''}
            onChange={(e) => setNewFolderProjectId(e.target.value ? parseInt(e.target.value) : null)}
            className="
              w-full px-3 py-2
              bg-[var(--bg-secondary)] border border-[var(--border-primary)]
              rounded-lg text-[var(--text-primary)]
              focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50
            "
          >
            <option value="">{t('common.selectProject') || 'Select project...'}</option>
            {projects.map(project => (
              <option key={project.id} value={project.numericId}>
                {project.icon} {project.name}
              </option>
            ))}
          </select>
        </div>

        {/* Icon selection */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
            {t('common.icon') || 'Icon'}
          </label>
          <div className="flex flex-wrap gap-1">
            {['📁', '📂', '🗂️', '📋', '📑', '📊', '📈', '📉', '🗃️', '📦'].map(emoji => (
              <button
                key={emoji}
                type="button"
                onClick={() => setNewFolderIcon(emoji)}
                className={`
                  w-8 h-8 text-lg rounded-md border transition-all
                  ${newFolderIcon === emoji
                    ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/20 scale-110'
                    : 'border-transparent hover:bg-[var(--bg-tertiary)]'
                  }
                `}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
            {t('common.name') || 'Name'}
          </label>
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder={t('schemaEditor.folderNamePlaceholder') || 'Folder name...'}
            autoFocus
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {t('common.cancel') || 'Cancel'}
          </Button>
          <Button
            onClick={handleCreateFolder}
            disabled={!newFolderName.trim() || !newFolderProjectId || isCreatingFolder}
          >
            {isCreatingFolder ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('common.creating') || 'Creating...'}
              </>
            ) : (
              t('common.create') || 'Create'
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
