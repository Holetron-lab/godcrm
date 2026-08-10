import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Select, Switch } from '@/shared/components/ui';
import { automationsApi, Automation, CreateAutomationPayload } from '@/features/automations/api/automationsApi';
import { ColumnModel } from '@/features/tables/types/table.types';
import { showToast } from '@/shared/hooks/useToast';
import { Zap } from 'lucide-react';

type TriggerType = 'column_change' | 'row_create' | 'row_delete' | 'button_click' | 'schedule';
type ActionType = 'webhook' | 'update_field' | 'create_row' | 'delete_row' | 'notification' | 'n8n' | 'api_sync';

interface AutomationTabProps {
  draft: ColumnModel;
  tableId?: number;
  projectId?: number;
  tableName?: string;
}

export const AutomationTab: React.FC<AutomationTabProps> = ({ draft, tableId, projectId, tableName }) => {
  const [isCreating, setIsCreating] = useState(false);
  
  // Автоматическое название по умолчанию
  const defaultName = `Автоматизация таблицы ${tableName || 'Без названия'} колонки ${draft.displayName || draft.name}`;
  
  const [newAutomation, setNewAutomation] = useState<{
    name: string;
    description?: string;
    trigger_type: TriggerType;
    action_type: ActionType;
    trigger_config?: Record<string, unknown>;
    action_config?: Record<string, unknown>;
    is_active: boolean;
  }>({
    name: defaultName,
    description: '',
    trigger_type: 'column_change',
    action_type: 'webhook',
    trigger_config: { columnId: draft.id },
    action_config: { url: '', method: 'POST' },
    is_active: true
  });
  
  // Обновляем название при изменении колонки или таблицы
  useEffect(() => {
    if (!isCreating) {
      setNewAutomation(prev => ({
        ...prev,
        name: `Автоматизация таблицы ${tableName || 'Без названия'} колонки ${draft.displayName || draft.name}`,
        trigger_config: { columnId: draft.id }
      }));
    }
  }, [draft.id, draft.displayName, draft.name, tableName, isCreating]);

  const queryClient = useQueryClient();

  // Загружаем автоматизации таблицы
  const { data: automations = [], isLoading } = useQuery({
    queryKey: ['automations', 'table', tableId],
    queryFn: () => tableId ? automationsApi.getByTable(tableId) : Promise.resolve([]),
    enabled: !!tableId,
  });

  // Фильтруем автоматизации по текущей колонке
  const columnAutomations = automations.filter(
    auto => auto.trigger_config?.columnId === draft.id
  );

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: CreateAutomationPayload) => automationsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations', 'table', tableId] });
      showToast('Автоматизация создана');
      setIsCreating(false);
      setNewAutomation({
        name: '',
        trigger_type: 'column_change',
        action_type: 'webhook',
        trigger_config: { columnId: draft.id },
        action_config: { url: '', method: 'POST' },
        is_active: true
      });
    },
    onError: () => {
      showToast('Ошибка создания автоматизации');
    }
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => 
      automationsApi.toggle(id, isActive, projectId || 0),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations', 'table', tableId] });
      showToast('Статус обновлен');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => automationsApi.delete(id, projectId || 0),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations', 'table', tableId] });
      showToast('Автоматизация удалена');
    }
  });

  const handleCreate = () => {
    if (!tableId || !newAutomation.name) {
      showToast('Заполните все обязательные поля', 'error');
      return;
    }

    // Финальная action_config в зависимости от типа
    let finalActionConfig: Record<string, unknown> = {};
    if (newAutomation.action_type === 'webhook') {
      finalActionConfig = newAutomation.action_config || { url: '', method: 'POST' };
    } else if (newAutomation.action_type === 'api_sync') {
      try {
        const config = newAutomation.action_config as any;
        finalActionConfig = {
          url: config?.url || '',
          headers: config?.headers ? JSON.parse(config.headers) : {},
          data_path: config?.data_path || 'data',
          field_mapping: config?.field_mapping ? JSON.parse(config.field_mapping) : {},
        };
      } catch (e) {
        showToast('Ошибка в JSON конфигурации', 'error');
        return;
      }
    }
    
    // Финальная trigger_config
    let finalTriggerConfig: Record<string, unknown> = { columnId: draft.id };
    if (newAutomation.trigger_type === 'schedule') {
      finalTriggerConfig = { ...(newAutomation.trigger_config || {}), cron: (newAutomation.trigger_config as any)?.cron || '0 9 * * *' };
    }

    createMutation.mutate({
      ...newAutomation,
      table_id: tableId,
      trigger_config: finalTriggerConfig,
      action_config: finalActionConfig,
    } as CreateAutomationPayload);
  };

  if (isLoading) {
    return <div className="p-8 text-center text-gray-500">Загрузка...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm border border-gray-200 dark:border-gray-700">
        <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">💡 Как работают автоматизации</p>
        <p className="text-gray-600 dark:text-gray-400 text-xs">
          Автоматизации позволяют выполнять действия при изменении значения колонки. Настройте триггер (изменение, создание, удаление) и действие (webhook, обновление поля, уведомление).
        </p>
      </div>

      {/* Список автоматизаций */}
      <div className="space-y-3">
        {columnAutomations.length === 0 && !isCreating && (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
            <Zap className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>Нет автоматизаций для этой колонки</p>
          </div>
        )}

        {columnAutomations.map(automation => (
          <div 
            key={automation.id}
            className={`p-4 rounded-lg border-2 ${
              automation.is_active
                ? 'border-green-500 dark:border-green-600 bg-green-50 dark:bg-green-900/20'
                : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800'
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <div className="font-medium text-gray-900 dark:text-gray-100 mb-1 flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  {automation.name}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {automation.trigger_type === 'column_change' && 'При изменении значения'}
                  {automation.trigger_type === 'row_create' && 'При создании строки'}
                  {automation.trigger_type === 'button_click' && 'При нажатии кнопки'}
                  {' → '}
                  {automation.action_type === 'webhook' && 'Webhook'}
                  {automation.action_type === 'update_field' && 'Обновить поле'}
                  {automation.action_type === 'n8n' && 'n8n workflow'}
                </div>
                {automation.action_type === 'webhook' && automation.action_config && 'url' in automation.action_config && automation.action_config.url ? (
                  <code className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded mt-1 inline-block">
                    {String((automation.action_config as Record<string, unknown>).method || 'POST')} {String((automation.action_config as Record<string, unknown>).url || '')}
                  </code>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={automation.is_active}
                  onCheckedChange={(checked) => toggleMutation.mutate({ id: automation.id, isActive: checked })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteMutation.mutate(automation.id)}
                  disabled={deleteMutation.isPending}
                >
                  🗑️
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Форма создания */}
      {isCreating ? (
        <div className="p-4 border-2 border-dashed border-primary-300 dark:border-primary-700 rounded-lg bg-primary-50 dark:bg-primary-100 space-y-3">
          <h5 className="font-medium text-primary-900 dark:text-primary-100">➕ Новая автоматизация</h5>
          
          <div>
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Название</label>
            <input
              type="text"
              value={newAutomation.name}
              onChange={(e) => setNewAutomation(prev => ({ ...prev, name: e.target.value }))}
              className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-primary-500"
              placeholder="Например: Отправить в n8n при изменении статуса"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Описание (опционально)</label>
            <textarea
              value={newAutomation.description || ''}
              onChange={(e) => setNewAutomation(prev => ({ ...prev, description: e.target.value }))}
              className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-primary-500 resize-none h-20"
              placeholder="Краткое описание что делает эта автоматизация"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Триггер (когда запускать)</label>
            <select
              value={newAutomation.trigger_type}
              onChange={(e) => setNewAutomation(prev => ({ ...prev, trigger_type: e.target.value as TriggerType }))}
              className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-primary-500"
            >
              <option value="column_change">Изменение поля</option>
              <option value="row_create">Создание записи</option>
              <option value="row_delete">Удаление записи</option>
              <option value="button_click">Нажатие кнопки</option>
              <option value="schedule">По расписанию</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Действие (что делать)</label>
            <select
              value={newAutomation.action_type}
              onChange={(e) => setNewAutomation(prev => ({ ...prev, action_type: e.target.value as ActionType }))}
              className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-primary-500"
            >
              <option value="webhook">Вызов Webhook</option>
              <option value="update_field">Обновить поле</option>
              <option value="create_row">Создать запись</option>
              <option value="delete_row">Удалить запись</option>
              <option value="notification">Уведомление</option>
              <option value="n8n">n8n Workflow</option>
              <option value="api_sync">Синхронизация с API</option>
            </select>
          </div>

          {newAutomation.action_type === 'webhook' && (
            <div className="space-y-3 p-3 bg-white/50 dark:bg-gray-800/50 rounded-lg">
              <div>
                <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Webhook URL</label>
                <input
                  type="url"
                  value={(newAutomation.action_config as any)?.url || ''}
                  onChange={(e) => setNewAutomation(prev => ({
                    ...prev,
                    action_config: { ...(prev.action_config || {}), url: e.target.value }
                  }))}
                  className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-primary-500"
                  placeholder="https://n8n.example.com/webhook/..."
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">HTTP метод</label>
                <select
                  value={(newAutomation.action_config as any)?.method || 'POST'}
                  onChange={(e) => setNewAutomation(prev => ({
                    ...prev,
                    action_config: { ...(prev.action_config || {}), method: e.target.value }
                  }))}
                  className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-primary-500"
                >
                  <option value="POST">POST</option>
                  <option value="GET">GET</option>
                  <option value="PUT">PUT</option>
                </select>
              </div>
            </div>
          )}

          {newAutomation.action_type === 'api_sync' && (
            <div className="space-y-3 p-3 bg-white/50 dark:bg-gray-800/50 rounded-lg">
              <div>
                <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">API URL</label>
                <input
                  type="url"
                  value={(newAutomation.action_config as any)?.url || ''}
                  onChange={(e) => setNewAutomation(prev => ({
                    ...prev,
                    action_config: { ...(prev.action_config || {}), url: e.target.value }
                  }))}
                  className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-primary-500"
                  placeholder="https://api.example.com/v1/data"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Заголовки (JSON)</label>
                <textarea
                  value={(newAutomation.action_config as any)?.headers || '{\n  "Authorization": "Bearer YOUR_API_KEY"\n}'}
                  onChange={(e) => setNewAutomation(prev => ({
                    ...prev,
                    action_config: { ...(prev.action_config || {}), headers: e.target.value }
                  }))}
                  className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-primary-500 font-mono text-xs resize-none h-24"
                  placeholder='{"Authorization": "Bearer ..."}'
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Путь к данным</label>
                <input
                  type="text"
                  value={(newAutomation.action_config as any)?.data_path || 'data'}
                  onChange={(e) => setNewAutomation(prev => ({
                    ...prev,
                    action_config: { ...(prev.action_config || {}), data_path: e.target.value }
                  }))}
                  className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-primary-500"
                  placeholder="data или results.items"
                />
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  Путь к массиву данных в ответе API (напр. data, results.items)
                </p>
              </div>
              <div>
                <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Маппинг полей (JSON)</label>
                <textarea
                  value={(newAutomation.action_config as any)?.field_mapping || '{\n  "model_id": "id",\n  "name": "name"\n}'}
                  onChange={(e) => setNewAutomation(prev => ({
                    ...prev,
                    action_config: { ...(prev.action_config || {}), field_mapping: e.target.value }
                  }))}
                  className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-primary-500 font-mono text-xs resize-none h-24"
                  placeholder='{"колонка_в_таблице": "поле_из_api"}'
                />
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  Ключ = название колонки в таблице, значение = путь к полю в API
                </p>
              </div>
            </div>
          )}

          {newAutomation.trigger_type === 'schedule' && (
            <div className="space-y-3 p-3 bg-white/50 dark:bg-gray-800/50 rounded-lg">
              <div>
                <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Расписание (Cron)</label>
                <input
                  type="text"
                  value={(newAutomation.trigger_config as any)?.cron || '0 9 * * *'}
                  onChange={(e) => setNewAutomation(prev => ({
                    ...prev,
                    trigger_config: { ...(prev.trigger_config || {}), cron: e.target.value }
                  }))}
                  className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-primary-500 font-mono"
                  placeholder="0 9 * * *"
                />
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  Формат: минуты часы день месяц день_недели (0 9 * * * = каждый день в 9:00)
                </p>
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => setIsCreating(false)}>
              Отмена
            </Button>
            <Button 
              variant="primary" 
              onClick={handleCreate}
              disabled={createMutation.isPending || !newAutomation.name}
            >
              {createMutation.isPending ? 'Создание...' : 'Создать'}
            </Button>
          </div>
        </div>
      ) : (
        <Button 
          variant="secondary" 
          onClick={() => setIsCreating(true)}
          className="w-full"
        >
          + Новая автоматизация
        </Button>
      )}

      {projectId && (
        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
          <a 
            href={`/projects/${projectId}/automations`}
            className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
          >
            📋 Все автоматизации проекта →
          </a>
        </div>
      )}
    </div>
  );
};
