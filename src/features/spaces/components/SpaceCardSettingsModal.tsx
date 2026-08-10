import { useState, useEffect } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { Switch } from '@/shared/components/ui/Switch';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { SpaceModel } from '../types/space.types';
import type { SpaceCardSize, SpaceCardSettings, defaultSpaceCardSettings } from '../types/spaceCardSettings.types';

interface SpaceCardSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  space: SpaceModel;
  currentSettings?: SpaceCardSettings;
  onSave: (spaceId: number, settings: SpaceCardSettings) => void;
}

const defaultSettings: SpaceCardSettings = {
  size: 'quarter',
  showProjects: true,
  showDashboards: true,
  showUsers: false,
  showDescription: true,
  order: 0
};

/**
 * Модалка настройки вида карточки Space
 * 
 * Позволяет настроить:
 * - Размер карточки (full/half/quarter)
 * - Что показывать (проекты, дашборды, пользователи, описание)
 */
export const SpaceCardSettingsModal = ({
  open,
  onOpenChange,
  space,
  currentSettings,
  onSave
}: SpaceCardSettingsModalProps) => {
  const { t } = useLanguage();
  const [settings, setSettings] = useState<SpaceCardSettings>(
    currentSettings || defaultSettings
  );

  // Reset settings when modal opens with new space
  useEffect(() => {
    if (open) {
      setSettings(currentSettings || defaultSettings);
    }
  }, [open, currentSettings]);

  const handleSave = () => {
    onSave(space.id, settings);
  };

  const sizeOptions: { value: SpaceCardSize; label: string; description: string }[] = [
    { 
      value: 'full', 
      label: t('spaces.settings.sizeFull') || 'Full Width',
      description: t('spaces.settings.sizeFullDesc') || 'Shows projects preview and detailed stats'
    },
    { 
      value: 'half', 
      label: t('spaces.settings.sizeHalf') || 'Half Width',
      description: t('spaces.settings.sizeHalfDesc') || 'Medium size with description'
    },
    { 
      value: 'quarter', 
      label: t('spaces.settings.sizeQuarter') || 'Quarter',
      description: t('spaces.settings.sizeQuarterDesc') || 'Compact view'
    }
  ];

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`${t('spaces.settings.title') || 'Card Settings'}: ${space.name}`}
      description={t('spaces.settings.description') || 'Customize how this workspace card appears'}
      size="md"
      primaryAction={{
        label: t('common.save') || 'Save',
        onClick: handleSave
      }}
      secondaryAction={{
        label: t('common.cancel') || 'Cancel',
        onClick: () => onOpenChange(false)
      }}
    >
      <div className="space-y-6">
        {/* Size Selection */}
        <div>
          <label className="mb-3 block text-sm font-medium text-[var(--text-primary)]">
            {t('spaces.settings.cardSize') || 'Card Size'}
          </label>
          <div className="grid gap-3">
            {sizeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSettings(prev => ({ ...prev, size: option.value }))}
                className={`flex items-center gap-3 rounded-lg border-2 p-3 text-left transition-all ${
                  settings.size === option.value
                    ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-50)] dark:bg-[var(--color-primary-950)]'
                    : 'border-[var(--border-primary)] hover:border-[var(--color-primary-300)]'
                }`}
              >
                {/* Size preview */}
                <div className="flex h-10 w-16 items-center justify-center rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)]">
                  <div className={`rounded bg-[var(--color-primary-400)] ${
                    option.value === 'full' ? 'h-6 w-12' :
                    option.value === 'half' ? 'h-6 w-8' : 'h-6 w-4'
                  }`} />
                </div>
                <div>
                  <div className="font-medium text-[var(--text-primary)]">{option.label}</div>
                  <div className="text-xs text-[var(--text-tertiary)]">{option.description}</div>
                </div>
                {settings.size === option.value && (
                  <svg className="ml-auto h-5 w-5 text-[var(--color-primary-500)]" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Visibility Options */}
        <div>
          <label className="mb-3 block text-sm font-medium text-[var(--text-primary)]">
            {t('spaces.settings.showOptions') || 'Show on Card'}
          </label>
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-[var(--border-primary)] p-3">
              <div>
                <div className="text-sm font-medium text-[var(--text-primary)]">
                  {t('spaces.settings.showDescription') || 'Description'}
                </div>
                <div className="text-xs text-[var(--text-tertiary)]">
                  {t('spaces.settings.showDescriptionHint') || 'Show space description text'}
                </div>
              </div>
              <Switch
                checked={settings.showDescription}
                onCheckedChange={(checked) => setSettings(prev => ({ ...prev, showDescription: checked }))}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-[var(--border-primary)] p-3">
              <div>
                <div className="text-sm font-medium text-[var(--text-primary)]">
                  {t('spaces.settings.showProjects') || 'Projects Count'}
                </div>
                <div className="text-xs text-[var(--text-tertiary)]">
                  {t('spaces.settings.showProjectsHint') || 'Show number of projects'}
                </div>
              </div>
              <Switch
                checked={settings.showProjects}
                onCheckedChange={(checked) => setSettings(prev => ({ ...prev, showProjects: checked }))}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-[var(--border-primary)] p-3">
              <div>
                <div className="text-sm font-medium text-[var(--text-primary)]">
                  {t('spaces.settings.showDashboards') || 'Dashboards Count'}
                </div>
                <div className="text-xs text-[var(--text-tertiary)]">
                  {t('spaces.settings.showDashboardsHint') || 'Show number of dashboards'}
                </div>
              </div>
              <Switch
                checked={settings.showDashboards}
                onCheckedChange={(checked) => setSettings(prev => ({ ...prev, showDashboards: checked }))}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-[var(--border-primary)] p-3">
              <div>
                <div className="text-sm font-medium text-[var(--text-primary)]">
                  {t('spaces.settings.showUsers') || 'Users'}
                </div>
                <div className="text-xs text-[var(--text-tertiary)]">
                  {t('spaces.settings.showUsersHint') || 'Show user count (detailed by role on full size)'}
                </div>
              </div>
              <Switch
                checked={settings.showUsers}
                onCheckedChange={(checked) => setSettings(prev => ({ ...prev, showUsers: checked }))}
              />
            </div>
          </div>
        </div>

        {/* Preview */}
        <div>
          <label className="mb-3 block text-sm font-medium text-[var(--text-primary)]">
            {t('spaces.settings.preview') || 'Preview'}
          </label>
          <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="h-10 w-10 flex items-center justify-center rounded-lg bg-[var(--bg-secondary)] text-xl">
                {space.icon || '📁'}
              </div>
              <div>
                <div className="font-medium text-[var(--text-primary)]">{space.name}</div>
                <div className="text-xs text-[var(--text-tertiary)]">{space.type}</div>
              </div>
            </div>
            {settings.showDescription && space.description && (
              <p className="text-xs text-[var(--text-secondary)] mb-2 line-clamp-2">{space.description}</p>
            )}
            <div className="flex gap-4 text-xs text-[var(--text-tertiary)]">
              {settings.showProjects && <span>📁 {space.projects_count || 0} projects</span>}
              {settings.showDashboards && <span>📊 {space.dashboards_count || 0} dashboards</span>}
              {settings.showUsers && <span>👤 0 users</span>}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
