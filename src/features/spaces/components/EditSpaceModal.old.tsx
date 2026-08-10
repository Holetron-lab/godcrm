import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/components/ui/Modal';
import { Input } from '@/shared/components/ui/Input';
import { Button, Select, Switch, MultiSelect } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { spacesApi } from '../api/spacesApi';
import { useProjectsQuery } from '@/features/projects/hooks/useProjectsQuery';
import { useProjectTables } from '@/features/projects/hooks/useProjectTables';
import { useTableColumns } from '@/features/tables/hooks/useTableColumns';
import { useTableRows } from '@/features/tables/hooks/useTableRows';
import type { AccessControlConfig } from '../types/space.types';

interface EditSpaceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleteClick?: () => void;
  space: {
    id: number;
    name: string;
    description?: string | null;
    icon?: string | null;
    type: 'personal' | 'business' | 'admin';
    access_control?: AccessControlConfig | null;
  };
}

const SPACE_ICONS = [
  '📁', '💼', '🏢', '🚀', '⚡', '🎯', '🌟', '💡', '🔥', '🎨', '📊', '🛠️',
  '⭐', '✨', '🎭', '🎪', '🎬', '🎮', '🎲', '🎰', '🃏', '🎴', '🀄', '🎖️',
  '🏆', '🏅', '🥇', '🥈', '🥉', '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐',
  '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅',
  '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️',
  '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '🤺', '⛹️', '🤾', '🏌️',
  '🏇', '🧘', '🏄', '🏊', '🤽', '🚣', '🧗', '🚴', '🚵', '🏎️', '🏍️', '🛺',
  '🚙', '🚗', '🚕', '🚌', '🚎', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛',
  '🚜', '🦯', '🦽', '🦼', '🛴', '🚲', '🛵', '🚨', '🚔', '🚍', '🚘', '🚖',
  '🚡', '🚠', '🚟', '🚃', '🚋', '🚞', '🚝', '🚄', '🚅', '🚈', '🚂', '🚆',
  '🚇', '🚊', '🚉', '✈️', '🛫', '🛬', '💺', '🚁', '🛩️', '🛸', '🛰️', '🌍',
  '🌎', '🌏', '🌐', '🗺️', '🗾', '🧭', '🏔️', '⛰️', '🌋', '🗻', '🏕️', '🏖️'
];

type TabId = 'display' | 'access' | 'personalization';

const DEFAULT_ACCESS_CONTROL: AccessControlConfig = {
  enabled: false,
  mode: 'roles',
  usersTableId: null,
  userIdColumn: '',
  userNameColumn: '',
  roleColumn: '',
  roleMapping: {
    owner: [],
    admin: [],
    editor: [],
    viewer: [],
    denied: []
  }
};

export const EditSpaceModal = ({ open, onOpenChange, onDeleteClick, space }: EditSpaceModalProps) => {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  
  const [activeTab, setActiveTab] = useState<TabId>('display');
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description || '');
  const [icon, setIcon] = useState(space.icon || '📁');
  const [accessControl, setAccessControl] = useState<AccessControlConfig>(
    space.access_control || DEFAULT_ACCESS_CONTROL
  );
  const [error, setError] = useState('');
  
  // For access control - project selection
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  // Queries for access control
  const { data: allProjects = [] } = useProjectsQuery();
  const { data: projectTables = [] } = useProjectTables(selectedProjectId);
  const { data: tableColumns = [] } = useTableColumns(accessControl.usersTableId?.toString());
  const { data: tableRows = [] } = useTableRows(accessControl.usersTableId?.toString());

  // Get options for role column
  const roleColumnOptions = useMemo(() => {
    if (!accessControl.roleColumn) return [];
    
    const roleColumn = tableColumns.find(col => col.name === accessControl.roleColumn);
    if (!roleColumn) return [];
    
    // If select type - use its options
    if (roleColumn.type === 'select' && roleColumn.config?.options) {
      const opts = roleColumn.config.options;
      
      // Handle both array of strings and array of objects
      return opts.map((opt: string | { value: string; label?: string }) => {
        if (typeof opt === 'string') {
          return { value: opt, label: opt };
        }
        return {
          value: opt.value || '',
          label: opt.label || opt.value || ''
        };
      }).filter((o: { value: string; label: string }) => o.value);
    }
    
    // Otherwise collect unique values from data
    const uniqueValues = new Set<string>();
    tableRows.forEach(row => {
      const value = row.data?.[accessControl.roleColumn];
      if (value && typeof value === 'string' && value.trim()) {
        uniqueValues.add(value.trim());
      }
    });
    
    return Array.from(uniqueValues).sort().map(v => ({ value: v, label: v }));
  }, [tableColumns, tableRows, accessControl.roleColumn]);

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async () => {
      return spacesApi.update(space.id, {
        name: name.trim(),
        description: description.trim() || null,
        icon: icon || '📁',
        access_control: accessControl
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to update space');
    }
  });

  // Reset form when space changes
  useEffect(() => {
    setName(space.name);
    setDescription(space.description || '');
    setIcon(space.icon || '📁');
    setAccessControl(space.access_control || DEFAULT_ACCESS_CONTROL);
    setError('');
    setActiveTab('display');
  }, [space.id, space.name, space.description, space.icon, space.access_control]);

  const handleSubmit = () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    updateMutation.mutate();
  };

  const handleDeleteClick = () => {
    onOpenChange(false);
    onDeleteClick?.();
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: 'display', label: 'Отображение' },
    { id: 'access', label: 'Доступ' },
    { id: 'personalization', label: 'Персонализация' }
  ];

  return (
    <Modal 
      open={open} 
      onOpenChange={onOpenChange} 
      title={`Редактирование пространства "${space.name}"`}
      className="max-w-[600px]"
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-[var(--bg-secondary)] rounded-lg">
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

        {/* Tab content */}
        <div className="min-h-[300px]">
          {/* Display Tab */}
          {activeTab === 'display' && (
            <div className="space-y-4">
              <div>
                <label htmlFor="space-name" className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                  {t('spaces.fields.name')}
                </label>
                <Input
                  id="space-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('spaces.fields.namePlaceholder')}
                  autoComplete="off"
                />
              </div>

              <div>
                <label htmlFor="space-description" className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                  {t('spaces.fields.description')}
                </label>
                <Input
                  id="space-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('spaces.fields.descriptionPlaceholder')}
                  autoComplete="off"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                  {t('spaces.fields.icon')}
                </label>
                <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex-1 flex items-center justify-center rounded-lg bg-[var(--bg-secondary)] py-4">
                      <span className="text-5xl">{icon}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-[var(--text-tertiary)]">
                        {t('spaces.fields.icon')}
                      </label>
                      <input
                        type="text"
                        value={icon}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value.length <= 2) setIcon(value || '📁');
                        }}
                        className="w-20 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-center text-2xl focus:border-[var(--color-primary-500)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/20"
                        maxLength={2}
                      />
                    </div>
                  </div>
                  <div className="grid max-h-48 grid-cols-10 gap-1 overflow-y-auto">
                    {SPACE_ICONS.map((emoji, index) => (
                      <button
                        key={`${emoji}-${index}`}
                        type="button"
                        onClick={() => setIcon(emoji)}
                        className={`flex h-10 w-10 items-center justify-center rounded-lg text-xl transition ${
                          icon === emoji
                            ? 'bg-[var(--color-primary-500)]/20 ring-2 ring-[var(--color-primary-500)]'
                            : 'hover:bg-[var(--bg-tertiary)]'
                        }`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Access Tab */}
          {activeTab === 'access' && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h4 className="text-sm font-medium text-[var(--text-primary)]">Контроль доступа</h4>
                    <p className="text-xs text-[var(--text-tertiary)] mt-1">
                      Настройте роли для управления правами пользователей
                    </p>
                  </div>
                  <Switch
                    checked={accessControl.enabled}
                    onCheckedChange={(checked) => setAccessControl({ ...accessControl, enabled: checked })}
                  />
                </div>

                {accessControl.enabled && (
                  <div className="space-y-4 pt-4 border-t border-[var(--border-secondary)]">
                    {/* Project selector */}
                    <Select
                      label="Проект с таблицей пользователей"
                      value={selectedProjectId?.toString() || '__none__'}
                      onChange={(value) => {
                        const newProjectId = value === '__none__' ? null : parseInt(value);
                        setSelectedProjectId(newProjectId);
                        setAccessControl({
                          ...accessControl,
                          usersTableId: null,
                          userIdColumn: '',
                          userNameColumn: '',
                          roleColumn: '',
                          roleMapping: { owner: [], admin: [], editor: [], viewer: [], denied: [] }
                        });
                      }}
                      options={[
                        { label: '— Выберите проект —', value: '__none__' },
                        ...allProjects.map(p => ({ label: p.name, value: p.id.toString() }))
                      ]}
                    />

                    {/* Table selector */}
                    {selectedProjectId && (
                      <Select
                        label="Таблица с пользователями"
                        value={accessControl.usersTableId?.toString() || '__none__'}
                        onChange={(value) => {
                          const usersTableId = value === '__none__' ? null : parseInt(value);
                          setAccessControl({
                            ...accessControl,
                            usersTableId,
                            userIdColumn: '',
                            userNameColumn: '',
                            roleColumn: '',
                            roleMapping: { owner: [], admin: [], editor: [], viewer: [], denied: [] }
                          });
                        }}
                        options={[
                          { label: '— Выберите таблицу —', value: '__none__' },
                          ...projectTables.map(t => ({
                            label: t.displayName || t.name,
                            value: t.id.toString()
                          }))
                        ]}
                      />
                    )}

                    {/* Column mappings */}
                    {accessControl.usersTableId && tableColumns.length > 0 && (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <Select
                            label="Колонка ID"
                            value={accessControl.userIdColumn || '__none__'}
                            onChange={(value) => setAccessControl({
                              ...accessControl,
                              userIdColumn: value === '__none__' ? '' : value
                            })}
                            options={[
                              { label: '— ID —', value: '__none__' },
                              ...tableColumns.map(col => ({
                                label: col.displayName || col.name,
                                value: col.name
                              }))
                            ]}
                          />
                          
                          <Select
                            label="Колонка имени"
                            value={accessControl.userNameColumn || '__none__'}
                            onChange={(value) => setAccessControl({
                              ...accessControl,
                              userNameColumn: value === '__none__' ? '' : value
                            })}
                            options={[
                              { label: '— Имя —', value: '__none__' },
                              ...tableColumns.map(col => ({
                                label: col.displayName || col.name,
                                value: col.name
                              }))
                            ]}
                          />
                        </div>

                        {/* Role column and mapping */}
                        <div className="space-y-3 p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-secondary)]">
                          <h5 className="text-sm font-medium text-[var(--text-secondary)]">Настройка ролей</h5>
                          
                          <Select
                            label="Колонка с ролью"
                            value={accessControl.roleColumn || '__none__'}
                            onChange={(value) => setAccessControl({
                              ...accessControl,
                              roleColumn: value === '__none__' ? '' : value,
                              roleMapping: { owner: [], admin: [], editor: [], viewer: [], denied: [] }
                            })}
                            options={[
                              { label: '— Выберите колонку роли —', value: '__none__' },
                              ...tableColumns.map(col => ({
                                label: `${col.displayName || col.name} (${col.type})`,
                                value: col.name
                              }))
                            ]}
                          />

                          {accessControl.roleColumn && roleColumnOptions.length > 0 && (
                            <div className="space-y-2">
                              {[
                                { key: 'owner', label: 'Owner', required: true },
                                { key: 'admin', label: 'Admin', required: false },
                                { key: 'editor', label: 'Editor', required: false },
                                { key: 'viewer', label: 'Viewer', required: false },
                                { key: 'denied', label: 'Denied', required: false }
                              ].map(role => {
                                const values = accessControl.roleMapping[role.key as keyof typeof accessControl.roleMapping] || [];
                                
                                return (
                                  <div key={role.key} className="flex items-center gap-3">
                                    <span className={`w-16 text-sm ${role.required ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                                      {role.label}{role.required && ' *'}
                                    </span>
                                    <div className="flex-1">
                                      <MultiSelect
                                        value={values}
                                        onChange={(newValues) => setAccessControl({
                                          ...accessControl,
                                          roleMapping: {
                                            ...accessControl.roleMapping,
                                            [role.key]: newValues
                                          }
                                        })}
                                        options={roleColumnOptions}
                                        placeholder="— выберите значения —"
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {accessControl.roleColumn && roleColumnOptions.length === 0 && (
                            <div className="text-xs text-[var(--text-tertiary)] p-2 bg-yellow-500/10 rounded border border-yellow-500/30">
                              ⚠️ Нет данных в колонке роли
                            </div>
                          )}
                        </div>

                        {/* Info about Space Owner */}
                        <div className="p-3 rounded-lg bg-primary-500/10 border border-primary-500/30 text-sm text-primary-400">
                          <strong>ℹ️ Space Owner:</strong> Создатель пространства всегда имеет полный контроль и не может быть ограничен в правах другими ролями.
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Personalization Tab */}
          {activeTab === 'personalization' && (
            <div className="flex items-center justify-center h-[300px] text-[var(--text-tertiary)]">
              <div className="text-center">
                <div className="text-4xl mb-2">🎨</div>
                <p>Персонализация</p>
                <p className="text-xs mt-1">Скоро здесь появятся настройки темы и внешнего вида</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 pt-4 border-t border-[var(--border-primary)]">
          {onDeleteClick && (
            <button 
              type="button"
              onClick={handleDeleteClick}
              className="px-4 py-2 text-sm font-medium text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 hover:border-red-500/50 transition-colors"
            >
              {t('spaces.delete.deleteButton')}
            </button>
          )}
          {!onDeleteClick && <div />}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] border border-[var(--border-primary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              {t('common.cancel')}
            </button>
            <Button 
              variant="primary" 
              onClick={handleSubmit}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Сохранение...' : t('common.save')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
