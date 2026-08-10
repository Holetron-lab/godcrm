import { useEffect, useState } from 'react';
import { logger } from '@/shared/utils/logger';
import { Modal, Input, Select } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useCreateProject } from '../hooks/useCreateProject';
import { useSpacesQuery } from '@/features/spaces/hooks/useSpacesQuery';
import type { ProjectModel } from '../api/projectsApi';
import { EmojiPicker } from '@/features/tables/components/UniversalTable/EmojiPicker';

interface CreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (project: ProjectModel) => void;
  spaceId?: number | null;
}

export const CreateProjectModal = ({ open, onOpenChange, onCreated, spaceId }: CreateProjectModalProps) => {
  const { t } = useLanguage();
  const createProject = useCreateProject();
  const { data: spaces = [] } = useSpacesQuery();
  const [form, setForm] = useState({ name: '', description: '', logo: '⭐' });
  const [selectedSpaceId, setSelectedSpaceId] = useState<number | null>(spaceId ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setForm({ name: '', description: '', logo: '⭐' });
      setError(null);
      // Reset to the passed spaceId when modal closes
      setSelectedSpaceId(spaceId ?? null);
    } else {
      // When modal opens, use the passed spaceId as initial value
      setSelectedSpaceId(spaceId ?? null);
    }
  }, [open, spaceId]);

  const handleSubmit = () => {
    if (!form.name.trim()) {
      setError(t('projects.errors.nameRequired'));
      return;
    }
    if (!selectedSpaceId) {
      setError('Выберите пространство для создания проекта');
      return;
    }
    setError(null);
    createProject.mutate(
      {
        name: form.name.trim(),
        description: form.description.trim() ? form.description.trim() : undefined,
        logo: form.logo?.trim() || undefined,
        space_id: selectedSpaceId
      },
      {
        onSuccess: (project) => {
          if (project) {
            onCreated?.(project);
          }
          onOpenChange(false);
        },
        onError: (error) => {
          logger.error('[CreateProjectModal] onError:', error);
          setError(error.message || t('projects.errors.generic'));
        }
      }
    );
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('projects.modalTitle')}
      description={t('projects.modalDescription')}
      size="md"
      primaryAction={{
        label: createProject.isPending ? t('projects.modalSubmitting') : t('projects.modalSubmit'),
        onClick: handleSubmit
      }}
      secondaryAction={{
        label: t('common.cancel'),
        variant: 'ghost',
        onClick: () => onOpenChange(false)
      }}
    >
      <div className="space-y-4">
        {/* Space selector */}
        <Select
          label="Пространство"
          placeholder="Выберите пространство"
          value={selectedSpaceId ? String(selectedSpaceId) : ''}
          onChange={(value) => setSelectedSpaceId(value ? Number(value) : null)}
          options={spaces.map((space) => ({
            label: `${space.icon || '🏢'} ${space.name} (ID: ${space.id})`,
            value: String(space.id)
          }))}
        />

        <div className="flex gap-3 items-end">
          <EmojiPicker
            value={form.logo}
            onChange={(emoji) => setForm((prev) => ({ ...prev, logo: emoji }))}
            label={t('projects.fields.icon')}
            size="md"
            portal
          />
          <div className="flex-1">
            <Input
              label={t('projects.fields.name')}
              placeholder={t('projects.fields.namePlaceholder')}
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>
        </div>
        
        <div className="flex flex-col gap-1 text-sm">
          <label className="font-medium text-[var(--text-secondary)]">{t('projects.fields.description')}</label>
          <textarea
            className="min-h-[120px] rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--color-primary-500)] focus:ring-1 focus:ring-[var(--color-primary-500)]"
            placeholder={t('projects.fields.descriptionPlaceholder')}
            value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          />
        </div>
        {error && <p className="text-sm text-[var(--color-error)]">{error}</p>}
        {createProject.error && (
          <p className="text-sm text-[var(--color-error)]">
            {createProject.error?.message || t('projects.errors.generic')}
          </p>
        )}
        {createProject.isPending && (
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--color-primary-200)] border-t-[var(--color-primary-600)]" />
            {t('projects.modalSubmitting')}
          </div>
        )}
      </div>
    </Modal>
  );
};
