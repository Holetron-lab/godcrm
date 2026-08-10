import React, { useState, useMemo } from 'react';
import { logger } from '@/shared/utils/logger';
import { useParams, Link } from 'react-router-dom';
import { 
  Plus, 
  Webhook,
  Copy,
  Check,
  ExternalLink,
  Trash2,
  Play,
  RefreshCcw,
  AlertCircle,
  CheckCircle2,
  Clock,
  Zap,
  ChevronDown,
  ChevronRight,
  Radio,
  Loader2,
  X,
  Table
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useProjectTables } from '@/features/projects/hooks/useProjectTables';
import { 
  useWebhooks, 
  useCreateWebhook, 
  useUpdateWebhook, 
  useDeleteWebhook,
  useWebhookLogs,
  type Webhook as WebhookModel,
  type WebhookLog
} from '../api/useWebhooks';

// ============================================================================
// CreateWebhookModal Component
// ============================================================================
interface CreateWebhookModalProps {
  projectId: number;
  onClose: () => void;
  language: string;
}

function CreateWebhookModal({ projectId, onClose, language }: CreateWebhookModalProps) {
  const t = (ru: string, en: string) => language === 'ru' ? ru : en;
  const { data: tables = [] } = useProjectTables(projectId);
  const createWebhook = useCreateWebhook();
  
  const [name, setName] = useState('');
  const [tableOption, setTableOption] = useState<'new' | 'existing'>('new');
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [newTableName, setNewTableName] = useState('');
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    await createWebhook.mutateAsync({
      projectId,
      data: {
        name,
        createNewTable: tableOption === 'new',
        newTableName: tableOption === 'new' ? newTableName : undefined,
        tableId: tableOption === 'existing' ? selectedTableId || undefined : undefined,
      }
    });
    
    onClose();
  };
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-primary)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t('Новый Webhook', 'New Webhook')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-[var(--bg-tertiary)] rounded">
            <X className="w-5 h-5 text-[var(--text-tertiary)]" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
              {t('Название Webhook', 'Webhook Name')}
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('Например: Лиды с лендинга', 'e.g., Landing Page Leads')}
              className="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
              required
            />
          </div>
          
          {/* Table Selection */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              {t('Целевая таблица', 'Target Table')}
            </label>
            
            <div className="space-y-2">
              {/* Create New Table Option */}
              <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                tableOption === 'new' 
                  ? 'border-primary-500 bg-primary-500/10' 
                  : 'border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]'
              }`}>
                <input
                  type="radio"
                  name="tableOption"
                  checked={tableOption === 'new'}
                  onChange={() => setTableOption('new')}
                  className="w-4 h-4 text-primary-500"
                />
                <div className="flex-1">
                  <div className="font-medium text-[var(--text-primary)]">{t('Создать новую таблицу', 'Create new table')}</div>
                  <div className="text-xs text-[var(--text-tertiary)]">
                    {t('Новая таблица будет создана для этого webhook', 'A new table will be created for this webhook')}
                  </div>
                </div>
              </label>
              
              {tableOption === 'new' && (
                <input
                  type="text"
                  value={newTableName}
                  onChange={e => setNewTableName(e.target.value)}
                  placeholder={t('Название таблицы (опционально)', 'Table name (optional)')}
                  className="w-full ml-7 px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] text-sm"
                />
              )}
              
              {/* Use Existing Table Option */}
              <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                tableOption === 'existing' 
                  ? 'border-primary-500 bg-primary-500/10' 
                  : 'border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]'
              }`}>
                <input
                  type="radio"
                  name="tableOption"
                  checked={tableOption === 'existing'}
                  onChange={() => setTableOption('existing')}
                  className="w-4 h-4 text-primary-500"
                />
                <div className="flex-1">
                  <div className="font-medium text-[var(--text-primary)]">{t('Использовать существующую', 'Use existing table')}</div>
                  <div className="text-xs text-[var(--text-tertiary)]">
                    {t('Выберите из таблиц проекта', 'Select from your project tables')}
                  </div>
                </div>
              </label>
              
              {tableOption === 'existing' && (
                <select
                  value={selectedTableId || ''}
                  onChange={e => setSelectedTableId(Number(e.target.value))}
                  className="w-full ml-7 px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-[var(--text-primary)] text-sm"
                >
                  <option value="">{t('Выберите таблицу...', 'Select a table...')}</option>
                  {tables.map(table => (
                    <option key={table.id} value={table.id}>
                      {table.displayName || table.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          
          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition"
            >
              {t('Отмена', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={createWebhook.isPending || !name}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition disabled:opacity-50"
            >
              {createWebhook.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                t('Создать Webhook', 'Create Webhook')
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// WebhookCard Component
// ============================================================================
interface WebhookCardProps {
  webhook: WebhookModel;
  onCopy: (url: string) => void;
  copied: string | null;
  onToggle: (id: number, isActive: boolean) => void;
  onDelete: (id: number) => void;
  language: string;
}

function WebhookCard({ webhook, onCopy, copied, onToggle, onDelete, language }: WebhookCardProps) {
  const t = (ru: string, en: string) => language === 'ru' ? ru : en;
  const [isExpanded, setIsExpanded] = useState(false);
  const { data: logs = [] } = useWebhookLogs(webhook.id, 10);
  
  const webhookUrl = `${window.location.origin}/api/webhooks/incoming/${webhook.token}`;
  
  const timeAgo = webhook.lastTriggered 
    ? formatTimeAgo(new Date(webhook.lastTriggered), language)
    : t('Никогда', 'Never');

  return (
    <div className={`bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg transition-all ${
      !webhook.is_active ? 'opacity-60' : ''
    }`}>
      {/* Main Card */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className={`p-2 rounded-lg ${
              webhook.is_active 
                ? 'bg-primary-500/20 text-primary-500' 
                : 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]'
            }`}>
              <Webhook className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-medium text-[var(--text-primary)] truncate">{webhook.name}</h3>
              <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
                <Table className="w-3 h-3" />
                <span>{webhook.table_display_name || webhook.table_name || t('Нет таблицы', 'No table linked')}</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {webhook.is_active && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/20 px-2 py-1 rounded">
                <Radio className="w-3 h-3 animate-pulse" />
                {t('Слушает', 'Listening')}
              </span>
            )}
            {!webhook.is_active && (
              <span className="flex items-center gap-1 text-xs text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] px-2 py-1 rounded">
                <AlertCircle className="w-3 h-3" />
                {t('Отключён', 'Disabled')}
              </span>
            )}
          </div>
        </div>
        
        {/* URL with copy button */}
        <div className="mt-4 flex items-center gap-2 bg-[var(--bg-tertiary)] rounded-lg p-2">
          <code className="flex-1 text-xs text-[var(--text-secondary)] truncate font-mono">
            {webhookUrl}
          </code>
          <button
            onClick={() => onCopy(webhookUrl)}
            className="p-1.5 hover:bg-[var(--bg-secondary)] rounded transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            title={t('Копировать URL', 'Copy URL')}
          >
            {copied === webhookUrl ? (
              <Check className="w-4 h-4 text-emerald-500" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>
        </div>
        
        {/* Stats & Actions */}
        <div className="mt-4 flex items-center justify-between text-xs text-[var(--text-tertiary)]">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <RefreshCcw className="w-3 h-3" />
              {webhook.totalCalls || 0} {t('вызовов', 'calls')}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {t('Последний:', 'Last:')} {timeAgo}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              title={t('Показать логи', 'View logs')}
            >
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            <button
              onClick={() => onToggle(webhook.id, !webhook.is_active)}
              className={`p-1.5 hover:bg-[var(--bg-tertiary)] rounded transition-colors ${
                webhook.is_active ? 'text-emerald-500' : 'text-[var(--text-tertiary)]'
              }`}
              title={webhook.is_active ? t('Отключить', 'Disable') : t('Включить', 'Enable')}
            >
              {webhook.is_active ? <CheckCircle2 className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button
              onClick={() => onDelete(webhook.id)}
              className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded transition-colors text-[var(--text-tertiary)] hover:text-red-500"
              title={t('Удалить', 'Delete')}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      
      {/* Expanded Logs */}
      {isExpanded && (
        <div className="border-t border-[var(--border-primary)] p-4 bg-[var(--bg-tertiary)]/50">
          <h4 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-3">
            {t('Последние логи', 'Recent Logs')}
          </h4>
          {logs.length === 0 ? (
            <div className="text-center py-6 text-[var(--text-tertiary)]">
              <Radio className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{t('Ожидание входящих запросов...', 'Waiting for incoming requests...')}</p>
              <p className="text-xs mt-1">{t('Отправьте POST запрос на URL webhook', 'Send a POST request to the webhook URL')}</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {logs.map(log => (
                <LogEntry key={log.id} log={log} language={language} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// LogEntry Component
// ============================================================================
function LogEntry({ log, language }: { log: WebhookLog; language: string }) {
  const t = (ru: string, en: string) => language === 'ru' ? ru : en;
  const [showPayload, setShowPayload] = useState(false);
  
  const statusColors = {
    received: 'text-primary-500 bg-primary-500/20',
    processed: 'text-emerald-500 bg-emerald-500/20',
    error: 'text-red-500 bg-red-500/20',
  };
  
  const statusLabels = {
    received: t('получен', 'received'),
    processed: t('обработан', 'processed'),
    error: t('ошибка', 'error'),
  };
  
  let parsedPayload = null;
  try {
    parsedPayload = JSON.parse(log.payload);
  } catch {}
  
  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded ${statusColors[log.status]}`}>
            {statusLabels[log.status]}
          </span>
          <span className="text-xs text-[var(--text-tertiary)]">
            {new Date(log.created_at).toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US')}
          </span>
          <span className="text-xs text-[var(--text-tertiary)]">
            {t('от', 'from')} {log.source_ip}
          </span>
        </div>
        <button
          onClick={() => setShowPayload(!showPayload)}
          className="text-xs text-primary-500 hover:text-primary-400"
        >
          {showPayload ? t('Скрыть', 'Hide') : t('Показать', 'Show')} payload
        </button>
      </div>
      
      {log.error_message && (
        <div className="mt-2 text-xs text-red-500 bg-red-500/10 rounded p-2">
          {log.error_message}
        </div>
      )}
      
      {showPayload && parsedPayload && (
        <pre className="mt-2 text-xs text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded p-2 overflow-x-auto">
          {JSON.stringify(parsedPayload, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ============================================================================
// Helper Functions
// ============================================================================
function formatTimeAgo(date: Date, language: string): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  
  if (language === 'ru') {
    if (seconds < 60) return 'только что';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} мин назад`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} ч назад`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} д назад`;
  } else {
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  }
  
  return date.toLocaleDateString(language === 'ru' ? 'ru-RU' : 'en-US');
}

// ============================================================================
// Main WebhooksPage Component
// ============================================================================
export function WebhooksPage() {
  const { projectId } = useParams();
  const projectIdNum = Number(projectId);
  const { language } = useLanguage();
  const t = (ru: string, en: string) => language === 'ru' ? ru : en;
  
  const { data: webhooks = [], isLoading } = useWebhooks(projectIdNum);
  const updateWebhook = useUpdateWebhook();
  const deleteWebhook = useDeleteWebhook();
  
  const [copied, setCopied] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  
  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      logger.error('Failed to copy:', err);
    }
  };
  
  const handleToggle = (id: number, isActive: boolean) => {
    updateWebhook.mutate({ id, data: { isActive } });
  };
  
  const handleDelete = (id: number) => {
    if (window.confirm(t('Вы уверены, что хотите удалить этот webhook?', 'Are you sure you want to delete this webhook?'))) {
      deleteWebhook.mutate(id);
    }
  };
  
  const filteredWebhooks = useMemo(() => {
    if (filter === 'all') return webhooks;
    if (filter === 'active') return webhooks.filter(w => w.is_active);
    return webhooks.filter(w => !w.is_active);
  }, [webhooks, filter]);

  const activeCount = webhooks.filter(w => w.is_active).length;
  const totalCalls = webhooks.reduce((sum, w) => sum + (w.totalCalls || 0), 0);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-3">
            <Webhook className="w-7 h-7 text-primary-500" />
            Webhooks
          </h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            {t('Входящие webhook-эндпоинты для интеграций', 'Incoming webhook endpoints for external integrations')}
          </p>
        </div>
        
        <button 
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('Новый Webhook', 'New Webhook')}
        </button>
      </div>
      
      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-4">
          <div className="text-2xl font-bold text-[var(--text-primary)]">{webhooks.length}</div>
          <div className="text-sm text-[var(--text-tertiary)]">{t('Всего Webhooks', 'Total Webhooks')}</div>
        </div>
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-4">
          <div className="text-2xl font-bold text-emerald-500">{activeCount}</div>
          <div className="text-sm text-[var(--text-tertiary)]">{t('Слушают', 'Listening')}</div>
        </div>
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-4">
          <div className="text-2xl font-bold text-[var(--text-primary)]">{totalCalls}</div>
          <div className="text-sm text-[var(--text-tertiary)]">{t('Всего вызовов', 'Total Calls')}</div>
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
      
      {/* Webhooks List */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="text-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary-500 mx-auto" />
            <p className="text-sm text-[var(--text-tertiary)] mt-2">{t('Загрузка webhooks...', 'Loading webhooks...')}</p>
          </div>
        ) : filteredWebhooks.length === 0 ? (
          <div className="text-center py-12 bg-[var(--bg-secondary)] border border-dashed border-[var(--border-primary)] rounded-lg">
            <Webhook className="w-12 h-12 text-[var(--text-tertiary)] mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-[var(--text-secondary)] mb-2">
              {webhooks.length === 0 ? t('Нет Webhooks', 'No Webhooks Yet') : t('Нет совпадений', 'No Matching Webhooks')}
            </h3>
            <p className="text-sm text-[var(--text-tertiary)] mb-4">
              {webhooks.length === 0 
                ? t('Создайте первый webhook для получения данных из внешних источников', 'Create your first webhook to receive data from external sources')
                : t('Попробуйте изменить фильтр', 'Try changing the filter')}
            </p>
            {webhooks.length === 0 && (
              <button 
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                {t('Создать Webhook', 'Create Webhook')}
              </button>
            )}
          </div>
        ) : (
          filteredWebhooks.map(webhook => (
            <WebhookCard 
              key={webhook.id} 
              webhook={webhook} 
              onCopy={handleCopy}
              copied={copied}
              onToggle={handleToggle}
              onDelete={handleDelete}
              language={language}
            />
          ))
        )}
      </div>
      
      {/* Info Block */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
        <h4 className="font-medium text-blue-600 dark:text-blue-400 flex items-center gap-2 mb-2">
          <ExternalLink className="w-4 h-4" />
          {t('Как использовать webhooks', 'How to use webhooks')}
        </h4>
        <ul className="text-sm text-[var(--text-secondary)] space-y-1 list-disc list-inside">
          <li>{t('Скопируйте URL и используйте в настройках внешнего сервиса', 'Copy the webhook URL and use it in external service settings')}</li>
          <li>{t('Отправляйте данные в формате JSON методом POST', 'Send data in JSON format using POST method')}</li>
          <li>{t('Новые поля в payload автоматически создадут колонки', 'New fields in payload will automatically create columns')}</li>
          <li>{t('Просматривайте логи, нажав на кнопку раскрытия', 'View logs by clicking the expand button on each webhook')}</li>
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
        <CreateWebhookModal 
          projectId={projectIdNum} 
          onClose={() => setShowCreateModal(false)}
          language={language}
        />
      )}
    </div>
  );
}

export default WebhooksPage;
