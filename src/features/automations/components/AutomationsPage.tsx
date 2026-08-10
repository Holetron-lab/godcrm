import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Plus,
  Play,
  Pause,
  Trash2,
  Edit,
  Zap,
  RefreshCcw,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Webhook,
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import {
  useAutomations,
  useCreateAutomation,
  useUpdateAutomation,
  useDeleteAutomation,
  useExecuteAutomation,
  useAutomationLogs
} from '../api/useAutomations';
import type { AutomationModel } from '../types/automation.types';
import { TRIGGER_LABELS, TRIGGER_ICONS, ACTION_LABELS, ACTION_ICONS } from './automationConstants';
import { AutomationModal } from './AutomationModal';

export { AutomationModal } from './AutomationModal';

// Компонент для отображения одной записи лога с раскрытием
interface LogEntryProps {
  log: {
    id: string | number;
    status: string;
    executedAt: string;
    durationMs?: number | null;
    errorMessage?: string | null;
    resultData?: Record<string, unknown> | null;
    triggerData?: Record<string, unknown> | null;
  };
  language: string;
}

function LogEntry({ log, language }: LogEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const t = (ru: string, en: string) => language === 'ru' ? ru : en;

  return (
    <div className="bg-[var(--bg-tertiary)] rounded overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 text-xs py-1.5 px-2 hover:bg-[var(--bg-primary)] transition-colors"
      >
        <ChevronRight className={`w-3 h-3 text-[var(--text-tertiary)] transition-transform ${expanded ? 'rotate-90' : ''}`} />
        {log.status === 'success' ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
        ) : (
          <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
        )}
        <span className="text-[var(--text-secondary)]">
          {new Date(log.executedAt).toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US')}
        </span>
        {log.durationMs && (
          <span className="text-[var(--text-tertiary)]">
            {log.durationMs}ms
          </span>
        )}
        {log.errorMessage && (
          <span className="text-red-500 truncate flex-1 text-left" title={log.errorMessage}>
            {log.errorMessage}
          </span>
        )}
        {log.resultData && !log.errorMessage && (
          <span className="text-[var(--text-tertiary)] truncate flex-1 text-left">
            {JSON.stringify(log.resultData).substring(0, 50)}...
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)]">
          {log.triggerData && (
            <div className="mb-2">
              <p className="text-xs font-medium text-[var(--text-tertiary)] mb-1">
                {t('Данные триггера:', 'Trigger data:')}
              </p>
              <pre className="text-xs bg-[var(--bg-primary)] p-2 rounded overflow-x-auto text-[var(--text-secondary)]">
                {JSON.stringify(log.triggerData, null, 2)}
              </pre>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-[var(--text-tertiary)] mb-1">
              {t('Результат:', 'Result:')}
            </p>
            <pre className="text-xs bg-[var(--bg-primary)] p-2 rounded overflow-x-auto text-[var(--text-secondary)] max-h-64 overflow-y-auto">
              {log.resultData ? JSON.stringify(log.resultData, null, 2) : t('Нет данных', 'No data')}
            </pre>
          </div>

          {log.errorMessage && (
            <div className="mt-2">
              <p className="text-xs font-medium text-red-500 mb-1">
                {t('Ошибка:', 'Error:')}
              </p>
              <pre className="text-xs bg-red-500/10 text-red-500 p-2 rounded overflow-x-auto">
                {log.errorMessage}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface AutomationCardProps {
  automation: AutomationModel;
  onEdit: (automation: AutomationModel) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, isActive: boolean) => void;
  onExecute: (id: string) => void;
  language: string;
}

function AutomationCard({ automation, onEdit, onDelete, onToggle, onExecute, language }: AutomationCardProps) {
  const t = (ru: string, en: string) => language === 'ru' ? ru : en;
  const [showLogs, setShowLogs] = useState(false);
  const { data: logsData } = useAutomationLogs(automation.id, 10);
  const logs = logsData?.data || [];

  const TriggerIcon = TRIGGER_ICONS[automation.triggerType] || Zap;
  const ActionIcon = ACTION_ICONS[automation.actionType] || Zap;
  const triggerLabel = TRIGGER_LABELS[automation.triggerType] || { ru: automation.triggerType, en: automation.triggerType };
  const actionLabel = ACTION_LABELS[automation.actionType] || { ru: automation.actionType, en: automation.actionType };

  // Определяем цвет иконки: красный если последний лог с ошибкой, зеленый если активна, серый если выключена
  const lastLog = logs[0];
  const hasError = lastLog?.status === 'error';
  const iconColorClass = hasError
    ? 'bg-red-500/20 text-red-500'
    : automation.isActive
      ? 'bg-emerald-500/20 text-emerald-500'
      : 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]';

  return (
    <div className={`bg-[var(--bg-secondary)] border rounded-lg p-4 ${automation.isActive ? 'border-[var(--border-primary)]' : 'border-[var(--border-primary)] opacity-60'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`p-2 rounded-lg ${iconColorClass}`}>
            <Zap className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-[var(--text-primary)] truncate">{automation.name}</h3>
            {automation.description && (
              <p className="text-sm text-[var(--text-tertiary)] truncate">{automation.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => onToggle(automation.id, !automation.isActive)}
            className={`p-2 rounded hover:bg-[var(--bg-tertiary)] transition-colors ${automation.isActive ? 'text-emerald-500' : 'text-[var(--text-tertiary)]'}`}
            title={automation.isActive ? t('Отключить', 'Disable') : t('Включить', 'Enable')}
          >
            {automation.isActive ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          </button>
          <button
            onClick={() => onExecute(automation.id)}
            className="p-2 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title={t('Выполнить вручную', 'Run manually')}
          >
            <RefreshCcw className="w-4 h-4" />
          </button>
          <button
            onClick={() => onEdit(automation)}
            className="p-2 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title={t('Редактировать', 'Edit')}
          >
            <Edit className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(automation.id)}
            className="p-2 rounded hover:bg-red-500/20 text-[var(--text-secondary)] hover:text-red-500 transition-colors"
            title={t('Удалить', 'Delete')}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Trigger & Action */}
      <div className="mt-4 flex items-center gap-2 text-sm">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-tertiary)] rounded-lg">
          <TriggerIcon className="w-4 h-4 text-primary-500" />
          <span className="text-[var(--text-secondary)]">{triggerLabel[language as 'ru' | 'en'] || triggerLabel.en}</span>
        </div>
        <span className="text-[var(--text-tertiary)]">→</span>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-tertiary)] rounded-lg">
          <ActionIcon className="w-4 h-4 text-purple-500" />
          <span className="text-[var(--text-secondary)]">{actionLabel[language as 'ru' | 'en'] || actionLabel.en}</span>
        </div>
      </div>

      {/* Logs toggle */}
      <button
        onClick={() => setShowLogs(!showLogs)}
        className="mt-3 flex items-center gap-2 text-sm text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
      >
        <ChevronDown className={`w-4 h-4 transition-transform ${showLogs ? 'rotate-180' : ''}`} />
        {t('История выполнений', 'Execution history')} ({logs.length})
      </button>

      {/* Logs list */}
      {showLogs && (
        <div className="mt-2 space-y-1">
          {logs.length === 0 ? (
            <p className="text-sm text-[var(--text-tertiary)] py-2">{t('Нет истории выполнений', 'No execution history')}</p>
          ) : (
            logs.map((log) => (
              <LogEntry key={log.id} log={log} language={language} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function AutomationsPage() {
  const { tableId, projectId } = useParams<{ tableId?: string; projectId?: string }>();
  const { language } = useLanguage();
  const t = (ru: string, en: string) => language === 'ru' ? ru : en;

  const [showModal, setShowModal] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<AutomationModel | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const scopeId = tableId || projectId;
  const scopeType = tableId ? 'table' : 'project';

  const { data, isLoading } = useAutomations(scopeId, scopeType);
  const createMutation = useCreateAutomation();
  const updateMutation = useUpdateAutomation();
  const deleteMutation = useDeleteAutomation();
  const executeMutation = useExecuteAutomation();

  const automations = useMemo(() => data?.data || [], [data]);

  const filteredAutomations = useMemo(() => {
    if (filter === 'all') return automations;
    if (filter === 'active') return automations.filter(a => a.isActive);
    return automations.filter(a => !a.isActive);
  }, [automations, filter]);

  const activeCount = automations.filter(a => a.isActive).length;
  const totalExecutions = data?.stats?.totalExecutions ?? 0;

  const handleCreate = () => {
    setEditingAutomation(null);
    setShowModal(true);
  };

  const handleEdit = (automation: AutomationModel) => {
    setEditingAutomation(automation);
    setShowModal(true);
  };

  const handleDelete = (id: string) => {
    if (confirm(t('Удалить эту автоматизацию?', 'Delete this automation?'))) {
      deleteMutation.mutate(id);
    }
  };

  const handleToggle = (id: string, isActive: boolean) => {
    updateMutation.mutate({ id, isActive });
  };

  const handleExecute = (id: string) => {
    executeMutation.mutate({ id });
  };

  const handleSave = (data: Partial<AutomationModel>) => {
    if (editingAutomation) {
      updateMutation.mutate({
        id: editingAutomation.id,
        ...data,
      } as Parameters<typeof updateMutation.mutate>[0]);
    } else {
      createMutation.mutate({
        name: data.name!,
        tableId: data.tableId!,
        triggerType: data.triggerType!,
        triggerConfig: data.triggerConfig || {},
        actionType: data.actionType!,
        actionConfig: data.actionConfig || {},
        description: data.description,
        isActive: data.isActive,
      });
    }
    setShowModal(false);
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-3">
            <Zap className="w-7 h-7 text-amber-500" />
            {t('Автоматизации', 'Automations')}
          </h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            {t('Автоматизируйте действия при изменении данных', 'Automate actions when data changes')}
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('Новая автоматизация', 'New Automation')}
        </button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-4">
          <div className="text-2xl font-bold text-[var(--text-primary)]">{automations.length}</div>
          <div className="text-sm text-[var(--text-tertiary)]">{t('Всего автоматизаций', 'Total Automations')}</div>
        </div>
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-4">
          <div className="text-2xl font-bold text-emerald-500">{activeCount}</div>
          <div className="text-sm text-[var(--text-tertiary)]">{t('Активных', 'Active')}</div>
        </div>
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-4">
          <div className="text-2xl font-bold text-[var(--text-primary)]">{totalExecutions}</div>
          <div className="text-sm text-[var(--text-tertiary)]">{t('Выполнений', 'Executions')}</div>
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

      {/* Automations List */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500 mx-auto"></div>
            <p className="text-sm text-[var(--text-tertiary)] mt-2">{t('Загрузка автоматизаций...', 'Loading automations...')}</p>
          </div>
        ) : filteredAutomations.length === 0 ? (
          <div className="text-center py-12 bg-[var(--bg-secondary)] border border-dashed border-[var(--border-primary)] rounded-lg">
            <Zap className="w-12 h-12 text-[var(--text-tertiary)] mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-[var(--text-secondary)] mb-2">
              {automations.length === 0 ? t('Нет автоматизаций', 'No Automations') : t('Нет совпадений', 'No Matches')}
            </h3>
            <p className="text-sm text-[var(--text-tertiary)] mb-4">
              {automations.length === 0
                ? t('Создайте первую автоматизацию для проекта', 'Create your first automation for this project')
                : t('Попробуйте изменить фильтр', 'Try changing the filter')}
            </p>
            {automations.length === 0 && (
              <button
                onClick={handleCreate}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                {t('Создать автоматизацию', 'Create Automation')}
              </button>
            )}
          </div>
        ) : (
          filteredAutomations.map((automation) => (
            <AutomationCard
              key={automation.id}
              automation={automation}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggle={handleToggle}
              onExecute={handleExecute}
              language={language}
            />
          ))
        )}
      </div>

      {/* Info Block */}
      <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
        <h4 className="font-medium text-purple-600 dark:text-purple-400 flex items-center gap-2 mb-2">
          <Zap className="w-4 h-4" />
          {t('Как работают автоматизации', 'How automations work')}
        </h4>
        <ul className="text-sm text-[var(--text-secondary)] space-y-1 list-disc list-inside">
          <li>{t('Выберите триггер: изменение поля, создание записи или по расписанию', 'Choose a trigger: field change, row creation, or scheduled')}</li>
          <li>{t('Настройте действие: webhook, обновление поля или уведомление', 'Configure an action: webhook, field update, or notification')}</li>
          <li>{t('Автоматизации срабатывают мгновенно при наступлении условия', 'Automations trigger instantly when conditions are met')}</li>
          <li>{t('Отслеживайте выполнения в логах каждой автоматизации', 'Track executions in each automation\'s logs')}</li>
        </ul>
      </div>

      {/* Link to Webhooks */}
      <div className="flex items-center justify-center">
        <Link
          to={`/projects/${projectId}/webhooks`}
          className="flex items-center gap-2 text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <Webhook className="w-4 h-4" />
          {t('Перейти к Webhooks', 'Go to Webhooks')}
          <ChevronRight className="w-4 h-4" />
        </Link>
      </div>

      {showModal && (tableId || projectId) && (
        <AutomationModal
          automation={editingAutomation}
          tableId={tableId}
          projectId={projectId}
          onClose={() => setShowModal(false)}
          onSave={handleSave}
          language={language}
        />
      )}
    </div>
  );
}

export default AutomationsPage;
