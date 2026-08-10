import { useState, useEffect, useMemo } from 'react';
import { logger } from '@/shared/utils/logger';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/components/ui/Modal';
import { Input } from '@/shared/components/ui/Input';
import { Button, Select, Switch, MultiSelect } from '@/shared/components/ui';
import { tablesApi } from '../api/tablesApi';
import { apiClient } from '@/shared/utils/apiClient';
import { useProjectsQuery } from '@/features/projects/hooks/useProjectsQuery';
import { useProjectTables } from '@/features/projects/hooks/useProjectTables';
import { useTableColumns } from '@/features/tables/hooks/useTableColumns';
import { useTableRows } from '@/features/tables/hooks/useTableRows';

interface AccessControlConfig {
  enabled: boolean;
  mode: 'roles' | 'users';
  usersTableId: number | null;
  userIdColumn: string;
  userNameColumn: string;
  roleColumn: string;
  roleMapping: {
    owner: string[];
    admin: string[];
    editor: string[];
    viewer: string[];
    denied: string[];
  };
}

interface EditTableModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleteClick?: () => void;
  tableId: number | string;
  projectId?: number | null;
}

const TABLE_ICONS = [
  '📊', '📋', '📅', '📈', '📦', '📁', '📝', '📌', '🎯', '⭐', '💡', '🔥',
  '✅', '💼', '🏷️', '📎', '🔗', '💰', '👥', '🛒', '📱', '💻', '🏠', '🚀',
  '🗃️', '🗂️', '📄', '📃', '📑', '📒', '🧾', '📰', '🗞️', '📓', '📔', '📕',
  '📗', '📘', '📙', '🔖', '🏷️', '💹', '📉', '🗳️', '📬', '📭', '📮', '🗄️'
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

export const EditTableModal = ({ open, onOpenChange, onDeleteClick, tableId, projectId }: EditTableModalProps) => {
  const queryClient = useQueryClient();
  
  const [activeTab, setActiveTab] = useState<TabId>('display');
  const [displayName, setDisplayName] = useState('');
  const [icon, setIcon] = useState('📋');
  const [color, setColor] = useState<string | null>(null);
  const [showInNav, setShowInNav] = useState(true);
  const [accessControl, setAccessControl] = useState<AccessControlConfig>(DEFAULT_ACCESS_CONTROL);
  const [error, setError] = useState('');
  
  // For access control - project selection
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  // Fetch fresh table data when modal opens
  const { data: tableData, isLoading } = useQuery({
    queryKey: ['edit-table-modal', tableId, projectId],
    queryFn: async () => {
      if (projectId) {
        try {
          const response = await apiClient.request<{ data: Array<{ id: number; name: string; display_name?: string; icon?: string; access_control?: string | null; show_in_nav?: number }> }>(
            `/projects/${projectId}/tables`
          );
          const found = response.data.find(t => String(t.id) === String(tableId));
          if (found) {
            let parsedAccessControl = null;
            if (found.access_control) {
              try {
                parsedAccessControl = typeof found.access_control === 'string' 
                  ? JSON.parse(found.access_control) 
                  : found.access_control;
              } catch (e) {
                logger.error('Failed to parse access_control:', e);
              }
            }
            return {
              id: found.id,
              name: found.name,
              displayName: found.display_name || found.name,
              icon: found.icon || null,
              color: (found as any).color || null,
              access_control: parsedAccessControl,
              show_in_nav: found.show_in_nav !== 0
            };
          }
        } catch (e) {
          logger.error('[EditTableModal] Project tables fetch failed:', e);
        }
      }
      
      // Direct table fetch
      const response = await apiClient.request<{ data: { id: number; name: string; display_name?: string; icon?: string; access_control?: string | null; show_in_nav?: number } }>(
        `/tables/${tableId}`
      );
      let parsedAccessControl = null;
      if (response.data.access_control) {
        try {
          parsedAccessControl = typeof response.data.access_control === 'string' 
            ? JSON.parse(response.data.access_control) 
            : response.data.access_control;
        } catch (e) {
          logger.error('Failed to parse access_control:', e);
        }
      }
      return {
        id: response.data.id,
        name: response.data.name,
        displayName: response.data.display_name || response.data.name,
        icon: response.data.icon || null,
        color: (response.data as any).color || null,
        access_control: parsedAccessControl,
        show_in_nav: response.data.show_in_nav !== 0
      };
    },
    enabled: open,
    staleTime: 0,
  });

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
      return tablesApi.updateTable(String(tableId), {
        displayName: displayName.trim(),
        icon: icon,
        color: color,
        show_in_nav: showInNav,
        access_control: accessControl
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-tables'] });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to update table');
    }
  });

  // Set form values when data loads
  useEffect(() => {
    if (tableData) {
      setDisplayName(tableData.displayName);
      setIcon(tableData.icon || '📋');
      setColor(tableData.color || null);
      setShowInNav(tableData.show_in_nav !== false);
      setAccessControl(tableData.access_control || DEFAULT_ACCESS_CONTROL);
    }
    setError('');
    setActiveTab('display');
  }, [tableData, open]);

  const handleSubmit = () => {
    if (!displayName.trim()) {
      setError('Название не может быть пустым');
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
      title={`Редактирование таблицы "${tableData?.displayName || tableData?.name || ''}"`}
      size="lg"
    >
      <div className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-primary-500)]"></div>
          </div>
        ) : (
          <>
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
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label htmlFor="table-display-name" className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                        Отображаемое название
                      </label>
                      <Input
                        id="table-display-name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Введите название таблицы"
                        autoComplete="off"
                      />
                      {tableData && (
                        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                          Исходное название: <span className="font-mono">{tableData.name}</span>
                        </p>
                      )}
                    </div>
                    <div className="w-32">
                      <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                        Цвет
                      </label>
                      <div className="flex flex-wrap gap-1">
                        {[
                          null,
                          '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
                          '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'
                        ].map((c, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setColor(c)}
                            className={`h-6 w-6 rounded border-2 transition-all ${
                              color === c 
                                ? 'border-[var(--color-primary-500)] ring-2 ring-[var(--color-primary-500)]/30' 
                                : 'border-transparent hover:border-[var(--border-primary)]'
                            }`}
                            style={{ 
                              backgroundColor: c || 'var(--bg-secondary)',
                              backgroundImage: c ? undefined : 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
                              backgroundSize: c ? undefined : '8px 8px',
                              backgroundPosition: c ? undefined : '0 0, 0 4px, 4px -4px, -4px 0px'
                            }}
                            title={c || 'Без цвета'}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                      Иконка
                    </label>
                    <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
                      <div className="mb-3 flex items-center gap-3">
                        <div className="flex-1 flex items-center justify-center rounded-lg bg-[var(--bg-secondary)] py-4">
                          <span className="text-5xl">{icon}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-[var(--text-tertiary)]">
                            Своя иконка
                          </label>
                          <input
                            type="text"
                            value={icon}
                            onChange={(e) => {
                              const value = e.target.value;
                              if (value.length <= 2) setIcon(value || '📋');
                            }}
                            className="w-20 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-center text-2xl focus:border-[var(--color-primary-500)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/20"
                            maxLength={2}
                          />
                        </div>
                      </div>
                      <div className="grid max-h-48 grid-cols-10 gap-1 overflow-y-auto">
                        {TABLE_ICONS.map((emoji, index) => (
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

                  {/* Show in navigation menu */}
                  <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-medium text-[var(--text-primary)]">Показывать в меню</h4>
                        <p className="text-xs text-[var(--text-tertiary)] mt-1">
                          Отображать таблицу в навигационном меню слева. Отключите для вспомогательных таблиц (форм, raw данных).
                        </p>
                      </div>
                      <Switch
                        checked={showInNav}
                        onCheckedChange={setShowInNav}
                      />
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

                            {/* Info about inheritance */}
                            <div className="p-3 rounded-lg bg-primary-500/10 border border-primary-500/30 text-sm text-primary-400">
                              <strong>ℹ️ Наследование:</strong> Если не настроено, таблица наследует права от проекта.
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
                    <p className="text-xs mt-1">Скоро здесь появятся настройки внешнего вида таблицы</p>
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
                  Удалить таблицу
                </button>
              )}
              {!onDeleteClick && <div />}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] border border-[var(--border-primary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                  Отмена
                </button>
                <Button 
                  variant="primary" 
                  onClick={handleSubmit}
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? 'Сохранение...' : 'Сохранить'}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
