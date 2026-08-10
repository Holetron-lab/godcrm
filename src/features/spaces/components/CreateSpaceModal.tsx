// Create Space Modal
import { logger } from '@/shared/utils/logger';
import { useEffect, useState } from 'react';
import { Modal, Input } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useCreateSpaceMutation } from '../hooks/useSpacesQuery';
import type { SpaceModel } from '../types/space.types';
import { EmojiPicker } from '@/features/tables/components/UniversalTable/EmojiPicker';

interface CreateSpaceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (space: SpaceModel) => void;
}

export const CreateSpaceModal = ({ open, onOpenChange, onCreated }: CreateSpaceModalProps) => {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('📁');
  const [type, setType] = useState<'business' | 'personal' | 'admin'>('business');
  const [error, setError] = useState('');

  const createSpace = useCreateSpaceMutation();

  useEffect(() => {
    if (!open) {
      setName('');
      setDescription('');
      setIcon('📁');
      setType('business');
      setError('');
    }
  }, [open]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    
    if (!name.trim()) {
      setError(t('spaces.errors.nameRequired') || 'Name is required');
      return;
    }

    createSpace.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      icon: icon || '📁',
      type,
    }, {
      onSuccess: (data) => {
        onOpenChange(false);
        onCreated?.(data);
      },
      onError: (err) => {
        logger.error('Failed to create space:', err);
        setError(t('spaces.errors.generic') || 'Failed to create workspace');
      }
    });
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('spaces.modalTitle')}
      description={t('spaces.modalDescription')}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex gap-3 items-end">
          <EmojiPicker
            value={icon}
            onChange={setIcon}
            label={t('spaces.fields.icon')}
            size="md"
            portal
          />
          <div className="flex-1">
            <Input
              label={t('spaces.fields.name')}
              placeholder={t('spaces.fields.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={error}
              required
            />
          </div>
        </div>

        {/* Type selector */}
        <div className="space-y-2">
          <label className="font-medium text-[var(--text-secondary)]">
            {t('spaces.fields.type')}
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setType('personal')}
              className={`flex-1 px-3 py-2 rounded-lg border transition-colors ${
                type === 'personal'
                  ? 'border-[var(--border-focus)] bg-[var(--bg-secondary)]'
                  : 'border-[var(--border-primary)] hover:border-[var(--border-hover)]'
              }`}
            >
              👤 {t('spaces.types.personal')}
            </button>
            <button
              type="button"
              onClick={() => setType('business')}
              className={`flex-1 px-3 py-2 rounded-lg border transition-colors ${
                type === 'business'
                  ? 'border-[var(--border-focus)] bg-[var(--bg-secondary)]'
                  : 'border-[var(--border-primary)] hover:border-[var(--border-hover)]'
              }`}
            >
              🏢 {t('spaces.types.business')}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="font-medium text-[var(--text-secondary)]">
            {t('spaces.fields.description')}
          </label>
          <textarea
            placeholder={t('spaces.fields.descriptionPlaceholder')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] focus:border-[var(--border-focus)] focus:outline-none transition-colors resize-none"
            rows={3}
          />
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {createSpace.isPending && (
          <div className="text-center text-[var(--text-secondary)]">
            {t('spaces.creating') || 'Creating...'}
          </div>
        )}

        <div className="flex gap-3 pt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex-1 px-4 py-2 rounded-lg border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
            disabled={createSpace.isPending}
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="flex-1 px-4 py-2 rounded-lg bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            disabled={createSpace.isPending || !name.trim()}
          >
            {createSpace.isPending ? (t('spaces.creating') || 'Creating...') : t('spaces.createButton')}
          </button>
        </div>
      </form>
    </Modal>
  );
};
