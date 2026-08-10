/**
 * AccessControlInline - Compact inline access control for tree items
 */

import { logger } from '@/shared/utils/logger';
import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, Users, Key, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { Select, Switch, MultiSelect } from '@/shared/components/ui';
import { useProjectsQuery } from '@/features/projects/hooks/useProjectsQuery';
import { useProjectTables } from '@/features/projects/hooks/useProjectTables';
import { useTableColumns } from '@/features/tables/hooks/useTableColumns';
import { useTableRows } from '@/features/tables/hooks/useTableRows';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { apiClient } from '@/shared/utils/apiClient';

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

interface AccessControlInlineProps {
  itemType: 'table' | 'folder' | 'project' | 'widget';
  itemId: number;
  onUpdate?: () => void;
}

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

export const AccessControlInline = ({ itemType, itemId, onUpdate }: AccessControlInlineProps) => {
  const queryClient = useQueryClient();
  const [isExpanded, setIsExpanded] = useState(false);
  const [accessControl, setAccessControl] = useState<AccessControlConfig>(DEFAULT_ACCESS_CONTROL);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch current access control
  const { data: itemData, isLoading } = useQuery({
    queryKey: ['item-access-control', itemType, itemId],
    queryFn: async () => {
      if (itemType === 'table') {
        const response = await apiClient.request<{ data: { access_control?: string | null } }>(
          `/tables/${itemId}`
        );
        let parsed = null;
        if (response.data.access_control) {
          try {
            parsed = typeof response.data.access_control === 'string'
              ? JSON.parse(response.data.access_control)
              : response.data.access_control;
          } catch (e) {
            logger.error('Failed to parse access_control:', e);
          }
        }
        return { access_control: parsed };
      }
      if (itemType === 'project') {
        const response = await apiClient.request<{ data: { access_control?: string | null } }>(
          `/projects/${itemId}`
        );
        let parsed = null;
        if (response.data.access_control) {
          try {
            parsed = typeof response.data.access_control === 'string'
              ? JSON.parse(response.data.access_control)
              : response.data.access_control;
          } catch (e) {
            logger.error('Failed to parse access_control:', e);
          }
        }
        return { access_control: parsed };
      }
      // For folders, widgets - can add similar fetches
      return { access_control: null };
    },
    enabled: isExpanded,
    staleTime: 30000
  });

  // Initialize from fetched data
  useEffect(() => {
    if (itemData?.access_control) {
      setAccessControl(itemData.access_control);
    }
  }, [itemData]);

  // Queries for access control dropdowns
  const { data: allProjects = [] } = useProjectsQuery();
  const { data: projectTables = [] } = useProjectTables(selectedProjectId);
  const { data: tableColumns = [] } = useTableColumns(accessControl.usersTableId?.toString());
  const { data: tableRows = [] } = useTableRows(accessControl.usersTableId?.toString());

  // Get options for role column
  const roleColumnOptions = useMemo(() => {
    if (!accessControl.roleColumn) return [];
    
    const roleColumn = tableColumns.find(col => col.name === accessControl.roleColumn);
    if (!roleColumn) return [];
    
    if (roleColumn.type === 'select' && roleColumn.config?.options) {
      const opts = roleColumn.config.options;
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
    
    const uniqueValues = new Set<string>();
    tableRows.forEach(row => {
      const value = row.data?.[accessControl.roleColumn];
      if (value && typeof value === 'string' && value.trim()) {
        uniqueValues.add(value.trim());
      }
    });
    
    return Array.from(uniqueValues).sort().map(v => ({ value: v, label: v }));
  }, [tableColumns, tableRows, accessControl.roleColumn]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (itemType === 'table') {
        return tablesApi.updateTable(String(itemId), {
          access_control: accessControl
        });
      }
      if (itemType === 'project') {
        return apiClient.request(`/projects/${itemId}`, {
          method: 'PUT',
          body: JSON.stringify({ access_control: accessControl })
        });
      }
      // Add folder/widget update endpoints as needed
      throw new Error(`Update not implemented for ${itemType}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['item-access-control', itemType, itemId] });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['space-tree'] });
      setHasChanges(false);
      onUpdate?.();
    }
  });

  const handleChange = (updates: Partial<AccessControlConfig>) => {
    setAccessControl(prev => ({ ...prev, ...updates }));
    setHasChanges(true);
  };

  // Only show for tables and projects
  if (itemType !== 'table' && itemType !== 'project') {
    return null;
  }

  return (
    <div className="border border-[var(--border-secondary)] rounded-lg overflow-hidden bg-[var(--bg-tertiary)]">
      {/* Header */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsExpanded(!isExpanded);
        }}
        className="w-full flex items-center gap-2 p-2 hover:bg-[var(--bg-secondary)] transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
        )}
        <Shield className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
        <span className="text-xs font-medium text-[var(--text-secondary)]">Access Control</span>
        {accessControl.enabled && (
          <span className="text-[10px] px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded">ON</span>
        )}
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="p-2 space-y-2 border-t border-[var(--border-secondary)]">
          {isLoading ? (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />
            </div>
          ) : (
            <>
              {/* Enable toggle */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-secondary)]">Enable</span>
                <Switch
                  checked={accessControl.enabled}
                  onCheckedChange={(checked) => handleChange({ enabled: checked })}
                />
              </div>

              {accessControl.enabled && (
                <>
                  {/* Users Table Selection */}
                  <div className="space-y-1.5 p-2 bg-[var(--bg-secondary)] rounded">
                    <div className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]">
                      <Users className="w-3 h-3" />
                      Users Table
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <select
                        value={selectedProjectId?.toString() || '__none__'}
                        onChange={(e) => {
                          const newProjectId = e.target.value === '__none__' ? null : parseInt(e.target.value);
                          setSelectedProjectId(newProjectId);
                          handleChange({
                            usersTableId: null,
                            userIdColumn: '',
                            userNameColumn: '',
                            roleColumn: '',
                            roleMapping: { owner: [], admin: [], editor: [], viewer: [], denied: [] }
                          });
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded px-1.5 py-1"
                      >
                        <option value="__none__">— Project —</option>
                        {allProjects.map(p => (
                          <option key={p.id} value={p.id.toString()}>{p.name}</option>
                        ))}
                      </select>
                      <select
                        value={accessControl.usersTableId?.toString() || '__none__'}
                        onChange={(e) => {
                          const usersTableId = e.target.value === '__none__' ? null : parseInt(e.target.value);
                          handleChange({
                            usersTableId,
                            userIdColumn: '',
                            userNameColumn: '',
                            roleColumn: '',
                            roleMapping: { owner: [], admin: [], editor: [], viewer: [], denied: [] }
                          });
                        }}
                        onClick={(e) => e.stopPropagation()}
                        disabled={!selectedProjectId}
                        className="text-xs bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded px-1.5 py-1 disabled:opacity-50"
                      >
                        <option value="__none__">— Table —</option>
                        {projectTables.map(t => (
                          <option key={t.id} value={t.id.toString()}>{t.displayName || t.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Column Mapping */}
                  {accessControl.usersTableId && tableColumns.length > 0 && (
                    <div className="space-y-1.5 p-2 bg-[var(--bg-secondary)] rounded">
                      <div className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]">
                        <Key className="w-3 h-3" />
                        Column Mapping
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <select
                          value={accessControl.userIdColumn || '__none__'}
                          onChange={(e) => handleChange({
                            userIdColumn: e.target.value === '__none__' ? '' : e.target.value
                          })}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded px-1 py-1"
                        >
                          <option value="__none__">— ID —</option>
                          {tableColumns.map(col => (
                            <option key={col.name} value={col.name}>{col.displayName || col.name}</option>
                          ))}
                        </select>
                        <select
                          value={accessControl.userNameColumn || '__none__'}
                          onChange={(e) => handleChange({
                            userNameColumn: e.target.value === '__none__' ? '' : e.target.value
                          })}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded px-1 py-1"
                        >
                          <option value="__none__">— Name —</option>
                          {tableColumns.map(col => (
                            <option key={col.name} value={col.name}>{col.displayName || col.name}</option>
                          ))}
                        </select>
                        <select
                          value={accessControl.roleColumn || '__none__'}
                          onChange={(e) => handleChange({
                            roleColumn: e.target.value === '__none__' ? '' : e.target.value,
                            roleMapping: { owner: [], admin: [], editor: [], viewer: [], denied: [] }
                          })}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded px-1 py-1"
                        >
                          <option value="__none__">— Role —</option>
                          {tableColumns.map(col => (
                            <option key={col.name} value={col.name}>{col.displayName || col.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Role Mapping */}
                  {accessControl.roleColumn && roleColumnOptions.length > 0 && (
                    <div className="space-y-1.5 p-2 bg-[var(--bg-secondary)] rounded">
                      <div className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]">
                        <Shield className="w-3 h-3" />
                        Role Mapping
                      </div>
                      {[
                        { key: 'owner', label: 'Owner', color: 'text-yellow-400' },
                        { key: 'admin', label: 'Admin', color: 'text-red-400' },
                        { key: 'editor', label: 'Editor', color: 'text-primary-400' },
                        { key: 'viewer', label: 'Viewer', color: 'text-green-400' },
                      ].map(role => {
                        const values = accessControl.roleMapping[role.key as keyof typeof accessControl.roleMapping] || [];
                        return (
                          <div key={role.key} className="flex items-center gap-2">
                            <span className={`w-12 text-[10px] ${role.color}`}>{role.label}</span>
                            <div className="flex-1">
                              <MultiSelect
                                value={values}
                                onChange={(newValues) => handleChange({
                                  roleMapping: {
                                    ...accessControl.roleMapping,
                                    [role.key]: newValues
                                  }
                                })}
                                options={roleColumnOptions}
                                placeholder="—"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* Save button */}
              {hasChanges && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    saveMutation.mutate();
                  }}
                  disabled={saveMutation.isPending}
                  className="w-full py-1.5 text-xs font-medium bg-[var(--accent-primary)] text-white rounded hover:bg-[var(--accent-primary)]/80 disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  {saveMutation.isPending ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Access Control'
                  )}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default AccessControlInline;
