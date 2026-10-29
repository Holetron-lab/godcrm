/**
 * EditTableModal - Modal for editing table settings
 * Features: Display settings, Access control, Column editing with full settings
 */

import { logger } from '@/shared/utils/logger';
import { useId, useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/components/ui/Modal';
import { Input } from '@/shared/components/ui/Input';
import { Button, Switch } from '@/shared/components/ui';
import { tablesApi } from '../api/tablesApi';
import { apiClient } from '@/shared/utils/apiClient';
import { UserAccessPanel } from '@/shared/components/access/UserAccessPanel';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { EmojiPicker } from './UniversalTable/EmojiPicker';
import { TableMenuWidgetToggle } from './TableMenuWidgetToggle';
import { ColumnsEditingTab, type ColumnsEditingTabHandle } from './ColumnsEditingTab';
import { DataMaintenanceTab } from './DataMaintenanceTab';
import {
  ChevronDown, ChevronRight, AlertTriangle, Key,
  ShieldOff, MessageSquare, ArrowUpDown, Globe
} from 'lucide-react';
import type { UserAccessLevel, UserAccessPermissionWithUser } from '@/shared/types/user-access.types';

type TabId = 'display' | 'access' | 'personalization' | 'data';

interface EditTableModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleteClick?: () => void;
  tableId: number | string;
  projectId?: number | null;
  spaceId?: number | null;
  defaultTab?: TabId;
}

// 10 colors for tables (2 rows of 5)
const TABLE_COLORS = [
  null, '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4'
];

// Unified Color picker for table settings - input for hex + dropdown like EmojiPicker
const ColorPicker = ({ value, onChange, label }: { 
  value: string | null; 
  onChange: (color: string | null) => void; 
  label?: string;
}) => {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value || '');

  // Sync input with value
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
            backgroundImage: value ? undefined : 'linear-gradient(45deg, #666 25%, transparent 25%), linear-gradient(-45deg, #666 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #666 75%), linear-gradient(-45deg, transparent 75%, #666 75%)',
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
            {TABLE_COLORS.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { onChange(c); setInputValue(c || ''); setIsOpen(false); }}
                className={`h-6 w-6 rounded border transition-all ${
                  value === c ? 'border-white ring-1 ring-[var(--color-primary-500)]' : 'border-transparent hover:border-white/30'
                }`}
                style={{ 
                  backgroundColor: c || 'var(--bg-tertiary)',
                  backgroundImage: c ? undefined : 'linear-gradient(45deg, #666 25%, transparent 25%), linear-gradient(-45deg, #666 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #666 75%), linear-gradient(-45deg, transparent 75%, #666 75%)',
                  backgroundSize: c ? undefined : '4px 4px'
                }}
                title={c || t('tables.edit.noColor')}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const EditTableModal = ({ open, onOpenChange, onDeleteClick, tableId, projectId, spaceId, defaultTab = 'display' }: EditTableModalProps) => {
  const fieldId = useId();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { t } = useLanguage();

  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);
  
  // Reset to defaultTab when modal opens
  useEffect(() => {
    if (open) {
      setActiveTab(defaultTab);
    }
  }, [open, defaultTab]);
  const [displayName, setDisplayName] = useState('');
  const [icon, setIcon] = useState('📋');
  const [color, setColor] = useState<string | null>(null);
  const [showInNav, setShowInNav] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [comment, setComment] = useState('');
  const [userPermissions, setUserPermissions] = useState<UserAccessPermissionWithUser[]>([]);
  const [error, setError] = useState('');
  const [menuWidgetId, setMenuWidgetId] = useState<number | null>(null);
  const [menuToggleTouched, setMenuToggleTouched] = useState(false);
  const columnsTabRef = useRef<ColumnsEditingTabHandle>(null);
  
  // Row height settings
  const [minRowHeight, setMinRowHeight] = useState<number | ''>(40);
  const [maxRowHeight, setMaxRowHeight] = useState<number | ''>(200);
  const [fixedRowHeight, setFixedRowHeight] = useState<number | null>(null);
  
  // Key editing state
  const [keyEditEnabled, setKeyEditEnabled] = useState(false);
  const [tableKey, setTableKey] = useState('');

  // Fetch fresh table data when modal opens
  const { data: tableData, isLoading } = useQuery({
    queryKey: ['edit-table-modal', tableId, projectId],
    queryFn: async () => {
      if (projectId) {
        try {
          const response = await apiClient.request<{ data: Array<{ id: number; name: string; display_name?: string; icon?: string; color?: string; show_in_nav?: number; owner_id?: number; comment?: string; config?: string | { min_row_height?: number; max_row_height?: number; fixed_row_height?: number | null }; project_id?: number; is_public?: boolean }> }>(
            `/projects/${projectId}/tables`
          );
          const found = response.data.find(t => String(t.id) === String(tableId));
          if (found) {
            // Parse config from JSON string if needed
            const parsedConfig = typeof found.config === 'string'
              ? (() => { try { return JSON.parse(found.config); } catch { return {}; } })()
              : (found.config || {});
            return {
              id: found.id,
              name: found.name,
              displayName: found.display_name || found.name,
              icon: found.icon || null,
              color: found.color || null,
              show_in_nav: found.show_in_nav !== 0,
              owner_id: found.owner_id,
              comment: found.comment || '',
              min_row_height: parsedConfig.min_row_height || 40,
              max_row_height: parsedConfig.max_row_height || 200,
              fixed_row_height: parsedConfig.fixed_row_height ?? null,
              project_id: found.project_id || projectId,
              is_public: found.is_public !== false
            };
          }
        } catch (e) {
          logger.error('[EditTableModal] Project tables fetch failed:', e);
        }
      }

      // Direct table fetch
      const response = await apiClient.request<{ data: { id: number; name: string; display_name?: string; icon?: string; color?: string; show_in_nav?: number; owner_id?: number; comment?: string; config?: string | { min_row_height?: number; max_row_height?: number; fixed_row_height?: number | null }; project_id?: number; projectId?: number; is_public?: boolean } }>(
        `/tables/${tableId}`
      );
      // Parse config from JSON string if needed
      const parsedConfig = typeof response.data.config === 'string'
        ? (() => { try { return JSON.parse(response.data.config); } catch { return {}; } })()
        : (response.data.config || {});
      return {
        id: response.data.id,
        name: response.data.name,
        displayName: response.data.display_name || response.data.name,
        icon: response.data.icon || null,
        color: response.data.color || null,
        show_in_nav: response.data.show_in_nav !== 0,
        owner_id: response.data.owner_id,
        comment: response.data.comment || '',
        min_row_height: parsedConfig.min_row_height || 40,
        max_row_height: parsedConfig.max_row_height || 200,
        fixed_row_height: parsedConfig.fixed_row_height ?? null,
        project_id: response.data.project_id ?? response.data.projectId ?? null,
        is_public: response.data.is_public !== false
      };
    },
    enabled: open,
    staleTime: 0,
  });

  // Determine current user's access level
  const getCurrentUserLevel = (): UserAccessLevel => {
    if (user?.id === tableData?.owner_id) {
      return 'owner_owner';
    }
    return 'viewer';
  };

  const currentUserLevel = getCurrentUserLevel();

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async () => {
      // Column edits staged on the Editing tab are part of this Save too.
      await columnsTabRef.current?.savePendingEdits();
      return tablesApi.updateTable(String(tableId), {
        displayName: displayName.trim(),
        icon: icon,
        color: color,
        // Untouched toggle must not rewrite show_in_nav: with no menu widget it
        // defaults to false and would hide the table from the project nav.
        ...(menuToggleTouched ? { show_in_nav: showInNav } : {}),
        comment: comment,
        min_row_height: minRowHeight === '' ? 24 : minRowHeight,
        max_row_height: maxRowHeight === '' ? 1200 : maxRowHeight,
        fixed_row_height: fixedRowHeight,
        is_public: isPublic,
        ...(keyEditEnabled && tableKey !== tableData?.name ? { name: tableKey } : {})
      });
    },
    onSuccess: async () => {
      const resolvedProjectId = projectId ?? tableData?.project_id ?? null;

      if (resolvedProjectId) {
        try {
          if (showInNav) {
            if (menuWidgetId) {
              await apiClient.request(`/widgets/${menuWidgetId}`, {
                method: 'PATCH',
                body: JSON.stringify({
                  title: displayName.trim() || tableData?.displayName || tableData?.name || t('tables.create.tableDefault'),
                  icon: icon || '📋',
                  config: { table_id: Number(tableId) }
                })
              });
            } else {
              const dashboardResponse = await apiClient.request<{ data: { id: number } }>(
                `/projects/${resolvedProjectId}/dashboard`
              );
              await apiClient.request(`/dashboards/${dashboardResponse.data.id}/widgets`, {
                method: 'POST',
                body: JSON.stringify({
                  widget_type: 'preset',
                  preset_name: 'table_view',
                  title: displayName.trim() || tableData?.displayName || tableData?.name || t('tables.create.tableDefault'),
                  icon: icon || '📋',
                  config: { table_id: Number(tableId) },
                  position: { x: 0, y: 0, w: 12, h: 6 }
                })
              });
            }
          } else if (menuWidgetId) {
            await apiClient.request(`/widgets/${menuWidgetId}`, { method: 'DELETE' });
          }

          queryClient.invalidateQueries({ queryKey: ['project-widgets', resolvedProjectId] });
          queryClient.invalidateQueries({ queryKey: ['widgets'] });
        } catch (widgetError) {
          logger.error('Failed to sync menu widget:', widgetError);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['project-tables'] });
      // Invalidate all tables queries (including those with user/context parameters)
      queryClient.invalidateQueries({ queryKey: ['tables'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['table', tableId] });
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
      setIsPublic(tableData.is_public !== false);
      setComment(tableData.comment || '');
      setTableKey(tableData.name);
      setKeyEditEnabled(false);
      setMinRowHeight(tableData.min_row_height || 40);
      setMaxRowHeight(tableData.max_row_height || 200);
      setFixedRowHeight(tableData.fixed_row_height || null);
    }
    setError('');
    setActiveTab('display');
  }, [tableData, open]);

  useEffect(() => {
    if (open) {
      setMenuToggleTouched(false);
      setMenuWidgetId(null);
      setShowInNav(false);
    }
  }, [open, tableId]);

  useEffect(() => {
    const resolvedProjectId = projectId ?? tableData?.project_id ?? null;
    if (!open || !resolvedProjectId) return;
    let isActive = true;

    const loadMenuWidget = async () => {
      try {
        const response = await apiClient.request<{ data: Array<{ id: number; preset_name?: string; config?: { table_id?: number; tableId?: number } }> }>(
          `/projects/${resolvedProjectId}/widgets`
        );
        const widget = response.data.find((item) =>
          item.preset_name === 'table_view' &&
          String(item.config?.table_id ?? item.config?.tableId ?? '') === String(tableId)
        );
        if (isActive) {
          setMenuWidgetId(widget?.id ?? null);
          if (!menuToggleTouched) {
            setShowInNav(Boolean(widget));
          }
        }
      } catch (widgetError) {
        logger.error('Failed to load menu widget:', widgetError);
      }
    };

    loadMenuWidget();

    return () => {
      isActive = false;
    };
  }, [open, projectId, tableData?.project_id, tableId, menuToggleTouched]);

  const handleSubmit = () => {
    if (!displayName.trim()) {
      setError(t('tables.edit.nameRequired'));
      return;
    }
    updateMutation.mutate();
  };

  const handleDeleteClick = () => {
    onOpenChange(false);
    onDeleteClick?.();
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: 'display', label: t('tables.edit.tabDisplay') },
    { id: 'access', label: t('tables.edit.tabAccess') },
    { id: 'personalization', label: t('tables.edit.tabEditing') },
    { id: 'data', label: t('tables.edit.tabData') }
  ];

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('tables.edit.title', { name: tableData?.displayName || tableData?.name || '' })}
      size="xl"
      fixedHeight
      heightOffset={150}
    >
      <div className="flex flex-col h-full">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-primary-500)]"></div>
          </div>
        ) : (
          <>
            {error && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400 mb-4">
                {error}
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 p-1 bg-[var(--bg-secondary)] rounded-lg mb-4 flex-shrink-0">
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
                <div className="space-y-4 pr-2">
                  {/* Row 1: Icon + Name + Color */}
                  <div className="flex gap-3 items-end">
                    <EmojiPicker 
                      value={icon} 
                      onChange={setIcon}
                      label={t('tables.edit.icon')}
                      size="md"
                    />
                    <div className="flex-1">
                      <Input
                        label={t('tables.edit.tableName')}
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder={t('tables.edit.tableNamePlaceholder')}
                      />
                    </div>
                    <ColorPicker value={color} onChange={setColor} label={t('tables.edit.color')} />
                  </div>
                  
                  {/* Table Key with checkbox - moved up */}
                  <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
                    <div className="flex items-center gap-3 mb-3">
                      <Key className="w-4 h-4 text-[var(--text-tertiary)]" />
                      <span className="text-sm font-medium text-[var(--text-primary)]">{t('tables.edit.tableKey')}</span>
                      <div className="flex-1" />
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={keyEditEnabled}
                          onChange={(e) => setKeyEditEnabled(e.target.checked)}
                          className="w-4 h-4 rounded border-[var(--border-primary)] bg-[var(--bg-primary)] accent-[var(--color-primary-500)]"
                        />
                        <span className="text-xs text-[var(--text-secondary)]">{t('tables.edit.allowKeyEdit')}</span>
                      </label>
                    </div>
                    
                    <Input
                      value={tableKey}
                      onChange={(e) => setTableKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                      placeholder="table_key"
                      disabled={!keyEditEnabled}
                      className="font-mono"
                    />
                    
                    {keyEditEnabled && (
                      <div className="mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/30 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-400">
                          {t('tables.edit.keyEditWarning')}
                        </p>
                      </div>
                    )}
                  </div>
                  
                  {/* Comment - 4 rows */}
                  <div>
                    <label htmlFor={`${fieldId}-0`} className="flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)] mb-1">
                      <MessageSquare className="w-4 h-4" />
                      {t('tables.edit.comment')}
                    </label>
                    <textarea
                      id={`${fieldId}-0`}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder={t('tables.edit.commentPlaceholder')}
                      rows={4}
                      className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)] resize-none"
                    />
                  </div>
                  
                  {/* Row height settings */}
                  <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
                    <div className="flex items-center gap-2 mb-3">
                      <ArrowUpDown className="w-4 h-4 text-[var(--text-tertiary)]" />
                      <span className="text-sm font-medium text-[var(--text-primary)]">{t('tables.edit.rowHeight')}</span>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label htmlFor={`${fieldId}-1`} className="block text-xs text-[var(--text-secondary)] mb-1">{t('tables.edit.minHeight')}</label>
                        <input
                          id={`${fieldId}-1`}
                          type="number"
                          value={minRowHeight}
                          onChange={(e) => setMinRowHeight(e.target.value === '' ? '' : Number(e.target.value))}
                          onBlur={() => setMinRowHeight(prev => prev === '' || prev < 24 ? 24 : prev > 200 ? 200 : prev)}
                          min={24}
                          max={200}
                          placeholder="24"
                          className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
                        />
                      </div>
                      <div>
                        <label htmlFor={`${fieldId}-2`} className="block text-xs text-[var(--text-secondary)] mb-1">{t('tables.edit.maxHeight')}</label>
                        <input
                          id={`${fieldId}-2`}
                          type="number"
                          value={maxRowHeight}
                          onChange={(e) => setMaxRowHeight(e.target.value === '' ? '' : Number(e.target.value))}
                          onBlur={() => setMaxRowHeight(prev => prev === '' || prev < 40 ? 1200 : prev > 1200 ? 1200 : prev)}
                          min={40}
                          max={1200}
                          placeholder="1200"
                          className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
                        />
                      </div>
                      <div>
                        <label htmlFor={`${fieldId}-3`} className="block text-xs text-[var(--text-secondary)] mb-1">{t('tables.edit.fixedHeight')}</label>
                        <input
                          id={`${fieldId}-3`}
                          type="number"
                          value={fixedRowHeight ?? ''}
                          onChange={(e) => setFixedRowHeight(e.target.value === '' ? null : Number(e.target.value))}
                          onBlur={() => setFixedRowHeight(prev => prev !== null && prev < 24 ? 24 : prev !== null && prev > 1200 ? 1200 : prev)}
                          placeholder={t('tables.edit.auto')}
                          min={24}
                          max={1200}
                          className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-[var(--text-tertiary)] mt-2">
                      {t('tables.edit.rowHeightHint')}
                    </p>
                  </div>

                  {/* Show in navigation */}
                  <TableMenuWidgetToggle
                    checked={showInNav}
                    onCheckedChange={(checked) => {
                      setShowInNav(checked);
                      setMenuToggleTouched(true);
                    }}
                  />

                  {/* Public visibility (ADR-0060 opt-out) */}
                  <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-2">
                        <Globe className="w-4 h-4 mt-0.5 text-[var(--accent-primary)] flex-shrink-0" />
                        <div className="space-y-1">
                          <div className="text-sm font-medium text-[var(--text-primary)]">{t('tables.edit.publicVisible')}</div>
                          <p className="text-xs text-[var(--text-secondary)]">
                            {t('tables.edit.publicVisibleDesc')}
                          </p>
                        </div>
                      </div>
                      <Switch checked={isPublic} onCheckedChange={setIsPublic} />
                    </div>
                  </div>

                  {/* Table Info */}
                  {tableData && (
                    <div className="text-xs text-[var(--text-tertiary)] flex gap-4">
                      <span>ID: {tableData.id}</span>
                      <span>{t('tables.edit.sourceKey')} <code className="font-mono bg-[var(--bg-tertiary)] px-1 rounded">{tableData.name}</code></span>
                    </div>
                  )}
                </div>
              )}

              {/* Access Tab */}
              {activeTab === 'access' && tableData && (
                <div>
                  {!spaceId ? (
                    <div className="p-6 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
                      <div className="flex items-start gap-4">
                        <div className="p-3 rounded-lg bg-amber-500/10">
                          <ShieldOff className="w-6 h-6 text-amber-500" />
                        </div>
                        <div>
                          <h4 className="text-lg font-medium text-[var(--text-primary)] mb-2">
                            {t('tables.edit.accessUnavailable')}
                          </h4>
                          <p className="text-sm text-[var(--text-secondary)] mb-3">
                            {t('tables.edit.accessUnavailableDesc')}
                          </p>
                          <div className="text-xs text-[var(--text-tertiary)] space-y-1">
                            <p>{t('tables.edit.accessHintMove')}</p>
                            <p>{t('tables.edit.accessHintProject')}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <UserAccessPanel
                      entityType="table"
                      entityId={tableData.id}
                      spaceId={spaceId}
                      currentUserLevel={currentUserLevel}
                      ownerOwnerId={tableData.owner_id}
                      onPermissionsChange={setUserPermissions}
                    />
                  )}
                </div>
              )}
              {activeTab === 'access' && !tableData && (
                <div className="flex items-center justify-center h-[300px] text-[var(--text-tertiary)]">
                  <p>{t('tables.edit.loading')}</p>
                </div>
              )}

              {/* Editing Tab (was Personalization) — stays mounted while the
                  modal is open so staged column edits survive a tab switch. */}
              <div className={activeTab === 'personalization' ? undefined : 'hidden'}>
                <ColumnsEditingTab
                  ref={columnsTabRef}
                  tableId={tableId}
                  projectId={projectId}
                  isOpen={open && activeTab === 'personalization'}
                />
              </div>

              {/* Data Tab - Normalization and maintenance */}
              {activeTab === 'data' && (
                <DataMaintenanceTab tableId={tableId} />
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 pt-4 mt-4 border-t border-[var(--border-primary)] flex-shrink-0">
              {onDeleteClick && (
                <button 
                  type="button"
                  onClick={handleDeleteClick}
                  className="px-4 py-2 text-sm font-medium text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 hover:border-red-500/50 transition-colors"
                >
                  {t('tables.deleteTable')}
                </button>
              )}
              {!onDeleteClick && <div />}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] border border-[var(--border-primary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                  {t('tables.create.cancel')}
                </button>
                <Button
                  variant="primary"
                  onClick={handleSubmit}
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? t('tables.edit.saving') : t('tables.edit.save')}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default EditTableModal;
