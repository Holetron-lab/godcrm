/**
 * EditProjectModal - Modal for editing project settings
 * Simplified version with UserAccessPanel for user permissions
 */

import { logger } from '@/shared/utils/logger';
import { useState, useEffect } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { Input } from '@/shared/components/ui/Input';
import { Button } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useUpdateProjectMutation } from '@/features/projects/hooks/useProjectsQuery';
import { UserAccessPanel } from '@/shared/components/access/UserAccessPanel';
import { useAuthStore } from '@/features/auth/store/authStore';
import { EmojiPicker } from '@/features/tables/components/UniversalTable/EmojiPicker';
import { Switch } from '@/shared/components/ui/Switch';
import { ChevronDown, Globe } from 'lucide-react';
import type { UserAccessLevel, UserAccessPermissionWithUser } from '@/shared/types/user-access.types';

interface EditProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleteClick?: () => void;
  project: {
    id: number;
    owner_id?: number;
    space_id?: number;
    name: string;
    description?: string | null;
    icon?: string | null;
    theme_primary?: string;
    theme_secondary?: string;
    theme_tertiary?: string;
    is_public?: boolean;
  };
}

// 10 colors for table-style palette (2 rows of 5)
const THEME_COLORS = [
  null, '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4'
];

// Unified Color picker for project theme settings (same UI as EditTableModal)
const ColorPicker = ({
  value,
  onChange,
  label
}: {
  value: string | null;
  onChange: (color: string | null) => void;
  label?: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value || '');

  useEffect(() => {
    setInputValue(value || '');
  }, [value]);

  const handleInputChange = (v: string) => {
    setInputValue(v);
    const hex = v.startsWith('#') ? v : `#${v}`;
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      onChange(hex);
    } else if (v === '' || v === '#') {
      onChange(null);
    }
  };

  return (
    <div className="relative">
      {label && (
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
          {label}
        </label>
      )}
      <div className="flex">
        <div
          className="h-10 w-10 rounded-l-lg border border-r-0 border-[var(--border-primary)] flex items-center justify-center flex-shrink-0"
          style={{
            backgroundColor: value || 'var(--bg-secondary)',
            backgroundImage: value
              ? undefined
              : 'linear-gradient(45deg, #666 25%, transparent 25%), linear-gradient(-45deg, #666 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #666 75%), linear-gradient(-45deg, transparent 75%, #666 75%)',
            backgroundSize: value ? undefined : '6px 6px'
          }}
        />
        <input
          type="text"
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder="#000000"
          className="w-20 px-2 text-sm h-10 border-y border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] font-mono focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[var(--color-primary-500)]"
        />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="h-10 w-8 rounded-r-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] flex items-center justify-center"
        >
          <ChevronDown className={`w-3 h-3 text-[var(--text-tertiary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {isOpen && (
        <div className="absolute top-full right-0 mt-1 z-50 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg p-2">
          <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
            {THEME_COLORS.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  onChange(c);
                  setInputValue(c || '');
                  setIsOpen(false);
                }}
                className={`h-6 w-6 rounded border transition-all ${
                  value === c ? 'border-white ring-1 ring-[var(--color-primary-500)]' : 'border-transparent hover:border-white/30'
                }`}
                style={{
                  backgroundColor: c || 'var(--bg-tertiary)',
                  backgroundImage: c
                    ? undefined
                    : 'linear-gradient(45deg, #666 25%, transparent 25%), linear-gradient(-45deg, #666 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #666 75%), linear-gradient(-45deg, transparent 75%, #666 75%)',
                  backgroundSize: c ? undefined : '4px 4px'
                }}
                title={c || 'Без цвета'}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

type TabId = 'display' | 'access';

export const EditProjectModal = ({ open, onOpenChange, onDeleteClick, project }: EditProjectModalProps) => {
  const { t } = useLanguage();
  const { user } = useAuthStore();
  
  const [activeTab, setActiveTab] = useState<TabId>('display');
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || '');
  const [icon, setIcon] = useState(project.icon || '📁');
  const [themePrimary, setThemePrimary] = useState<string | null>(project.theme_primary || '#0ea5e9');
  const [themeSecondary, setThemeSecondary] = useState<string | null>(project.theme_secondary || '#8b5cf6');
  const [themeTertiary, setThemeTertiary] = useState<string | null>(project.theme_tertiary || '#10b981');
  const [isPublic, setIsPublic] = useState<boolean>(project.is_public !== false);
  const [, setUserPermissions] = useState<UserAccessPermissionWithUser[]>([]);
  const [error, setError] = useState('');

  const updateProject = useUpdateProjectMutation();

  // Determine current user's access level
  const getCurrentUserLevel = (): UserAccessLevel => {
    // If current user is owner_id, they have owner_owner access to project
    if (user?.id === project.owner_id) {
      return 'owner_owner';
    }
    // TODO: Check from user_access_permissions table
    return 'viewer';
  };

  const currentUserLevel = getCurrentUserLevel();

  // Reset form when project changes
  useEffect(() => {
    setName(project.name);
    setDescription(project.description || '');
    setIcon(project.icon || '📁');
    setThemePrimary(project.theme_primary || '#0ea5e9');
    setThemeSecondary(project.theme_secondary || '#8b5cf6');
    setThemeTertiary(project.theme_tertiary || '#10b981');
    setIsPublic(project.is_public !== false);
    setError('');
    setActiveTab('display');
  }, [project.id, project.name, project.description, project.icon, project.theme_primary, project.theme_secondary, project.theme_tertiary, project.is_public]);

  const handleSubmit = () => {
    if (!name.trim()) {
      setError('Название не может быть пустым');
      return;
    }

    updateProject.mutate(
      {
        id: project.id,
        name: name.trim(),
        description: description.trim() || null,
        icon: icon || '📁',
        theme_primary: themePrimary || '#0ea5e9',
        theme_secondary: themeSecondary || '#8b5cf6',
        theme_tertiary: themeTertiary || '#10b981',
        is_public: isPublic
      },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
        onError: (err) => {
          logger.error('Failed to update project:', err);
          setError('Не удалось обновить проект');
        },
      }
    );
  };

  const handleDeleteClick = () => {
    onOpenChange(false);
    onDeleteClick?.();
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: 'display', label: 'Отображение' },
    { id: 'access', label: 'Доступ' }
  ];

  return (
    <Modal 
      open={open} 
      onOpenChange={onOpenChange} 
      title={`Редактирование проекта "${project.name}"`}
      size="lg"
      fixedHeight={true}
      heightOffset={400}
      footer={
        <div className="flex-1 flex items-center">
          {onDeleteClick && (
            <button 
              type="button"
              onClick={handleDeleteClick}
              className="h-9 px-4 text-sm font-medium text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 hover:border-red-500/50 transition-colors"
            >
              {t('projects.delete.title')}
            </button>
          )}
        </div>
      }
      primaryAction={{
        label: updateProject.isPending ? t('common.saving') : t('common.save'),
        onClick: handleSubmit,
        disabled: updateProject.isPending
      }}
      secondaryAction={{
        label: t('common.cancel'),
        variant: 'ghost',
        onClick: () => onOpenChange(false)
      }}
    >
      <div className="flex flex-col h-full">
        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400 mb-4 shrink-0">
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-[var(--bg-secondary)] rounded-lg mb-4 shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === tab.id
                  ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content - scrollable */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Display Tab */}
          {activeTab === 'display' && (
            <div className="space-y-4">
              <div className="flex gap-3 items-end">
                <EmojiPicker
                  value={icon}
                  onChange={setIcon}
                  label={t('projects.fields.icon')}
                  size="md"
                  portal
                />
                <div className="flex-1">
                  <Input
                    id="project-name"
                    label={t('projects.fields.name')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('projects.fields.namePlaceholder')}
                    autoComplete="off"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="project-description" className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                  {t('projects.fields.description')}
                </label>
                <textarea
                  id="project-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('projects.fields.descriptionPlaceholder')}
                  rows={5}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)] resize-none"
                />
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <ColorPicker label="Основной цвет" value={themePrimary} onChange={setThemePrimary} />
                <ColorPicker label="Вторичный цвет" value={themeSecondary} onChange={setThemeSecondary} />
                <ColorPicker label="Третичный цвет" value={themeTertiary} onChange={setThemeTertiary} />
              </div>

              <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-2">
                    <Globe className="w-4 h-4 mt-0.5 text-[var(--accent-primary)] flex-shrink-0" />
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-[var(--text-primary)]">Виден в публичном пространстве</div>
                      <p className="text-xs text-[var(--text-secondary)]">
                        Если space опубликована, проект и его содержимое доступны read-only посетителям. Выключите, чтобы скрыть только этот проект.
                      </p>
                    </div>
                  </div>
                  <Switch checked={isPublic} onCheckedChange={setIsPublic} />
                </div>
              </div>
            </div>
          )}

          {/* Access Tab */}
          {activeTab === 'access' && project.space_id && (
            <UserAccessPanel
              entityType="project"
              entityId={project.id}
              spaceId={project.space_id}
              currentUserLevel={currentUserLevel}
              ownerOwnerId={project.owner_id}
              onPermissionsChange={setUserPermissions}
            />
          )}
          {activeTab === 'access' && !project.space_id && (
            <div className="flex items-center justify-center h-[300px] text-[var(--text-tertiary)]">
              <p>Space ID не определен</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default EditProjectModal;
