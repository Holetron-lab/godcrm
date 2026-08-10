import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { logger } from '@/shared/utils/logger';
import { Modal } from '@/shared/components/ui';
import { automationsApi } from '@/features/automations/api/automationsApi';

interface AutomationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableId?: string;
}

export const AutomationModal = ({
  open,
  onOpenChange,
  tableId,
}: AutomationModalProps) => {
  // Automation form state
  const [automationName, setAutomationName] = useState('');
  const [automationDescription, setAutomationDescription] = useState('');
  const [automationTrigger, setAutomationTrigger] = useState('column_change');
  const [automationAction, setAutomationAction] = useState('webhook');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookMethod, setWebhookMethod] = useState('POST');
  // Schedule trigger settings
  const [scheduleInterval, setScheduleInterval] = useState('daily');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [scheduleCron, setScheduleCron] = useState('0 9 * * *');
  // API Sync action settings
  const [apiSyncUrl, setApiSyncUrl] = useState('');
  const [apiSyncHeaders, setApiSyncHeaders] = useState('');
  const [apiSyncDataPath, setApiSyncDataPath] = useState('data');
  const [apiSyncMapping, setApiSyncMapping] = useState('');
  const [isCreatingAutomation, setIsCreatingAutomation] = useState(false);
  // Server time display
  const [serverTime, setServerTime] = useState('');

  // Update server time every second when automation modal is open
  useEffect(() => {
    if (open && automationTrigger === 'schedule') {
      const updateTime = () => {
        const now = new Date();
        setServerTime(now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      };
      updateTime();
      const interval = setInterval(updateTime, 1000);
      return () => clearInterval(interval);
    }
  }, [open, automationTrigger]);

  const resetForm = () => {
    setAutomationName('');
    setAutomationDescription('');
    setAutomationTrigger('column_change');
    setAutomationAction('webhook');
    setWebhookUrl('');
    setWebhookMethod('POST');
    setScheduleInterval('daily');
    setScheduleTime('09:00');
    setScheduleCron('0 9 * * *');
    setApiSyncUrl('');
    setApiSyncHeaders('');
    setApiSyncDataPath('data');
    setApiSyncMapping('');
  };

  const handleCreate = async () => {
    if (!tableId) return;

    setIsCreatingAutomation(true);
    try {
      // Build trigger config
      const triggerConfig: Record<string, unknown> = {};
      if (automationTrigger === 'schedule') {
        triggerConfig.cron = scheduleCron;
        triggerConfig.interval = scheduleInterval;
        triggerConfig.time = scheduleTime;
      }

      // Build action config
      const actionConfig: Record<string, unknown> = {};
      if (automationAction === 'webhook' || automationAction === 'n8n') {
        actionConfig.url = webhookUrl;
        actionConfig.method = webhookMethod;
      } else if (automationAction === 'api_sync') {
        actionConfig.url = apiSyncUrl;
        actionConfig.headers = apiSyncHeaders ? JSON.parse(apiSyncHeaders) : {};
        actionConfig.dataPath = apiSyncDataPath;
        actionConfig.mapping = apiSyncMapping ? JSON.parse(apiSyncMapping) : {};
      }

      const response = await automationsApi.create({
        name: automationName,
        description: automationDescription,
        table_id: parseInt(tableId),
        trigger_type: automationTrigger,
        trigger_config: triggerConfig,
        action_type: automationAction,
        action_config: actionConfig,
        is_active: true
      });

      logger.debug('Automation created:', response);
      onOpenChange(false);
      resetForm();

      // Show success message
      alert('Автоматизация создана!');
    } catch (error) {
      logger.error('Error creating automation:', error);
      alert('Ошибка при создании автоматизации');
    } finally {
      setIsCreatingAutomation(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Новая автоматизация"
      size="md"
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-1">Название</label>
          <input
            type="text"
            value={automationName}
            onChange={(e) => setAutomationName(e.target.value)}
            className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50"
            placeholder="Например: Отправить в n8n при изменении статуса"
          />
        </div>

        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-1">Описание (опционально)</label>
          <textarea
            value={automationDescription}
            onChange={(e) => setAutomationDescription(e.target.value)}
            className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50 resize-none h-20"
            placeholder="Краткое описание что делает эта автоматизация"
          />
        </div>

        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-1">Триггер (когда запускать)</label>
          <select
            value={automationTrigger}
            onChange={(e) => setAutomationTrigger(e.target.value)}
            className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50"
          >
            <option value="column_change" className="bg-[var(--bg-secondary)]">Изменение поля</option>
            <option value="row_create" className="bg-[var(--bg-secondary)]">Создание записи</option>
            <option value="row_delete" className="bg-[var(--bg-secondary)]">Удаление записи</option>
            <option value="button_click" className="bg-[var(--bg-secondary)]">Нажатие кнопки</option>
            <option value="schedule" className="bg-[var(--bg-secondary)]">По расписанию</option>
          </select>
        </div>

        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-1">Действие (что делать)</label>
          <select
            value={automationAction}
            onChange={(e) => setAutomationAction(e.target.value)}
            className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50"
          >
            <option value="webhook" className="bg-[var(--bg-secondary)]">Вызов Webhook</option>
            <option value="api_sync" className="bg-[var(--bg-secondary)]">Синхронизация из API</option>
            <option value="update_field" className="bg-[var(--bg-secondary)]">Обновить поле</option>
            <option value="create_row" className="bg-[var(--bg-secondary)]">Создать запись</option>
            <option value="delete_row" className="bg-[var(--bg-secondary)]">Удалить запись</option>
            <option value="notification" className="bg-[var(--bg-secondary)]">Уведомление</option>
            <option value="n8n" className="bg-[var(--bg-secondary)]">n8n Workflow</option>
          </select>
        </div>

        {/* Schedule trigger settings */}
        {automationTrigger === 'schedule' && (
          <div className="space-y-3 p-3 bg-[var(--bg-tertiary)] rounded-lg">
            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">Интервал</label>
              <select
                value={scheduleInterval}
                onChange={(e) => {
                  setScheduleInterval(e.target.value);
                  // Update cron based on interval
                  const cronMap: Record<string, string> = {
                    'hourly': '0 * * * *',
                    'daily': `0 ${scheduleTime.split(':')[0]} * * *`,
                    'weekly': `0 ${scheduleTime.split(':')[0]} * * 1`,
                    'monthly': `0 ${scheduleTime.split(':')[0]} 1 * *`,
                    'custom': scheduleCron
                  };
                  setScheduleCron(cronMap[e.target.value] || '0 9 * * *');
                }}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50"
              >
                <option value="hourly">Каждый час</option>
                <option value="daily">Ежедневно</option>
                <option value="weekly">Еженедельно</option>
                <option value="monthly">Ежемесячно</option>
                <option value="custom">Своё расписание (cron)</option>
              </select>
            </div>
            {scheduleInterval !== 'hourly' && scheduleInterval !== 'custom' && (
              <div>
                <label className="flex justify-between text-sm text-[var(--text-secondary)] mb-1">
                  <span>Время запуска</span>
                  <span className="text-[var(--text-tertiary)] font-mono">Сейчас на сервере: {serverTime}</span>
                </label>
                <input
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => {
                    setScheduleTime(e.target.value);
                    const hour = e.target.value.split(':')[0];
                    const cronMap: Record<string, string> = {
                      'daily': `0 ${hour} * * *`,
                      'weekly': `0 ${hour} * * 1`,
                      'monthly': `0 ${hour} 1 * *`
                    };
                    setScheduleCron(cronMap[scheduleInterval] || `0 ${hour} * * *`);
                  }}
                  className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50"
                />
              </div>
            )}
            {scheduleInterval === 'custom' && (
              <div>
                <label className="block text-sm text-[var(--text-secondary)] mb-1">Cron выражение</label>
                <input
                  type="text"
                  value={scheduleCron}
                  onChange={(e) => setScheduleCron(e.target.value)}
                  placeholder="0 9 * * *"
                  className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] font-mono focus:outline-none focus:border-primary-500/50"
                />
                <p className="text-xs text-[var(--text-tertiary)] mt-1">
                  Формат: минута час день месяц день_недели
                </p>
              </div>
            )}
            <div className="text-xs text-[var(--text-tertiary)] bg-[var(--bg-primary)] p-2 rounded">
              Cron: <code className="font-mono text-primary-400">{scheduleCron}</code>
            </div>
          </div>
        )}

        {/* API Sync action settings */}
        {automationAction === 'api_sync' && (
          <div className="space-y-3 p-3 bg-[var(--bg-tertiary)] rounded-lg">
            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">API URL</label>
              <input
                type="url"
                value={apiSyncUrl}
                onChange={(e) => setApiSyncUrl(e.target.value)}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50"
                placeholder="https://api.example.com/v1/models"
              />
            </div>
            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">Заголовки (JSON)</label>
              <textarea
                value={apiSyncHeaders}
                onChange={(e) => setApiSyncHeaders(e.target.value)}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] font-mono text-sm focus:outline-none focus:border-primary-500/50 resize-none h-16"
                placeholder='{"x-api-key": "{{API_KEY}}", "anthropic-version": "2023-06-01"}'
              />
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                Используйте {"{{FIELD}}"} для подстановки из связанных таблиц
              </p>
            </div>
            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">Путь к данным</label>
              <input
                type="text"
                value={apiSyncDataPath}
                onChange={(e) => setApiSyncDataPath(e.target.value)}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] font-mono focus:outline-none focus:border-primary-500/50"
                placeholder="data"
              />
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                JSONPath к массиву данных (например: data, response.items)
              </p>
            </div>
            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">Маппинг полей (JSON)</label>
              <textarea
                value={apiSyncMapping}
                onChange={(e) => setApiSyncMapping(e.target.value)}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] font-mono text-sm focus:outline-none focus:border-primary-500/50 resize-none h-20"
                placeholder='{"model_id": "id", "name": "display_name", "created_at": "created_at"}'
              />
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                Формат: {"{ \"поле_в_таблице\": \"поле_в_api\" }"}
              </p>
            </div>
          </div>
        )}

        {(automationAction === 'webhook' || automationAction === 'n8n') && (
          <div className="space-y-3 p-3 bg-[var(--bg-tertiary)] rounded-lg">
            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">Webhook URL</label>
              <input
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50"
                placeholder="https://n8n.example.com/webhook/..."
              />
            </div>
            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">HTTP метод</label>
              <select
                value={webhookMethod}
                onChange={(e) => setWebhookMethod(e.target.value)}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50"
              >
                <option value="POST" className="bg-[var(--bg-secondary)]">POST</option>
                <option value="GET" className="bg-[var(--bg-secondary)]">GET</option>
                <option value="PUT" className="bg-[var(--bg-secondary)]">PUT</option>
              </select>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            Отмена
          </button>
          <button
            disabled={!automationName.trim() || isCreatingAutomation}
            onClick={handleCreate}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-2"
          >
            {isCreatingAutomation && <Loader2 className="w-4 h-4 animate-spin" />}
            Создать
          </button>
        </div>
      </div>
    </Modal>
  );
};
