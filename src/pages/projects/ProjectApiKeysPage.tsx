import { useState, useEffect, useMemo } from 'react';
import { logger } from '@/shared/utils/logger';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Key, Plus, Trash2, Copy, Check, Eye, EyeOff, 
  AlertTriangle, Clock, Activity, Shield, RefreshCw,
  ExternalLink, Zap, ChevronRight
} from 'lucide-react';
import { apiKeysApi, ApiKey, CreateApiKeyResponse } from '@/features/api-keys/api/apiKeysApi';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';

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

export function ProjectApiKeysPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { language } = useLanguage();
  const t = (ru: string, en: string) => language === 'ru' ? ru : en;
  
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState<CreateApiKeyResponse | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const numericProjectId = projectId ? parseInt(projectId, 10) : undefined;

  // Check if we should open create modal from URL
  useEffect(() => {
    if (searchParams.get('create') === 'true') {
      setShowCreateModal(true);
      setSearchParams({});
    }
  }, [searchParams, setSearchParams]);

  const { data: apiKeys = [], isLoading } = useQuery({
    queryKey: ['api-keys', numericProjectId],
    queryFn: () => apiKeysApi.list(numericProjectId)
  });

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof apiKeysApi.create>[0]) => 
      apiKeysApi.create({ ...data, project_id: numericProjectId }),
    onSuccess: (data) => {
      setNewKeyResult(data);
      setShowCreateModal(false);
      queryClient.invalidateQueries({ queryKey: ['api-keys', numericProjectId] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, projectId }: { id: number; projectId?: number }) => apiKeysApi.delete(id, projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys', numericProjectId] });
    }
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) => 
      apiKeysApi.update(id, { is_active: is_active ? 1 : 0 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys', numericProjectId] });
    }
  });

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString(language === 'ru' ? 'ru-RU' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Stats
  const activeCount = apiKeys.filter(k => k.is_active).length;
  const totalRequests = apiKeys.reduce((sum, k) => sum + k.request_count, 0);

  // Filtered keys
  const filteredKeys = useMemo(() => {
    if (filter === 'all') return apiKeys;
    if (filter === 'active') return apiKeys.filter(k => k.is_active);
    return apiKeys.filter(k => !k.is_active);
  }, [apiKeys, filter]);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-3">
            <Key className="w-7 h-7 text-amber-500" />
            {t('API Ключи', 'API Keys')}
          </h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            {t('Ключи для доступа к API проекта', 'Keys for project API access')}
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('Новый ключ', 'New Key')}
        </button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-4">
          <div className="text-2xl font-bold text-[var(--text-primary)]">{apiKeys.length}</div>
          <div className="text-sm text-[var(--text-tertiary)]">{t('Всего ключей', 'Total Keys')}</div>
        </div>
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-4">
          <div className="text-2xl font-bold text-emerald-500">{activeCount}</div>
          <div className="text-sm text-[var(--text-tertiary)]">{t('Активных', 'Active')}</div>
        </div>
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-4">
          <div className="text-2xl font-bold text-[var(--text-primary)]">{totalRequests.toLocaleString()}</div>
          <div className="text-sm text-[var(--text-tertiary)]">{t('Запросов', 'Requests')}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
            filter === 'all' 
              ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]' 
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
          }`}
        >
          {t('Все', 'All')}
        </button>
        <button
          onClick={() => setFilter('active')}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
            filter === 'active' 
              ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' 
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
          }`}
        >
          {t('Активные', 'Active')}
        </button>
        <button
          onClick={() => setFilter('inactive')}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
            filter === 'inactive' 
              ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]' 
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
          }`}
        >
          {t('Отключённые', 'Disabled')}
        </button>
      </div>

      {/* New Key Alert */}
      {newKeyResult && (
        <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-medium text-[var(--text-primary)]">
                {t('⚠️ Сохраните ваш API ключ!', '⚠️ Save your API key!')}
              </h4>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                {t(
                  'Этот ключ больше не будет показан. Скопируйте его сейчас.',
                  'This key will not be shown again. Copy it now.'
                )}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-[var(--bg-primary)] rounded-lg text-sm font-mono text-emerald-400 break-all">
                  {newKeyResult.key}
                </code>
                <button
                  onClick={() => copyToClipboard(newKeyResult.key, 'new-key')}
                  className="p-2 rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                  {copiedId === 'new-key' ? (
                    <Check className="w-5 h-5 text-emerald-500" />
                  ) : (
                    <Copy className="w-5 h-5 text-[var(--text-secondary)]" />
                  )}
                </button>
              </div>
              <button
                onClick={() => setNewKeyResult(null)}
                className="mt-3 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline"
              >
                {t('Понятно, я сохранил ключ', 'Got it, I saved the key')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keys List */}
      {isLoading ? (
        <div className="text-center py-12 text-[var(--text-secondary)]">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
          {t('Загрузка...', 'Loading...')}
        </div>
      ) : filteredKeys.length === 0 ? (
        <div className="text-center py-12 bg-[var(--bg-secondary)] border border-dashed border-[var(--border-primary)] rounded-lg">
          <Key className="w-12 h-12 text-[var(--text-tertiary)] mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-medium text-[var(--text-secondary)] mb-2">
            {apiKeys.length === 0 ? t('Нет API ключей', 'No API Keys Yet') : t('Нет совпадений', 'No Matching Keys')}
          </h3>
          <p className="text-sm text-[var(--text-tertiary)] mb-4">
            {apiKeys.length === 0 
              ? t('Создайте первый ключ для интеграции с внешними сервисами', 'Create your first key to integrate with external services')
              : t('Попробуйте изменить фильтр', 'Try changing the filter')}
          </p>
          {apiKeys.length === 0 && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t('Создать ключ', 'Create Key')}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredKeys.map((key) => (
            <ApiKeyCard
              key={key.id}
              apiKey={key}
              onDelete={() => {
                if (confirm(t('Удалить этот API ключ?', 'Delete this API key?'))) {
                  deleteMutation.mutate({ id: key.id, projectId: numericProjectId });
                }
              }}
              onToggle={() => toggleMutation.mutate({ id: key.id, is_active: !key.is_active })}
              language={language}
            />
          ))}
        </div>
      )}

      {/* Info Block */}
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
        <h4 className="font-medium text-amber-600 dark:text-amber-400 flex items-center gap-2 mb-2">
          <ExternalLink className="w-4 h-4" />
          {t('Как использовать API ключи', 'How to use API keys')}
        </h4>
        <ul className="text-sm text-[var(--text-secondary)] space-y-1 list-disc list-inside">
          <li>{t('Используйте ключ в заголовке Authorization: Bearer YOUR_KEY', 'Use the key in Authorization header: Bearer YOUR_KEY')}</li>
          <li>{t('API базовый URL:', 'API base URL:')} <code className="text-xs bg-[var(--bg-tertiary)] px-1 rounded">{window.location.origin}/api/v3</code></li>
          <li>{t('Выбирайте минимально необходимые права доступа', 'Choose minimum required permissions')}</li>
          <li>{t('Отключайте неиспользуемые ключи для безопасности', 'Disable unused keys for security')}</li>
        </ul>
      </div>

      {/* Link to Automations */}
      <div className="flex items-center justify-center">
        <Link 
          to={`/projects/${projectId}/automations`}
          className="flex items-center gap-2 text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <Zap className="w-4 h-4" />
          {t('Перейти к Автоматизациям', 'Go to Automations')}
          <ChevronRight className="w-4 h-4" />
        </Link>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateApiKeyModal
          onClose={() => setShowCreateModal(false)}
          onCreate={(data) => createMutation.mutate(data)}
          isLoading={createMutation.isPending}
          language={language}
          currentProjectId={numericProjectId}
        />
      )}
    </div>
  );
}

function ApiKeyCard({ 
  apiKey, 
  onDelete, 
  onToggle,
  language 
}: { 
  apiKey: ApiKey; 
  onDelete: () => void; 
  onToggle: () => void;
  language: string;
}) {
  const t = (ru: string, en: string) => language === 'ru' ? ru : en;
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString(language === 'ru' ? 'ru-RU' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const isExpired = apiKey.expires_at && new Date(apiKey.expires_at) < new Date();

  return (
    <div className={`bg-[var(--bg-secondary)] border rounded-lg p-4 ${
      !apiKey.is_active || isExpired
        ? 'border-[var(--border-primary)] opacity-60'
        : 'border-[var(--border-primary)]'
    }`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/20">
              <Key className="w-5 h-5 text-amber-500" />
            </div>
            <div className="min-w-0">
              <h4 className="font-medium text-[var(--text-primary)] truncate">{apiKey.name}</h4>
              <code className="text-xs text-[var(--text-tertiary)] font-mono">
                {apiKey.key_prefix}••••••••••••
              </code>
            </div>
            {!apiKey.is_active && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-red-500/10 text-red-500">
                {t('Отключен', 'Disabled')}
              </span>
            )}
            {isExpired && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-500/10 text-yellow-500">
                {t('Истёк', 'Expired')}
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 mt-3 text-xs text-[var(--text-tertiary)]">
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {formatDate(apiKey.created_at)}
            </span>
            {apiKey.last_used_at && (
              <span className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" />
                {t('Исп.:', 'Used:')} {formatDate(apiKey.last_used_at)}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              {apiKey.request_count.toLocaleString()} {t('запросов', 'requests')}
            </span>
          </div>

          {apiKey.scopes && apiKey.scopes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {apiKey.scopes.map((scope) => (
                <span 
                  key={scope}
                  className="px-2 py-0.5 text-xs rounded bg-primary-500/10 text-primary-400 font-mono"
                >
                  {scope}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => copyToClipboard(`${apiKey.key_prefix}...`, `prefix-${apiKey.id}`)}
            className="p-2 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title={t('Копировать префикс', 'Copy prefix')}
          >
            {copiedId === `prefix-${apiKey.id}` ? (
              <Check className="w-4 h-4 text-emerald-500" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={onToggle}
            className={`p-2 rounded hover:bg-[var(--bg-tertiary)] transition-colors ${
              apiKey.is_active ? 'text-emerald-500' : 'text-[var(--text-tertiary)]'
            }`}
            title={apiKey.is_active ? t('Отключить', 'Disable') : t('Включить', 'Enable')}
          >
            {apiKey.is_active ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
          <button
            onClick={onDelete}
            className="p-2 rounded hover:bg-red-500/20 text-[var(--text-secondary)] hover:text-red-500 transition-colors"
            title={t('Удалить', 'Delete')}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateApiKeyModal({ 
  onClose, 
  onCreate, 
  isLoading,
  language,
  currentProjectId
}: { 
  onClose: () => void; 
  onCreate: (data: { 
    name: string; 
    scopes?: string[]; 
    expires_in_days?: number;
    agent_id?: number;
  }) => void;
  isLoading: boolean;
  language: string;
  currentProjectId?: number;
}) {
  const t = (ru: string, en: string) => language === 'ru' ? ru : en;
  const [name, setName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['*']);
  const [expiresIn, setExpiresIn] = useState<string>('never');
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);

  // Load all projects
  const { data: projects = [] } = useQuery<ProjectInfo[]>({
    queryKey: ['all-projects-for-agents'],
    queryFn: async () => {
      const response = await apiClient.get<{ data: ProjectInfo[] }>('/projects');
      return response.data || [];
    }
  });

  // Load spaces for project names
  const { data: spaces = [] } = useQuery<SpaceInfo[]>({
    queryKey: ['all-spaces-for-agents'],
    queryFn: async () => {
      const response = await apiClient.get<{ data: SpaceInfo[] }>('/spaces');
      return response.data || [];
    }
  });

  // Find System Data project and set as default
  useEffect(() => {
    if (projects.length > 0 && selectedProjectId === null) {
      // Find System Data project (prefer current space's System Data, else any)
      const currentProject = projects.find((p) => p.id === currentProjectId);
      const currentSpaceId = currentProject?.space_id;
      
      const systemDataProject = projects.find((p) => 
        p.name === 'System Data' && p.space_id === currentSpaceId
      ) || projects.find((p) => p.name === 'System Data');
      
      if (systemDataProject) {
        setSelectedProjectId(systemDataProject.id);
      }
    }
  }, [projects, selectedProjectId, currentProjectId]);

  // Load tables for selected project
  const { data: tables = [] } = useQuery<TableInfo[]>({
    queryKey: ['project-tables-for-agents', selectedProjectId],
    queryFn: async () => {
      if (!selectedProjectId) return [];
      const response = await apiClient.get<{ data: TableInfo[] }>(`/tables?project_id=${selectedProjectId}`);
      return response.data || [];
    },
    enabled: !!selectedProjectId
  });

  // Auto-select AI Agents table when tables load
  useEffect(() => {
    if (tables.length > 0 && selectedTableId === null) {
      // Find AI Agents table
      const aiAgentsTable = tables.find((t) => 
        t.name === 'AI Agents' || t.display_name === 'AI Agents'
      );
      if (aiAgentsTable) {
        setSelectedTableId(aiAgentsTable.id);
      }
    }
  }, [tables, selectedTableId]);

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
    enabled: !!selectedTableId
  });

  // Create space lookup
  const spaceMap = new Map(spaces.map((s) => [s.id, s]));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate({
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
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
              {selectedAgentId && (
                <p className="text-xs text-[var(--text-tertiary)] mt-1">
                  {t('Ключ будет привязан к выбранному агенту', 'Key will be assigned to selected agent')}
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
              disabled={isLoading || !name.trim()}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? t('Создание...', 'Creating...') : t('Создать', 'Create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ProjectApiKeysPage;
