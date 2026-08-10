/**
 * AccessTab - Access Control Configuration for Space
 * Allows setting up role-based access control
 */

import { useState, useMemo, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Select, Switch, MultiSelect } from '@/shared/components/ui';
import { useProjectsQuery } from '@/features/projects/hooks/useProjectsQuery';
import { useProjectTables } from '@/features/projects/hooks/useProjectTables';
import { useTableColumns } from '@/features/tables/hooks/useTableColumns';
import { useTableRows } from '@/features/tables/hooks/useTableRows';
import { spacesApi } from '@/features/spaces/api/spacesApi';
import { useSpacesQuery } from '@/features/spaces/hooks/useSpacesQuery';
import type { AccessControlConfig } from '@/features/spaces/types/space.types';
import { Loader2, Shield, Users, Key, Info } from 'lucide-react';

interface AccessTabProps {
  spaceId: number;
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

export const AccessTab = ({ spaceId }: AccessTabProps) => {
  const queryClient = useQueryClient();
  const { data: spaces = [] } = useSpacesQuery();
  const space = spaces.find(s => s.id === spaceId);
  
  const [accessControl, setAccessControl] = useState<AccessControlConfig>(
    space?.access_control || DEFAULT_ACCESS_CONTROL
  );
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

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

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!space) throw new Error('Space not found');
      return spacesApi.update(spaceId, {
        name: space.name,
        description: space.description,
        icon: space.icon,
        access_control: accessControl
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
      setHasChanges(false);
    }
  });

  // Reset when space changes
  useEffect(() => {
    if (space) {
      setAccessControl(space.access_control || DEFAULT_ACCESS_CONTROL);
      setHasChanges(false);
    }
  }, [space?.id]);

  // Track changes
  useEffect(() => {
    if (space) {
      const original = JSON.stringify(space.access_control || DEFAULT_ACCESS_CONTROL);
      const current = JSON.stringify(accessControl);
      setHasChanges(original !== current);
    }
  }, [accessControl, space?.access_control]);

  if (!space) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--accent-primary)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
        <div className="p-2 rounded-lg bg-[var(--accent-primary)]/10">
          <Shield className="w-5 h-5 text-[var(--accent-primary)]" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">Access Control</h3>
          <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
            Configure role-based permissions for this space
          </p>
        </div>
        <Switch
          checked={accessControl.enabled}
          onCheckedChange={(checked) => setAccessControl({ ...accessControl, enabled: checked })}
        />
      </div>

      {accessControl.enabled && (
        <div className="space-y-4">
          {/* Project selector */}
          <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-[var(--text-secondary)]" />
              <span className="text-sm font-medium text-[var(--text-primary)]">Users Table</span>
            </div>
            
            <div className="space-y-3">
              <Select
                label="Project with users table"
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
                  { label: '— Select project —', value: '__none__' },
                  ...allProjects.map(p => ({ label: p.name, value: p.id.toString() }))
                ]}
              />

              {selectedProjectId && (
                <Select
                  label="Users table"
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
                    { label: '— Select table —', value: '__none__' },
                    ...projectTables.map(t => ({
                      label: t.displayName || t.name,
                      value: t.id.toString()
                    }))
                  ]}
                />
              )}
            </div>
          </div>

          {/* Column mappings */}
          {accessControl.usersTableId && tableColumns.length > 0 && (
            <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <div className="flex items-center gap-2 mb-3">
                <Key className="w-4 h-4 text-[var(--text-secondary)]" />
                <span className="text-sm font-medium text-[var(--text-primary)]">Column Mapping</span>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <Select
                  label="ID Column"
                  value={accessControl.userIdColumn || '__none__'}
                  onChange={(value) => setAccessControl({
                    ...accessControl,
                    userIdColumn: value === '__none__' ? '' : value
                  })}
                  options={[
                    { label: '— Select —', value: '__none__' },
                    ...tableColumns.map(col => ({
                      label: col.displayName || col.name,
                      value: col.name
                    }))
                  ]}
                />
                
                <Select
                  label="Name Column"
                  value={accessControl.userNameColumn || '__none__'}
                  onChange={(value) => setAccessControl({
                    ...accessControl,
                    userNameColumn: value === '__none__' ? '' : value
                  })}
                  options={[
                    { label: '— Select —', value: '__none__' },
                    ...tableColumns.map(col => ({
                      label: col.displayName || col.name,
                      value: col.name
                    }))
                  ]}
                />
              </div>
            </div>
          )}

          {/* Role mapping */}
          {accessControl.usersTableId && tableColumns.length > 0 && (
            <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-4 h-4 text-[var(--text-secondary)]" />
                <span className="text-sm font-medium text-[var(--text-primary)]">Role Configuration</span>
              </div>
              
              <div className="space-y-3">
                <Select
                  label="Role Column"
                  value={accessControl.roleColumn || '__none__'}
                  onChange={(value) => setAccessControl({
                    ...accessControl,
                    roleColumn: value === '__none__' ? '' : value,
                    roleMapping: { owner: [], admin: [], editor: [], viewer: [], denied: [] }
                  })}
                  options={[
                    { label: '— Select role column —', value: '__none__' },
                    ...tableColumns.map(col => ({
                      label: `${col.displayName || col.name} (${col.type})`,
                      value: col.name
                    }))
                  ]}
                />

                {accessControl.roleColumn && roleColumnOptions.length > 0 && (
                  <div className="space-y-2 p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-secondary)]">
                    {[
                      { key: 'owner', label: 'Owner', color: 'text-yellow-400', required: true },
                      { key: 'admin', label: 'Admin', color: 'text-red-400', required: false },
                      { key: 'editor', label: 'Editor', color: 'text-primary-400', required: false },
                      { key: 'viewer', label: 'Viewer', color: 'text-green-400', required: false },
                      { key: 'denied', label: 'Denied', color: 'text-gray-400', required: false }
                    ].map(role => {
                      const values = accessControl.roleMapping[role.key as keyof typeof accessControl.roleMapping] || [];
                      
                      return (
                        <div key={role.key} className="flex items-center gap-3">
                          <span className={`w-20 text-sm ${role.color} ${role.required ? 'font-medium' : ''}`}>
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
                              placeholder="— select values —"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {accessControl.roleColumn && roleColumnOptions.length === 0 && (
                  <div className="text-xs text-yellow-400 p-2 bg-yellow-500/10 rounded border border-yellow-500/30">
                    ⚠️ No values found in role column
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Info */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-primary-500/10 border border-primary-500/30">
            <Info className="w-4 h-4 text-primary-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-primary-400">
              <strong>Space Owner:</strong> The space creator always has full control and cannot be restricted by other roles.
            </p>
          </div>
        </div>
      )}

      {/* Save button */}
      {hasChanges && (
        <div className="flex justify-end pt-4 border-t border-[var(--border-primary)]">
          <button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary)]/90 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {updateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Save Changes
          </button>
        </div>
      )}
    </div>
  );
};
