import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useProjectTables } from '@/features/projects/hooks/useProjectTables';
import { useSpacesQuery } from '@/features/spaces/hooks/useSpacesQuery';
import { useProjectStore } from '@/features/projects/store/projectStore';
import type { AutomationModel, TriggerType, ActionType } from '../types/automation.types';
import { TRIGGER_LABELS, ACTION_LABELS } from './automationConstants';

interface AutomationModalProps {
  automation?: AutomationModel | null;
  tableId?: string;
  projectId?: number | string;
  spaceId?: number | null;
  onClose: () => void;
  onSave: (data: Partial<AutomationModel>) => void;
  language: string;
}

export function AutomationModal({ automation, tableId: initialTableId, projectId: initialProjectId, spaceId: initialSpaceId, onClose, onSave, language }: AutomationModalProps) {
  const t = (ru: string, en: string) => language === 'ru' ? ru : en;
  const [name, setName] = useState(automation?.name || '');
  const [description, setDescription] = useState(automation?.description || '');
  const [selectedTableId, setSelectedTableId] = useState(automation?.tableId || initialTableId || '');
  const [triggerType, setTriggerType] = useState<TriggerType>(automation?.triggerType || 'column_change');
  const [actionType, setActionType] = useState<ActionType>(automation?.actionType || 'webhook');

  // Space and Project selection
  const [selectedSpaceId, setSelectedSpaceId] = useState<number | null>(initialSpaceId ?? null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    typeof initialProjectId === 'number' ? initialProjectId :
    typeof initialProjectId === 'string' ? parseInt(initialProjectId) : null
  );

  // Load spaces and projects
  const { data: spaces = [] } = useSpacesQuery();
  const allProjects = useProjectStore((state) => state.projects);

  // Filter projects by selected space
  const filteredProjects = useMemo(() => {
    if (!selectedSpaceId) return allProjects;
    return allProjects.filter(p => p.space_id === selectedSpaceId);
  }, [allProjects, selectedSpaceId]);

  // Webhook config
  const [webhookUrl, setWebhookUrl] = useState(
    (automation?.actionConfig as { url?: string })?.url || ''
  );
  const [webhookMethod, setWebhookMethod] = useState(
    (automation?.actionConfig as { method?: string })?.method || 'POST'
  );

  // API Sync config
  const actionConfig = automation?.actionConfig as {
    url?: string;
    headers?: Record<string, string>;
    data_path?: string;
    field_mapping?: Record<string, string>;
  } | undefined;

  const [apiSyncUrl, setApiSyncUrl] = useState(actionConfig?.url || '');
  const [apiSyncHeaders, setApiSyncHeaders] = useState(
    actionConfig?.headers ? JSON.stringify(actionConfig.headers, null, 2) : '{\n  "Authorization": "Bearer YOUR_API_KEY"\n}'
  );
  const [apiSyncDataPath, setApiSyncDataPath] = useState(actionConfig?.data_path || 'data');
  const [apiSyncMapping, setApiSyncMapping] = useState(
    actionConfig?.field_mapping ? JSON.stringify(actionConfig.field_mapping, null, 2) : '{\n  "model_id": "id",\n  "name": "name"\n}'
  );

  // Formula config
  const formulaConfig = automation?.actionConfig as { column_id?: string; formula?: string } | undefined;
  const [formulaColumn, setFormulaColumn] = useState(formulaConfig?.column_id || '');
  const [formulaExpr, setFormulaExpr] = useState(formulaConfig?.formula || '');

  // Schedule config
  const triggerConfig = automation?.triggerConfig as { cron?: string } | undefined;
  const [scheduleCron, setScheduleCron] = useState(triggerConfig?.cron || '0 9 * * *');

  // Load tables for selected project
  const { data: tables = [] } = useProjectTables(selectedProjectId);

  const handleSave = () => {
    let finalActionConfig: Record<string, unknown> = {};

    if (actionType === 'webhook') {
      finalActionConfig = { url: webhookUrl, method: webhookMethod };
    } else if (actionType === 'api_sync') {
      try {
        finalActionConfig = {
          url: apiSyncUrl,
          headers: JSON.parse(apiSyncHeaders),
          data_path: apiSyncDataPath,
          field_mapping: JSON.parse(apiSyncMapping),
        };
      } catch (e) {
        alert(t('Ошибка в JSON конфигурации', 'Invalid JSON configuration'));
        return;
      }
    } else if (actionType === 'formula') {
      finalActionConfig = { column_id: formulaColumn.trim(), formula: formulaExpr.trim() };
    }

    let finalTriggerConfig: Record<string, unknown> = {};
    if (triggerType === 'schedule') {
      finalTriggerConfig = { cron: scheduleCron };
    }

    const data: Partial<AutomationModel> = {
      name,
      description,
      tableId: selectedTableId,
      triggerType,
      triggerConfig: finalTriggerConfig,
      actionType,
      actionConfig: finalActionConfig,
      isActive: automation?.isActive ?? true,
    };
    onSave(data);
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl w-full max-w-xl flex flex-col" style={{ maxHeight: 'calc(100vh - 100px)' }}>
        {/* Fixed Header */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-[var(--border-primary)]">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">
            {automation ? t('Редактировать автоматизацию', 'Edit Automation') : t('Новая автоматизация', 'New Automation')}
          </h2>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            {t('Настройте триггер и действие для автоматизации', 'Configure trigger and action for automation')}
          </p>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-4">
            {/* Space and Project selectors */}
            <div className="grid grid-cols-2 gap-3">
              {spaces.length > 0 && (
                <div>
                  <label className="block text-sm text-[var(--text-secondary)] mb-1">{t('Пространство', 'Space')}</label>
                  <select
                    value={selectedSpaceId ?? ''}
                    onChange={(e) => {
                      const val = e.target.value ? parseInt(e.target.value) : null;
                      setSelectedSpaceId(val);
                      setSelectedProjectId(null);
                      setSelectedTableId('');
                    }}
                    className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50"
                  >
                    <option value="" className="bg-[var(--bg-secondary)]">{t('Все пространства', 'All spaces')}</option>
                    {spaces.map((space) => (
                      <option key={space.id} value={space.id} className="bg-[var(--bg-secondary)]">
                        {space.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {filteredProjects.length > 0 && (
                <div>
                  <label className="block text-sm text-[var(--text-secondary)] mb-1">{t('Проект', 'Project')}</label>
                  <select
                    value={selectedProjectId ?? ''}
                    onChange={(e) => {
                      const val = e.target.value ? parseInt(e.target.value) : null;
                      setSelectedProjectId(val);
                      setSelectedTableId('');
                    }}
                    className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50"
                  >
                    <option value="" className="bg-[var(--bg-secondary)]">{t('Выберите проект', 'Select project')}</option>
                    {filteredProjects.map((project) => (
                      <option key={project.id} value={project.id} className="bg-[var(--bg-secondary)]">
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Table selector */}
            {selectedProjectId && tables.length > 0 && (
              <div>
                <label className="block text-sm text-[var(--text-secondary)] mb-1">{t('Таблица', 'Table')}</label>
                <select
                  value={selectedTableId}
                  onChange={(e) => setSelectedTableId(e.target.value)}
                  className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50"
                >
                  <option value="" className="bg-[var(--bg-secondary)]">{t('Выберите таблицу', 'Select table')}</option>
                  {tables.map((table) => (
                    <option key={table.id} value={table.id} className="bg-[var(--bg-secondary)]">
                      {table.displayName || table.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">{t('Название', 'Name')}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50"
                placeholder={t('Например: Отправить в n8n при изменении статуса', 'E.g., Send to n8n on status change')}
              />
            </div>

            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">{t('Описание (опционально)', 'Description (optional)')}</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50 resize-none h-20"
                placeholder={t('Краткое описание что делает эта автоматизация', 'Brief description of what this automation does')}
              />
            </div>

            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">{t('Триггер (когда запускать)', 'Trigger (when to run)')}</label>
              <select
                value={triggerType}
                onChange={(e) => setTriggerType(e.target.value as TriggerType)}
                className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50"
              >
                {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
                  <option key={value} value={value} className="bg-[var(--bg-secondary)]">
                    {label[language as 'ru' | 'en'] || label.en}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">{t('Действие (что делать)', 'Action (what to do)')}</label>
              <select
                value={actionType}
                onChange={(e) => setActionType(e.target.value as ActionType)}
                className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50"
              >
                {Object.entries(ACTION_LABELS).map(([value, label]) => (
                  <option key={value} value={value} className="bg-[var(--bg-secondary)]">
                    {label[language as 'ru' | 'en'] || label.en}
                  </option>
                ))}
              </select>
            </div>

            {actionType === 'webhook' && (
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
                  <label className="block text-sm text-[var(--text-secondary)] mb-1">{t('HTTP метод', 'HTTP method')}</label>
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

            {actionType === 'api_sync' && (
              <div className="space-y-3 p-3 bg-[var(--bg-tertiary)] rounded-lg">
                <div>
                  <label className="block text-sm text-[var(--text-secondary)] mb-1">API URL</label>
                  <input
                    type="url"
                    value={apiSyncUrl}
                    onChange={(e) => setApiSyncUrl(e.target.value)}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50"
                    placeholder="https://api.example.com/v1/data"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[var(--text-secondary)] mb-1">
                    {t('Заголовки (JSON)', 'Headers (JSON)')}
                  </label>
                  <textarea
                    value={apiSyncHeaders}
                    onChange={(e) => setApiSyncHeaders(e.target.value)}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50 font-mono text-xs resize-none h-24"
                    placeholder='{"Authorization": "Bearer ..."}'
                  />
                </div>
                <div>
                  <label className="block text-sm text-[var(--text-secondary)] mb-1">
                    {t('Путь к данным', 'Data path')}
                  </label>
                  <input
                    type="text"
                    value={apiSyncDataPath}
                    onChange={(e) => setApiSyncDataPath(e.target.value)}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50"
                    placeholder="data или results.items"
                  />
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">
                    {t('Путь к массиву данных в ответе API (напр. data, results.items)', 'Path to data array in API response')}
                  </p>
                </div>
                <div>
                  <label className="block text-sm text-[var(--text-secondary)] mb-1">
                    {t('Маппинг полей (JSON)', 'Field mapping (JSON)')}
                  </label>
                  <textarea
                    value={apiSyncMapping}
                    onChange={(e) => setApiSyncMapping(e.target.value)}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50 font-mono text-xs resize-none h-24"
                    placeholder='{"колонка_в_таблице": "поле_из_api"}'
                  />
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">
                    {t('Ключ = название колонки в таблице, значение = путь к полю в API', 'Key = table column name, value = API field path')}
                  </p>
                </div>
              </div>
            )}

            {actionType === 'formula' && (
              <div className="space-y-3 p-3 bg-[var(--bg-tertiary)] rounded-lg">
                <div>
                  <label className="block text-sm text-[var(--text-secondary)] mb-1">
                    {t('Целевое поле (колонка)', 'Target field (column)')}
                  </label>
                  <input
                    type="text"
                    value={formulaColumn}
                    onChange={(e) => setFormulaColumn(e.target.value)}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50 font-mono"
                    placeholder={t('например: total', 'e.g., total')}
                  />
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">
                    {t('Ключ колонки, куда записать результат', 'Column key where the result is written')}
                  </p>
                </div>
                <div>
                  <label className="block text-sm text-[var(--text-secondary)] mb-1">
                    {t('Формула', 'Formula')}
                  </label>
                  <textarea
                    value={formulaExpr}
                    onChange={(e) => setFormulaExpr(e.target.value)}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50 font-mono text-xs resize-none h-20"
                    placeholder="{{price}} * {{quantity}}"
                  />
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">
                    {t('Ссылайтесь на поля через {{колонка}}. Арифметика ( + − * / ) или текстовый шаблон.', 'Reference fields via {{column}}. Arithmetic ( + − * / ) or a text template.')}
                  </p>
                </div>
              </div>
            )}

            {triggerType === 'schedule' && (
              <div className="space-y-3 p-3 bg-[var(--bg-tertiary)] rounded-lg">
                <div>
                  <label className="block text-sm text-[var(--text-secondary)] mb-1">
                    {t('Расписание (Cron)', 'Schedule (Cron)')}
                  </label>
                  <input
                    type="text"
                    value={scheduleCron}
                    onChange={(e) => setScheduleCron(e.target.value)}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-primary-500/50 font-mono"
                    placeholder="0 9 * * *"
                  />
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">
                    {t('Формат: минуты часы день месяц день_недели (0 9 * * * = каждый день в 9:00)', 'Format: min hour day month weekday')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Fixed Footer */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
            >
              {t('Отмена', 'Cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || !selectedTableId}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              {automation ? t('Сохранить', 'Save') : t('Создать', 'Create')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
