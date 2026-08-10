import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Key, Plus, Trash2, Copy, Check, RefreshCw, Eye, EyeOff, 
  AlertTriangle, Clock, Activity, Shield
} from 'lucide-react';
import { apiKeysApi, ApiKey, CreateApiKeyResponse } from '../api/apiKeysApi';
import { useLanguage } from '@/shared/i18n/LanguageContext';

const AVAILABLE_SCOPES = [
  { value: '*', label: { ru: 'Полный доступ', en: 'Full access' } },
  { value: 'tables:read', label: { ru: 'Чтение таблиц', en: 'Read tables' } },
  { value: 'tables:write', label: { ru: 'Запись таблиц', en: 'Write tables' } },
  { value: 'rows:read', label: { ru: 'Чтение записей', en: 'Read rows' } },
  { value: 'rows:write', label: { ru: 'Запись записей', en: 'Write rows' } },
  { value: 'widgets:read', label: { ru: 'Чтение виджетов', en: 'Read widgets' } },
  { value: 'widgets:write', label: { ru: 'Запись виджетов', en: 'Write widgets' } },
];

export function ApiKeysManager() {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => language === 'ru' ? ru : en;
  
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState<CreateApiKeyResponse | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: apiKeys = [], isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => apiKeysApi.list()
  });

  const createMutation = useMutation({
    mutationFn: apiKeysApi.create,
    onSuccess: (data) => {
      setNewKeyResult(data);
      setShowCreateModal(false);
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiKeysApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    }
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) => 
      apiKeysApi.update(id, { is_active: is_active ? 1 : 0 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Key className="w-5 h-5" />
            {t('API Ключи', 'API Keys')}
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            {t(
              'Управляйте ключами для доступа к API без сессионной аутентификации',
              'Manage keys for API access without session authentication'
            )}
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('Создать ключ', 'Create Key')}
        </button>
      </div>

      {/* New Key Alert */}
      {newKeyResult && (
        <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-medium text-[var(--text-primary)]">
                {t('Сохраните ваш API ключ!', 'Save your API key!')}
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
                    <Check className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <Copy className="w-4 h-4 text-[var(--text-secondary)]" />
                  )}
                </button>
              </div>
              <button
                onClick={() => setNewKeyResult(null)}
                className="mt-3 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
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
          {t('Загрузка...', 'Loading...')}
        </div>
      ) : apiKeys.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-[var(--border-primary)] rounded-xl">
          <Key className="w-12 h-12 mx-auto text-[var(--text-tertiary)] mb-4" />
          <p className="text-[var(--text-secondary)]">
            {t('У вас пока нет API ключей', 'You have no API keys yet')}
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="mt-4 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
          >
            {t('Создать первый ключ', 'Create your first key')}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {apiKeys.map((key) => (
            <ApiKeyCard
              key={key.id}
              apiKey={key}
              onDelete={() => {
                if (confirm(t('Удалить этот API ключ?', 'Delete this API key?'))) {
                  deleteMutation.mutate(key.id);
                }
              }}
              onToggle={() => toggleMutation.mutate({ id: key.id, is_active: !key.is_active })}
              language={language}
            />
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateApiKeyModal
          onClose={() => setShowCreateModal(false)}
          onCreate={(data) => createMutation.mutate(data)}
          isLoading={createMutation.isPending}
          language={language}
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
    <div className={`p-4 rounded-xl border ${
      !apiKey.is_active || isExpired
        ? 'bg-[var(--bg-secondary)]/50 border-[var(--border-primary)]/50 opacity-60'
        : 'bg-[var(--bg-secondary)] border-[var(--border-primary)]'
    }`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h4 className="font-medium text-[var(--text-primary)]">{apiKey.name}</h4>
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
          
          <div className="flex items-center gap-2 mt-2">
            <code className="px-2 py-1 text-xs bg-[var(--bg-primary)] rounded font-mono text-[var(--text-secondary)]">
              {apiKey.key_prefix}••••••••••••••••
            </code>
            <button
              onClick={() => copyToClipboard(`${apiKey.key_prefix}••••••••••••••••`, `prefix-${apiKey.id}`)}
              className="p-1 rounded hover:bg-[var(--bg-tertiary)] transition-colors"
              title={t('Копировать префикс', 'Copy prefix')}
            >
              {copiedId === `prefix-${apiKey.id}` ? (
                <Check className="w-3 h-3 text-emerald-500" />
              ) : (
                <Copy className="w-3 h-3 text-[var(--text-tertiary)]" />
              )}
            </button>
          </div>

          <div className="flex items-center gap-4 mt-3 text-xs text-[var(--text-tertiary)]">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {t('Создан:', 'Created:')} {formatDate(apiKey.created_at)}
            </span>
            {apiKey.last_used_at && (
              <span className="flex items-center gap-1">
                <Activity className="w-3 h-3" />
                {t('Использован:', 'Last used:')} {formatDate(apiKey.last_used_at)}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Shield className="w-3 h-3" />
              {apiKey.request_count} {t('запросов', 'requests')}
            </span>
          </div>

          {apiKey.scopes && apiKey.scopes.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {apiKey.scopes.map((scope) => (
                <span 
                  key={scope}
                  className="px-2 py-0.5 text-xs rounded bg-primary-500/10 text-primary-400"
                >
                  {scope}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onToggle}
            className={`p-2 rounded-lg transition-colors ${
              apiKey.is_active
                ? 'hover:bg-yellow-500/10 text-yellow-500'
                : 'hover:bg-emerald-500/10 text-emerald-500'
            }`}
            title={apiKey.is_active ? t('Отключить', 'Disable') : t('Включить', 'Enable')}
          >
            {apiKey.is_active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          <button
            onClick={onDelete}
            className="p-2 rounded-lg hover:bg-red-500/10 text-red-500 transition-colors"
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
  language 
}: { 
  onClose: () => void; 
  onCreate: (data: { name: string; scopes?: string[]; expires_in_days?: number }) => void;
  isLoading: boolean;
  language: string;
}) {
  const t = (ru: string, en: string) => language === 'ru' ? ru : en;
  const [name, setName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['*']);
  const [expiresIn, setExpiresIn] = useState<string>('never');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate({
      name,
      scopes: selectedScopes,
      expires_in_days: expiresIn === 'never' ? undefined : parseInt(expiresIn)
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
        className="w-full max-w-md bg-[var(--bg-primary)] rounded-2xl shadow-xl border border-[var(--border-primary)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 border-b border-[var(--border-primary)]">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">
            {t('Создать API ключ', 'Create API Key')}
          </h3>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
              {t('Название', 'Name')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('Например: Интеграция с n8n', 'e.g., n8n Integration')}
              className="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
              required
            />
          </div>

          {/* Scopes */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
              {t('Права доступа', 'Permissions')}
            </label>
            <div className="space-y-2">
              {AVAILABLE_SCOPES.map((scope) => (
                <label 
                  key={scope.value}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(scope.value)}
                    onChange={() => toggleScope(scope.value)}
                    className="w-4 h-4 rounded border-[var(--border-primary)] text-primary-500"
                  />
                  <span className="text-sm text-[var(--text-primary)]">
                    {scope.label[language as 'ru' | 'en']}
                  </span>
                  <code className="text-xs text-[var(--text-tertiary)]">{scope.value}</code>
                </label>
              ))}
            </div>
          </div>

          {/* Expiration */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
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

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
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
              className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? t('Создание...', 'Creating...') : t('Создать', 'Create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ApiKeysManager;
