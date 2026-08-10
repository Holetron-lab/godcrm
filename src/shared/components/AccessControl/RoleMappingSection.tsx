import { useMemo, useState } from 'react';
import { Select, MultiSelect } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useProjectTables } from '@/features/projects/hooks/useProjectTables';
import { useProjectsQuery } from '@/features/projects/hooks/useProjectsQuery';
import { useTableColumns } from '@/features/tables/hooks/useTableColumns';
import { useTableRows } from '@/features/tables/hooks/useTableRows';

/**
 * Access Control Configuration
 * 
 * Roles (from highest to lowest):
 * - owner: Full control (Space Owner cannot be demoted by anyone)
 * - admin: Settings + edit (cannot demote owner)
 * - editor: Edit content only
 * - viewer: View only
 * - denied: No access (hidden)
 * 
 * Inheritance:
 * Space → Project → Table → Column
 * More specific settings override parent settings
 */

export interface AccessControlConfig {
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
  // For user mode
  userPermissions?: {
    settingsColumn?: string;
    editColumn?: string;
    viewColumn?: string;
    deniedColumn?: string;
  };
  // Inheritance
  inheritFromParent?: boolean;
}

export const DEFAULT_ACCESS_CONTROL: AccessControlConfig = {
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
  },
  inheritFromParent: true
};

interface RoleMappingSectionProps {
  config: AccessControlConfig;
  onChange: (config: AccessControlConfig) => void;
  level: 'space' | 'project' | 'table' | 'column';
  spaceId?: number;
  parentConfig?: AccessControlConfig | null; // Config from parent level
}

export const RoleMappingSection = ({
  config,
  onChange,
  level,
  spaceId,
  parentConfig
}: RoleMappingSectionProps) => {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  // Get all projects for project selector
  const { data: allProjects = [] } = useProjectsQuery();
  
  // State for selected project (for users table selection)
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  
  // Get tables from selected project
  const { data: projectTables = [] } = useProjectTables(selectedProjectId);
  
  // Get columns from selected users table
  const { data: tableColumns = [] } = useTableColumns(config.usersTableId?.toString());
  
  // Get rows to extract unique role values
  const { data: tableRows = [] } = useTableRows(config.usersTableId?.toString());
  
  // Get options for role column
  const roleColumnOptions = useMemo(() => {
    if (!config.roleColumn) return [];
    
    const roleColumn = tableColumns.find(col => col.name === config.roleColumn);
    if (!roleColumn) return [];
    
    // If select type - use its options
    if (roleColumn.type === 'select' && roleColumn.config?.options) {
      return roleColumn.config.options.map((opt: { value: string; label?: string }) => ({
        value: opt.value,
        label: opt.label || opt.value
      }));
    }
    
    // Otherwise collect unique values from data
    const uniqueValues = new Set<string>();
    tableRows.forEach(row => {
      const value = row.data?.[config.roleColumn];
      if (value && typeof value === 'string' && value.trim()) {
        uniqueValues.add(value.trim());
      }
    });
    
    return Array.from(uniqueValues).sort().map(v => ({ value: v, label: v }));
  }, [tableColumns, tableRows, config.roleColumn]);

  const showInheritOption = level !== 'space' && parentConfig?.enabled;

  return (
    <div className="space-y-4">
      {/* Inherit from parent option */}
      {showInheritOption && (
        <div className="flex items-center gap-3 p-3 bg-[var(--bg-tertiary)] rounded-lg border border-[var(--border-secondary)]">
          <input
            type="checkbox"
            id="inherit-access"
            checked={config.inheritFromParent !== false}
            onChange={(e) => onChange({ ...config, inheritFromParent: e.target.checked })}
            className="rounded border-[var(--border-primary)]"
          />
          <label htmlFor="inherit-access" className="text-sm text-[var(--text-secondary)]">
            {t('Наследовать настройки от', 'Inherit settings from')} {level === 'column' ? t('таблицы', 'table') : level === 'table' ? t('проекта', 'project') : t('пространства', 'space')}
          </label>
        </div>
      )}

      {/* Show inherited config preview */}
      {showInheritOption && config.inheritFromParent !== false && parentConfig && (
        <div className="p-3 bg-primary-500/10 border border-primary-500/30 rounded-lg text-sm text-primary-600 dark:text-primary-400">
          {t('✓ Используются настройки из', '✓ Using settings from')} {level === 'column' ? t('таблицы', 'table') : level === 'table' ? t('проекта', 'project') : t('пространства', 'space')}
        </div>
      )}

      {/* Own settings (show if not inheriting or if this is space level) */}
      {(level === 'space' || config.inheritFromParent === false) && (
        <>
          {/* Project selector (to find users table) */}
          <Select
            label={t('Проект с таблицей пользователей', 'Project with users table')}
            value={selectedProjectId?.toString() || '__none__'}
            onChange={(value) => {
              const newProjectId = value === '__none__' ? null : parseInt(value);
              setSelectedProjectId(newProjectId);
              onChange({
                ...config,
                usersTableId: null,
                userIdColumn: '',
                userNameColumn: '',
                roleColumn: '',
                roleMapping: { owner: [], admin: [], editor: [], viewer: [], denied: [] }
              });
            }}
            options={[
              { label: t('— Выберите проект —', '— Select a project —'), value: '__none__' },
              ...allProjects.map(p => ({ label: p.name, value: p.id.toString() }))
            ]}
          />

          {/* Table selector */}
          {selectedProjectId && (
            <Select
              label={t('Таблица с пользователями', 'Users table')}
              value={config.usersTableId?.toString() || '__none__'}
              onChange={(value) => {
                const usersTableId = value === '__none__' ? null : parseInt(value);
                onChange({
                  ...config,
                  usersTableId,
                  userIdColumn: '',
                  userNameColumn: '',
                  roleColumn: '',
                  roleMapping: { owner: [], admin: [], editor: [], viewer: [], denied: [] }
                });
              }}
              options={[
                { label: t('— Выберите таблицу —', '— Select a table —'), value: '__none__' },
                ...projectTables.map(t => ({
                  label: t.displayName || t.name,
                  value: t.id.toString()
                }))
              ]}
            />
          )}

          {/* Column mappings */}
          {config.usersTableId && tableColumns.length > 0 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Select
                  label={t('Колонка ID', 'ID column')}
                  value={config.userIdColumn || '__none__'}
                  onChange={(value) => onChange({
                    ...config,
                    userIdColumn: value === '__none__' ? '' : value
                  })}
                  options={[
                    { label: t('— ID —', '— ID —'), value: '__none__' },
                    ...tableColumns.map(col => ({
                      label: col.displayName || col.name,
                      value: col.name
                    }))
                  ]}
                />
                
                <Select
                  label={t('Колонка имени', 'Name column')}
                  value={config.userNameColumn || '__none__'}
                  onChange={(value) => onChange({
                    ...config,
                    userNameColumn: value === '__none__' ? '' : value
                  })}
                  options={[
                    { label: t('— Имя —', '— Name —'), value: '__none__' },
                    ...tableColumns.map(col => ({
                      label: col.displayName || col.name,
                      value: col.name
                    }))
                  ]}
                />
              </div>

              {/* Role column and mapping */}
              <div className="space-y-3 p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-secondary)]">
                <h5 className="text-sm font-medium text-[var(--text-secondary)]">{t('Настройка ролей', 'Role configuration')}</h5>

                <Select
                  label={t('Колонка с ролью', 'Role column')}
                  value={config.roleColumn || '__none__'}
                  onChange={(value) => onChange({
                    ...config,
                    roleColumn: value === '__none__' ? '' : value,
                    roleMapping: { owner: [], admin: [], editor: [], viewer: [], denied: [] }
                  })}
                  options={[
                    { label: t('— Выберите колонку роли —', '— Select a role column —'), value: '__none__' },
                    ...tableColumns.map(col => ({
                      label: `${col.displayName || col.name} (${col.type})`,
                      value: col.name
                    }))
                  ]}
                />

                {config.roleColumn && roleColumnOptions.length > 0 && (
                  <div className="space-y-2">
                    {[
                      { key: 'owner', label: 'Owner', required: true },
                      { key: 'admin', label: 'Admin', required: false },
                      { key: 'editor', label: 'Editor', required: false },
                      { key: 'viewer', label: 'Viewer', required: false },
                      { key: 'denied', label: 'Denied', required: false }
                    ].map(role => {
                      const values = config.roleMapping[role.key as keyof typeof config.roleMapping] || [];
                      
                      return (
                        <div key={role.key} className="flex items-center gap-3">
                          <span className={`w-16 text-sm ${role.required ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                            {role.label}{role.required && ' *'}
                          </span>
                          <div className="flex-1">
                            <MultiSelect
                              value={values}
                              onChange={(newValues) => onChange({
                                ...config,
                                roleMapping: {
                                  ...config.roleMapping,
                                  [role.key]: newValues
                                }
                              })}
                              options={roleColumnOptions}
                              placeholder={t('— выберите значения —', '— select values —')}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {config.roleColumn && roleColumnOptions.length === 0 && (
                  <div className="text-xs text-[var(--text-tertiary)] p-2 bg-yellow-500/10 rounded border border-yellow-500/30">
                    {t('⚠️ Нет данных в колонке роли', '⚠️ No data in the role column')}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};
