import { useState, useEffect } from 'react';
import { logger } from '@/shared/utils/logger';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { apiKeysApi } from '../api/apiKeysApi';
import { useLanguage } from '@/shared/i18n/LanguageContext';

// Local types for API responses
interface ProjectInfo {
  id: number;
  name: string;
  space_id: number;
}

interface SpaceInfo {
  id: number;
  name: string;
}

interface TableInfo {
  id: number;
  name: string;
  display_name?: string;
}

interface TableRowData {
  id: number;
  data?: Record<string, unknown>;
  name?: string;
  icon?: string;
}

interface AgentInfo {
  id: number;
  name: string;
  icon: string;
}

const AVAILABLE_SCOPES = [
  { value: '*', label: { ru: 'Полный доступ', en: 'Full access' } },
  { value: 'tables:read', label: { ru: 'Чтение таблиц', en: 'Read tables' } },
  { value: 'tables:write', label: { ru: 'Запись таблиц', en: 'Write tables' } },
  { value: 'rows:read', label: { ru: 'Чтение записей', en: 'Read rows' } },
  { value: 'rows:write', label: { ru: 'Запись записей', en: 'Write rows' } },
  { value: 'widgets:read', label: { ru: 'Чтение виджетов', en: 'Read widgets' } },
  { value: 'widgets:write', label: { ru: 'Запись виджетов', en: 'Write widgets' } },
];

interface CreateApiKeyModalProps {
  open: boolean;
  onClose: () => void;
  projectId?: number;
  onSuccess?: (data: { key: string; id: number }) => void;
}

export function CreateApiKeyModal({ 
  open,
  onClose, 
  projectId,
  onSuccess
}: CreateApiKeyModalProps) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const t = (ru: string, en: string) => language === 'ru' ? ru : en;
  
  const [name, setName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['*']);
  const [expiresIn, setExpiresIn] = useState<string>('never');
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setName('');
      setSelectedScopes(['*']);
      setExpiresIn('never');
      setSelectedAgentId(null);
      setSelectedTableId(null);
    }
  }, [open]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof apiKeysApi.create>[0]) => 
      apiKeysApi.create({ ...data, project_id: projectId }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      queryClient.invalidateQueries({ queryKey: ['api-keys', projectId] });
      onSuccess?.(data);
      onClose();
    }
  });

  // Load all projects
  const { data: projects = [] } = useQuery<ProjectInfo[]>({
    queryKey: ['all-projects-for-agents'],
    queryFn: async () => {
      const response = await apiClient.get<{ data: ProjectInfo[] }>('/projects');
      return response.data || [];
    },
    enabled: open
  });

  // Load spaces for project names
  const { data: spaces = [] } = useQuery<SpaceInfo[]>({
    queryKey: ['all-spaces-for-agents'],
    queryFn: async () => {
      const response = await apiClient.get<{ data: SpaceInfo[] }>('/spaces');
      return response.data || [];
    },
    enabled: open
  });

  // Find System Data project and set as default
  useEffect(() => {
    if (projects.length > 0 && selectedProjectId === null && open) {
      const currentProject = projects.find((p) => p.id === projectId);
      const currentSpaceId = currentProject?.space_id;
      
      const systemDataProject = projects.find((p) => 
        p.name === 'System Data' && p.space_id === currentSpaceId
      ) || projects.find((p) => p.name === 'System Data');
      
      if (systemDataProject) {
        setSelectedProjectId(systemDataProject.id);
      }
    }
  }, [projects, selectedProjectId, projectId, open]);

  // Load tables for selected project
  const { data: tables = [] } = useQuery<TableInfo[]>({
    queryKey: ['project-tables-for-agents', selectedProjectId],
    queryFn: async () => {
      if (!selectedProjectId) return [];
      const response = await apiClient.get<{ data: TableInfo[] }>(`/tables?project_id=${selectedProjectId}`);
      return response.data || [];
    },
    enabled: !!selectedProjectId && open
  });

  // Auto-select AI Agents table when tables load
  useEffect(() => {
    if (tables.length > 0 && selectedTableId === null && open) {
      const aiAgentsTable = tables.find((t) => 
        t.name === 'AI Agents' || t.display_name === 'AI Agents'
      );
      if (aiAgentsTable) {
        setSelectedTableId(aiAgentsTable.id);
      }
    }
  }, [tables, selectedTableId, open]);

  // Load agents from selected table
  const { data: agents = [] } = useQuery<AgentInfo[]>({
    queryKey: ['agents-from-table', selectedTableId],
    queryFn: async () => {
      if (!selectedTableId) return [];
      try {
        const response = await apiClient.get<{ success: boolean; data: { rows: TableRowData[] } }>(`/tables/${selectedTableId}/rows`);
        if (!response.success) return [];
        
        const rows = response.data?.rows || [];
        return rows.map((row): AgentInfo => {
          const data = row.data || row;
          return {
            id: row.id,
            name: (data.name as string) || 'Unnamed Agent',
            icon: (data.icon as string) || '🤖'
          };
        });
      } catch (err) {
        logger.error('[CreateApiKeyModal] Error loading agents:', err);
        return [];
      }
    },
    enabled: !!selectedTableId && open
  });

  // Create space lookup
  const spaceMap = new Map(spaces.map((s) => [s.id, s]));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name,
      scopes: selectedScopes,
      expires_in_days: expiresIn === 'never' ? undefined : parseInt(expiresIn),
      agent_id: selectedAgentId || undefined
    });
  };

  const toggleScope = (scope: string) => {
    if (scope === '*') {
      setSelectedScopes(['*']);
    } else {
      setSelectedScopes(prev => {
        const filtered = prev.filter(s => s !== '*');
        if (filtered.includes(scope)) {
          return filtered.filter(s => s !== scope);
        }
        return [...filtered, scope];
      });
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div 
        className="w-full max-w-md bg-[var(--bg-primary)] rounded-xl shadow-xl border border-[var(--border-primary)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-primary)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {t('Новый API ключ', 'New API Key')}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
              {t('Название', 'Name')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('Например: Интеграция с n8n', 'e.g., n8n Integration')}
              className="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
              required
              autoFocus
            />
          </div>

          {/* Scopes */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
              {t('Права доступа', 'Permissions')}
            </label>
            <div className="space-y-1 p-3 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)] max-h-48 overflow-y-auto">
              {AVAILABLE_SCOPES.map((scope) => (
                <label 
                  key={scope.value}
                  className="flex items-center gap-3 cursor-pointer p-2 rounded hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(scope.value)}
                    onChange={() => toggleScope(scope.value)}
                    className="w-4 h-4 rounded border-[var(--border-primary)] text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm text-[var(--text-primary)] flex-1">
                    {scope.label[language as 'ru' | 'en']}
                  </span>
                  <code className="text-xs text-[var(--text-tertiary)] font-mono">{scope.value}</code>
                </label>
              ))}
            </div>
          </div>

          {/* Expiration */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
              {t('Срок действия', 'Expiration')}
            </label>
            <select
              value={expiresIn}
              onChange={(e) => setExpiresIn(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-[var(--text-primary)]"
            >
              <option value="never">{t('Без срока действия', 'Never expires')}</option>
              <option value="7">{t('7 дней', '7 days')}</option>
              <option value="30">{t('30 дней', '30 days')}</option>
              <option value="90">{t('90 дней', '90 days')}</option>
              <option value="365">{t('1 год', '1 year')}</option>
            </select>
          </div>

          {/* Assign to Agent (Optional) */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-[var(--text-secondary)]">
              {t('Привязать к агенту', 'Assign to Agent')}
              <span className="text-[var(--text-tertiary)] ml-1">({t('опционально', 'optional')})</span>
            </label>
            
            {/* Project selector */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[var(--text-tertiary)] mb-1">
                  {t('Проект', 'Project')}
                </label>
                <select
                  value={selectedProjectId || ''}
                  onChange={(e) => {
                    setSelectedProjectId(e.target.value ? parseInt(e.target.value) : null);
                    setSelectedTableId(null);
                    setSelectedAgentId(null);
                  }}
                  className="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-[var(--text-primary)] text-sm"
                >
                  <option value="">{t('Выберите проект', 'Select project')}</option>
                  {projects.map((proj: { id: number; name: string; space_id: number }) => (
                    <option key={proj.id} value={proj.id}>
                      {spaceMap.get(proj.space_id)?.name ? `${spaceMap.get(proj.space_id)?.name} / ` : ''}{proj.name}
                    </option>
                  ))}
                </select>
              </div>
              
              {/* Table selector */}
              <div>
                <label className="block text-xs text-[var(--text-tertiary)] mb-1">
                  {t('Таблица', 'Table')}
                </label>
                <select
                  value={selectedTableId || ''}
                  onChange={(e) => {
                    setSelectedTableId(e.target.value ? parseInt(e.target.value) : null);
                    setSelectedAgentId(null);
                  }}
                  disabled={!selectedProjectId}
                  className="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-[var(--text-primary)] text-sm disabled:opacity-50"
                >
                  <option value="">{t('Выберите таблицу', 'Select table')}</option>
                  {tables.map((tbl: { id: number; name: string; icon?: string }) => (
                    <option key={tbl.id} value={tbl.id}>
                      {tbl.icon || '📋'} {tbl.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            
            {/* Agent selector */}
            <div>
              <label className="block text-xs text-[var(--text-tertiary)] mb-1">
                {t('Агент', 'Agent')}
              </label>
              <select
                value={selectedAgentId || ''}
                onChange={(e) => setSelectedAgentId(e.target.value ? parseInt(e.target.value) : null)}
                disabled={!selectedTableId}
                className="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-[var(--text-primary)] disabled:opacity-50"
              >
                <option value="">{t('Не привязывать', 'Don\'t assign')}</option>
                {agents.map((agent: { id: number; name: string; icon?: string }) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.icon || '🤖'} {agent.name}
                  </option>
                ))}
              </select>
              {selectedTableId && agents.length === 0 && (
                <p className="text-xs text-[var(--text-tertiary)] mt-1">
                  {t('В выбранной таблице нет записей', 'No records in selected table')}
                </p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              {t('Отмена', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || !name.trim()}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {createMutation.isPending ? t('Создание...', 'Creating...') : t('Создать', 'Create')}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

export default CreateApiKeyModal;
