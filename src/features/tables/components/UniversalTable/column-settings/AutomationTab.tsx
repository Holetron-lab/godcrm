import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Switch } from '@/shared/components/ui';
import { automationsApi, Automation } from '@/features/automations/api/automationsApi';
import { useCreateAutomation } from '@/features/automations/api/useAutomations';
import { AutomationModal } from '@/features/automations/components/AutomationModal';
import { TRIGGER_LABELS, ACTION_LABELS } from '@/features/automations/components/automationConstants';
import type { AutomationModel, TriggerType, ActionType } from '@/features/automations/types/automation.types';
import { ColumnModel } from '@/features/tables/types/table.types';
import { isSystemColumnId } from '@/features/tables/utils/systemColumns';
import { showToast } from '@/shared/hooks/useToast';
import { Zap } from 'lucide-react';

interface AutomationTabProps {
  draft: ColumnModel;
  tableId?: number;
  projectId?: number;
  tableName?: string;
  language?: string;
}

/**
 * Automations reference columns by *key* (`column_name`), not by numeric id:
 * the engine gates `row_update` on `trigger_config.watch_field` and
 * `update_field` writes `action_config.column_id`. Older UI wrote
 * `trigger_config.columnId` (numeric id), so both spellings are accepted.
 */
const TRIGGER_COLUMN_KEYS = ['watch_field', 'columnId', 'column_id', 'buttonColumnId'] as const;
const ACTION_COLUMN_KEYS = ['column_id', 'columnId', 'targetColumnId'] as const;

const pick = (cfg: Record<string, unknown> | undefined, keys: readonly string[]): string[] =>
  keys.map(k => cfg?.[k]).filter((v): v is string | number => typeof v === 'string' || typeof v === 'number').map(String);

export const automationColumnRefs = (automation: Automation): { trigger: string[]; action: string[] } => ({
  trigger: pick(automation.trigger_config, TRIGGER_COLUMN_KEYS),
  action: pick(automation.action_config, ACTION_COLUMN_KEYS),
});

export const automationTouchesColumn = (automation: Automation, column: Pick<ColumnModel, 'id' | 'name'>): boolean => {
  const refs = automationColumnRefs(automation);
  const ids = new Set([column.name, String(column.id)]);
  return [...refs.trigger, ...refs.action].some(ref => ids.has(ref));
};

const label = (map: Record<string, { ru: string; en: string }>, key: string, language: string): string =>
  map[key] ? (language === 'ru' ? map[key].ru : map[key].en) : key;

export const AutomationTab: React.FC<AutomationTabProps> = ({ draft, tableId, projectId, tableName, language = 'ru' }) => {
  const [showModal, setShowModal] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ['automations', 'table', tableId];
  const isSystemColumn = isSystemColumnId(draft.id);

  const { data: automations = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => tableId ? automationsApi.getByTable(tableId) : Promise.resolve([]),
    enabled: !!tableId,
  });

  const columnAutomations = automations.filter(auto => automationTouchesColumn(auto, draft));

  // Same proven path as AutomationsPage; it invalidates ['automations'], which covers our key.
  const createMutation = useCreateAutomation();

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      automationsApi.toggle(id, isActive, projectId || 0),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      showToast('Статус обновлен');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => automationsApi.delete(id, projectId || 0),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      showToast('Автоматизация удалена');
    }
  });

  const handleModalSave = (data: Partial<AutomationModel>) => {
    createMutation.mutate(
      {
        name: data.name!,
        tableId: data.tableId!,
        triggerType: data.triggerType as TriggerType,
        triggerConfig: data.triggerConfig || {},
        actionType: data.actionType as ActionType,
        actionConfig: data.actionConfig || {},
        description: data.description,
        isActive: data.isActive,
      },
      {
        onSuccess: () => showToast('Автоматизация создана', 'success'),
        onError: (err) => showToast(err.message || 'Ошибка создания автоматизации', 'error'),
      }
    );
    setShowModal(false);
  };

  if (isLoading) {
    return <div className="p-8 text-center text-[var(--text-tertiary)]">Загрузка...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="p-3 bg-[var(--bg-tertiary)] rounded-lg text-sm border border-[var(--border-primary)]">
        <p className="font-medium text-[var(--text-primary)] mb-1">💡 Как работают автоматизации</p>
        <p className="text-[var(--text-secondary)] text-xs">
          Автоматизации позволяют выполнять действия при изменении значения колонки. Настройте триггер (изменение, создание, удаление) и действие (webhook, обновление поля, уведомление).
        </p>
      </div>

      <div className="space-y-3">
        {columnAutomations.length === 0 && (
          <div className="p-8 text-center text-[var(--text-tertiary)] border-2 border-dashed border-[var(--border-primary)] rounded-lg">
            <Zap className="w-12 h-12 mx-auto mb-2 opacity-50" aria-hidden="true" />
            <p>Нет автоматизаций для этой колонки</p>
          </div>
        )}

        {columnAutomations.map(automation => {
          const refs = automationColumnRefs(automation);
          return (
            <div
              key={automation.id}
              className={`p-4 rounded-lg border bg-[var(--bg-secondary)] border-[var(--border-primary)] ${automation.is_active ? '' : 'opacity-60'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[var(--text-primary)] mb-1 flex items-center gap-2">
                    <Zap className={`w-4 h-4 shrink-0 ${automation.is_active ? 'text-emerald-500' : 'text-[var(--text-tertiary)]'}`} aria-hidden="true" />
                    <span className="truncate">{automation.name}</span>
                  </div>
                  {automation.description && (
                    <p className="text-xs text-[var(--text-tertiary)] mb-1 truncate">{automation.description}</p>
                  )}
                  <div className="text-sm text-[var(--text-secondary)]">
                    {label(TRIGGER_LABELS, automation.trigger_type, language)}
                    {' → '}
                    {label(ACTION_LABELS, automation.action_type, language)}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1 text-xs">
                    {refs.trigger.map(ref => (
                      <code key={`t-${ref}`} className="bg-[var(--bg-tertiary)] px-2 py-0.5 rounded">
                        {language === 'ru' ? 'следит' : 'watches'}: {ref}
                      </code>
                    ))}
                    {refs.action.map(ref => (
                      <code key={`a-${ref}`} className="bg-[var(--bg-tertiary)] px-2 py-0.5 rounded">
                        {language === 'ru' ? 'пишет' : 'writes'}: {ref}
                      </code>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch
                    checked={automation.is_active}
                    onCheckedChange={(checked) => toggleMutation.mutate({ id: automation.id, isActive: checked })}
                    aria-label={automation.is_active ? 'Выключить автоматизацию' : 'Включить автоматизацию'}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteMutation.mutate(automation.id)}
                    disabled={deleteMutation.isPending}
                    aria-label="Удалить автоматизацию"
                  >
                    🗑️
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {isSystemColumn ? (
        <p className="text-xs text-[var(--text-tertiary)]">
          Системные колонки «Создано» и «Обновлено» заполняет сервер, триггер по ним не срабатывает.
        </p>
      ) : (
        <Button
          variant="secondary"
          onClick={() => setShowModal(true)}
          disabled={!tableId}
          className="w-full"
        >
          + Новая автоматизация
        </Button>
      )}

      {showModal && tableId && (
        <AutomationModal
          defaults={{
            name: `${tableName || 'Таблица'}: ${draft.displayName || draft.name}`,
            triggerType: 'row_update',
            triggerConfig: { watch_field: draft.name },
          }}
          tableId={String(tableId)}
          projectId={projectId}
          onClose={() => setShowModal(false)}
          onSave={handleModalSave}
          language={language}
        />
      )}

      {projectId && (
        <div className="pt-4 border-t border-[var(--border-primary)]">
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
