/** SettingsPanelContent — ADR-119 extracted from usePanelContent.tsx */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Save, Trash2, AlertCircle, EyeOff, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { apiClient } from '@/shared/utils/apiClient';
import { TasksSourceInlineSelector } from '../../../TasksSourceInlineSelector';
import { FilesSourceInlineSelector } from '../../../FilesSourceInlineSelector';
import type { TasksSourceConfig } from '../../../AIChatPanel.types';
import type { FavoriteTable } from '../../types';
import type { PanelContentDeps } from './PanelContentTypes';
import { useHideSystemEvents } from '../useHideSystemEvents';
import { useAllTables } from '@/features/tables/hooks/useAllTables';
import { MappingPresetSelector } from './MappingPresetSelector';
import { CHAT_SOURCE_PRESETS, detectMatchingPreset } from '../../../../utils/chatSourcePresets';

/** Look up project name by tableId via the cached useAllTables flat list. */
function useProjectForTable(tableId?: number): { name: string; icon?: string } | null {
  const { data } = useAllTables();
  if (!tableId || !data?.flat) return null;
  const t = data.flat.find(x => x.id === String(tableId));
  return t ? { name: t.projectName, icon: t.projectIcon } : null;
}

const DEFAULT_QUICK_EMOJIS = ['👍', '❤️', '😂', '🔥', '💯', '🙏', '😍', '😮'];

export function SettingsPanelContent(d: PanelContentDeps) {
  // ADR-0031 P2: per-conversation toggle to hide row_mutation system pills.
  const [hideSystemEvents, setHideSystemEvents] = useHideSystemEvents(d.currentConversationId);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 space-y-3 overflow-y-auto flex-1">
        {d.currentAgent && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="chat-operator-select" className="text-[10px] text-[var(--text-tertiary)] uppercase mb-1 block">Оператор</label>
                <select id="chat-operator-select" value={d.chatOperatorId || ''} onChange={(e) => { d.setChatOperatorId(e.target.value ? Number(e.target.value) : null); d.setChatModelId(''); }} disabled={!d.isAdminOrOwner}
                  className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30 disabled:opacity-60">
                  <option value="">— Выбрать —</option>
                  {d.operators.map(op => <option key={op.id} value={op.id}>{op.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="chat-model-select" className="text-[10px] text-[var(--text-tertiary)] uppercase mb-1 block">Модель</label>
                <select id="chat-model-select" value={d.chatModelId} onChange={(e) => d.setChatModelId(e.target.value)} disabled={!d.isAdminOrOwner || !d.chatOperatorId}
                  className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30 disabled:opacity-60">
                  <option value="">— Выбрать —</option>
                  {d.models.map((m) => <option key={m.model_id || m.id} value={m.model_id}>{m.name || m.model_id}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="chat-system-prompt" className="text-[10px] text-[var(--text-tertiary)] uppercase mb-1 block">Системный промпт</label>
              <textarea id="chat-system-prompt" value={d.chatSystemPrompt} onChange={(e) => d.setChatSystemPrompt(e.target.value)} readOnly={!d.isAdminOrOwner} rows={4}
                className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30 resize-none" placeholder="Системный промпт..." />
            </div>
            {d.isAdminOrOwner && (d.chatOperatorId !== (d.currentAgent.provider_id || d.currentAgent.operator_id) || d.chatModelId !== d.currentAgent.model || d.chatSystemPrompt !== d.currentAgent.system_prompt) && (
              <button onClick={d.saveAgentSettings} disabled={d.isSavingAgentSettings}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)] disabled:opacity-50 transition-colors">
                {d.isSavingAgentSettings ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Сохранить в агента
              </button>
            )}
          </>
        )}

        <div className="pt-2 border-t border-[var(--border-secondary)]">
          <button onClick={d.clearMessages} disabled={d.messages.length === 0}
            title="Локальный сброс: очистить view сообщений и начать новый чат. История в БД не удаляется."
            className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed">
            <Trash2 className="w-3.5 h-3.5" />Сбросить кеш чата
          </button>
        </div>

        {/* ADR-0031 P2 — Hide row_mutation system events in this chat */}
        <div className="pt-2 border-t border-[var(--border-secondary)]">
          <button
            onClick={() => setHideSystemEvents(!hideSystemEvents)}
            disabled={d.currentConversationId == null}
            className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-40 disabled:cursor-not-allowed"
            title={hideSystemEvents ? 'Системные события скрыты — нажми чтобы показать' : 'Скрыть системные события (изменения статусов, переназначения и т.п.)'}
          >
            <EyeOff className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="flex-1 text-left">Скрыть системные события</span>
            <span
              className={cn(
                'inline-block w-7 h-4 rounded-full transition-colors relative flex-shrink-0',
                hideSystemEvents ? 'bg-[var(--color-primary-500)]' : 'bg-[var(--bg-tertiary)] border border-[var(--border-primary)]'
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all',
                  hideSystemEvents ? 'left-3.5' : 'left-0.5'
                )}
              />
            </span>
          </button>
        </div>

        <div className="pt-2 border-t border-[var(--border-secondary)]">
          <DataSourcesSection d={d} />
        </div>

        {d.updateFavoritesConfig && <CustomTablesSection d={d} />}

        <div className="pt-2 border-t border-[var(--border-secondary)]">
          <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Агент по умолчанию</h4>
          <select value={d.defaultAgentId || ''} onChange={(e) => d.saveDefaultAgent(e.target.value ? Number(e.target.value) : null)} disabled={d.isSavingDefaultAgent || !d.isAdminOrOwner}
            className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30 disabled:opacity-50">
            <option value="">— Не выбран —</option>
            {d.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.icon || '🤖'} {agent.name}</option>)}
          </select>
        </div>

        {d.onSummaryAgentChange && (
        <div className="pt-2 border-t border-[var(--border-secondary)]">
          <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Summary Agent</h4>
          <p className="text-[10px] text-[var(--text-tertiary)] mb-2">Агент для генерации сводок чата</p>
          <div className="flex items-center gap-2">
            <select value={d.summaryAgentId || ''} onChange={(e) => d.onSummaryAgentChange!(e.target.value ? Number(e.target.value) : null)} disabled={d.isSavingSummaryAgent || !d.isAdminOrOwner}
              className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30 disabled:opacity-50">
              <option value="">По умолчанию (gpt-4o-mini)</option>
              {d.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.icon || '🤖'} {agent.name}</option>)}
            </select>
            {d.isSavingSummaryAgent && <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />}
          </div>
        </div>
        )}

        <div className="pt-2 border-t border-[var(--border-secondary)]">
          <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Быстрые реакции</h4>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(32px,1fr))] gap-1.5 mb-3">
            {d.quickEmojis.map((emoji, index) => (
              <div key={index} className="relative group">
                <input type="text" value={emoji} onChange={(e) => { const m = e.target.value.match(/\p{Extended_Pictographic}/gu); const last = m ? m[m.length - 1] : emoji; const ne = [...d.quickEmojis]; ne[index] = last; d.setQuickEmojis(ne); }} disabled={!d.isAdminOrOwner}
                  className="w-8 h-8 text-center text-base rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30 disabled:opacity-50" maxLength={4} />
                {d.isAdminOrOwner && d.quickEmojis.length > 1 && (
                  <button onClick={() => d.setQuickEmojis(d.quickEmojis.filter((_, i) => i !== index))}
                    className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">&times;</button>
                )}
              </div>
            ))}
            {d.isAdminOrOwner && d.quickEmojis.length < 10 && (
              <button onClick={() => d.setQuickEmojis([...d.quickEmojis, '😊'])}
                className="w-8 h-8 text-center text-base rounded-lg bg-[var(--bg-tertiary)] border border-dashed border-[var(--border-primary)] hover:border-[var(--color-primary-500)] hover:bg-[var(--color-primary-500)]/10 transition-colors flex items-center justify-center text-[var(--text-tertiary)]">+</button>
            )}
          </div>
          {d.isAdminOrOwner && (
            <div className="flex items-center gap-2">
              <button onClick={() => d.saveQuickEmojis(d.quickEmojis)} disabled={d.isSavingEmojis}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)] disabled:opacity-50 transition-colors">
                {d.isSavingEmojis ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Сохранить
              </button>
              <button onClick={() => d.setQuickEmojis(DEFAULT_QUICK_EMOJIS)}
                className="px-3 py-2 rounded-lg text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] transition-colors">Сбросить</button>
            </div>
          )}
        </div>

        <div className="pt-2 border-t border-[var(--border-secondary)]">
          <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Голосовой ввод</h4>
          <div className="space-y-2">
            {(['webSpeech', 'whisper'] as const).map(mode => (
              <label key={mode} className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
                <input type="radio" name="voiceMode" value={mode} checked={d.voiceMode === mode} onChange={() => d.setVoiceMode(mode)} className="w-4 h-4 text-[var(--color-primary-500)]" />
                <div className="flex-1">
                  <div className="text-sm text-[var(--text-primary)] flex items-center gap-2">
                    {mode === 'webSpeech' ? 'Web Speech API' : 'OpenAI Whisper'}
                    {mode === 'webSpeech' && (d.webSpeechAvailable
                      ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">Доступен</span>
                      : <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">Недоступен</span>)}
                  </div>
                  <p className="text-[10px] text-[var(--text-tertiary)]">{mode === 'webSpeech' ? 'Бесплатно, быстро, работает в браузере' : 'Высокое качество, поддержка 50+ языков, платный'}</p>
                </div>
              </label>
            ))}
          </div>
          {d.voiceError && (
            <div className="mt-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" /><span className="text-xs text-red-400">{d.voiceError}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Collapsible source card — uniform header (icon, label, name, #id, project, remove) with expand-on-click body. */
function CollapsibleCard({
  icon, title, tableId, label, onRemove, children, defaultOpen = false,
}: {
  icon: string;
  title: string;
  tableId?: number;
  label?: string;
  onRemove?: () => void;
  children?: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const Chevron = open ? ChevronDown : ChevronRight;
  const hasBody = !!children;
  const project = useProjectForTable(tableId);
  return (
    <div className="rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] overflow-hidden">
      <div className="flex items-center gap-1 p-2">
        <button
          type="button"
          onClick={() => hasBody && setOpen(o => !o)}
          disabled={!hasBody}
          className="flex items-center gap-2 flex-1 min-w-0 text-left disabled:cursor-default"
        >
          <Chevron className={cn("w-3.5 h-3.5 flex-shrink-0", hasBody ? "text-[var(--text-tertiary)]" : "opacity-0")} />
          <span className="text-base flex-shrink-0">{icon}</span>
          <div className="min-w-0 flex-1">
            {label && <div className="text-[10px] text-[var(--text-tertiary)] leading-tight uppercase">{label}</div>}
            <div className="text-sm text-[var(--text-primary)] truncate flex items-center gap-1.5">
              <span className="truncate">{title}</span>
              {tableId !== undefined && <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0">#{tableId}</span>}
            </div>
            {project && (
              <div className="text-[10px] text-[var(--text-tertiary)] truncate flex items-center gap-1 leading-tight">
                <span className="flex-shrink-0">{project.icon || '📂'}</span>
                <span className="truncate">{project.name}</span>
              </div>
            )}
          </div>
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-red-400 hover:underline flex-shrink-0 px-2 py-1"
          >Удалить</button>
        )}
      </div>
      {open && hasBody && (
        <div className="px-2 pb-2 border-t border-[var(--border-secondary)]">
          {children}
        </div>
      )}
    </div>
  );
}

/** Empty preset slot — shown when a fixed source (Tickets/Files/Documents) isn't yet picked. */
function PresetSlot({ label, icon, children }: { label: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-[var(--bg-tertiary)] border border-dashed border-[var(--border-primary)] p-2">
      <div className="flex items-center gap-2 mb-2 text-[var(--text-tertiary)]">
        <span className="text-base">{icon}</span>
        <span className="text-[10px] uppercase font-medium">{label}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}

/** Tickets-source mapping (uses already-loaded d.tasksTableColumns instead of refetching). */
function TicketsMapping({ d }: { d: PanelContentDeps }) {
  if (d.tasksTableColumns.length === 0) return null;
  const FIELDS = [
    { key: 'displayColumn',     label: 'Название',  emptyLabel: 'авто' },
    { key: 'descriptionColumn', label: 'Описание',  emptyLabel: 'нет'  },
    { key: 'statusColumn',      label: 'Статус',    emptyLabel: 'нет'  },
    { key: 'priorityColumn',    label: 'Приоритет', emptyLabel: 'нет'  },
  ] as const;

  const tasksSource = d.tasksSource!;
  const currentMapping: Record<string, string | undefined> = {
    displayColumn: tasksSource.displayColumn,
    descriptionColumn: tasksSource.descriptionColumn,
    statusColumn: tasksSource.statusColumn,
    priorityColumn: tasksSource.priorityColumn,
  };

  // Auto-detect preset id for display when user hasn't explicitly chosen one.
  const effectivePreset = tasksSource.preset
    ?? detectMatchingPreset(currentMapping, CHAT_SOURCE_PRESETS, 'tickets', tasksSource.tableId, d.tasksTableColumns)
    ?? undefined;
  const usingPreset = !!effectivePreset;

  const applyResolvedDictIds = (
    base: TasksSourceConfig,
    resolved: Record<string, string | undefined>,
  ): TasksSourceConfig => {
    const next: TasksSourceConfig = { ...base, ...resolved };
    for (const key of ['statusColumn', 'priorityColumn'] as const) {
      const colName = resolved[key];
      const dictKey = key === 'statusColumn' ? 'statusDictTableId' : 'priorityDictTableId';
      if (colName) {
        const colInfo = d.tasksTableColumns.find(c => ((c as { name?: string }).name ?? c.column_name) === colName);
        if (colInfo?.config) {
          try {
            const p = JSON.parse(colInfo.config);
            if (p?.relationTableId) next[dictKey] = p.relationTableId;
          } catch { /* ignore */ }
        }
      } else {
        next[dictKey] = undefined;
      }
    }
    return next;
  };

  return (
    <div className="pt-2 space-y-2">
      <p className="text-[10px] text-[var(--text-tertiary)] uppercase font-medium">Маппинг полей</p>
      <MappingPresetSelector
        kind="tickets"
        tableId={tasksSource.tableId}
        currentPreset={tasksSource.preset}
        currentMapping={currentMapping}
        availableColumns={d.tasksTableColumns}
        onSelectPreset={(presetId, resolved) => {
          d.updateTasksSource(applyResolvedDictIds({ ...tasksSource, preset: presetId }, resolved));
        }}
        onSelectCustom={() => {
          d.updateTasksSource({ ...tasksSource, preset: undefined });
        }}
      />
      {usingPreset ? (
        <div className="flex items-center justify-between text-[10px] text-[var(--text-tertiary)]">
          <span>Используется пресет</span>
          <button
            type="button"
            onClick={() => d.updateTasksSource({ ...tasksSource, preset: undefined })}
            className="text-[var(--color-primary-500)] hover:underline"
          >Кастомизировать</button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {FIELDS.map(({ key, label, emptyLabel }) => (
            <div key={key}>
              <label className="block text-[10px] text-[var(--text-tertiary)] mb-1">{label}</label>
              <select
                value={tasksSource[key] || ''}
                onChange={(e) => {
                  const colName = e.target.value || undefined;
                  const update: Partial<TasksSourceConfig> = { [key]: colName };
                  if ((key === 'statusColumn' || key === 'priorityColumn') && colName) {
                    const colInfo = d.tasksTableColumns.find(c => c.column_name === colName);
                    if (colInfo?.config) {
                      try {
                        const p = JSON.parse(colInfo.config);
                        if (p?.relationTableId) update[key === 'statusColumn' ? 'statusDictTableId' : 'priorityDictTableId'] = p.relationTableId;
                      } catch { /* ignore */ }
                    }
                  }
                  d.updateTasksSource({ ...tasksSource, ...update });
                }}
                className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
              >
                <option value="">— {emptyLabel} —</option>
                {d.tasksTableColumns.map(col => <option key={col.column_name} value={col.column_name}>{col.display_name || col.column_name}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Three fixed presets shown as collapsible cards: Tickets / Files / Documents. */
function DataSourcesSection({ d }: { d: PanelContentDeps }) {
  const fav = d.favoritesConfig;
  const update = d.updateFavoritesConfig;
  return (
    <div>
      <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Источники данных</h4>
      <div className="space-y-2">
        {d.tasksSource ? (
          <CollapsibleCard
            icon={d.tasksSource.tableIcon || '📋'}
            title={d.tasksSource.tableName}
            tableId={d.tasksSource.tableId}
            label="Tickets"
            onRemove={() => d.updateTasksSource(undefined)}
          >
            <TicketsMapping d={d} />
          </CollapsibleCard>
        ) : (
          <PresetSlot label="Tickets" icon="📋">
            <TasksSourceInlineSelector defaultSpaceId={d.effectiveSpaceId} onSelect={(c) => d.updateTasksSource(c)} onCancel={() => {}} showHeader={false} />
          </PresetSlot>
        )}
        {d.filesSource ? (
          <CollapsibleCard
            icon={d.filesSource.tableIcon || '📁'}
            title={d.filesSource.tableName}
            tableId={d.filesSource.tableId}
            label="Files"
            onRemove={() => d.updateFilesSource(undefined)}
          />
        ) : (
          <PresetSlot label="Files" icon="📁">
            <FilesSourceInlineSelector defaultSpaceId={d.effectiveSpaceId} onSelect={(c) => d.updateFilesSource(c)} onCancel={() => {}} showHeader={false} />
          </PresetSlot>
        )}
        {update && (fav?.documents ? (
          <CollapsibleCard
            icon={fav.documents.tableIcon || '📄'}
            title={fav.documents.tableName}
            tableId={fav.documents.tableId}
            label="Documents"
            onRemove={() => update({ ...fav, documents: null })}
          >
            <FavoriteTableMapping table={fav.documents} kind="documents" onChange={(updated) => update({ ...fav, documents: updated })} />
          </CollapsibleCard>
        ) : (
          <PresetSlot label="Documents" icon="📄">
            <FilesSourceInlineSelector
              defaultSpaceId={d.effectiveSpaceId}
              onSelect={(config) => update({ ...(fav || {}), documents: { tableId: config.tableId, tableName: config.tableName, tableIcon: config.tableIcon } })}
              onCancel={() => {}}
              showHeader={false}
            />
          </PresetSlot>
        ))}
      </div>
    </div>
  );
}

/** Additional custom tables — collapsible cards each with field mapping. */
function CustomTablesSection({ d }: { d: PanelContentDeps }) {
  const [showAddPicker, setShowAddPicker] = React.useState(false);
  const fav = d.favoritesConfig;
  const update = d.updateFavoritesConfig!;
  const customs = fav?.custom || [];
  return (
    <div className="pt-2 border-t border-[var(--border-secondary)]">
      <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Дополнительные таблицы</h4>
      <p className="text-[10px] text-[var(--text-tertiary)] mb-2">Табы в popup-е прикрепления чата</p>
      {customs.length > 0 && (
        <div className="space-y-2 mb-2">
          {customs.map(c => (
            <CollapsibleCard
              key={c.tableId}
              icon={c.tableIcon || '📋'}
              title={c.tableName}
              tableId={c.tableId}
              onRemove={() => update({ ...(fav || {}), custom: customs.filter(x => x.tableId !== c.tableId) })}
            >
              <FavoriteTableMapping
                table={c}
                onChange={(updated) => update({
                  ...(fav || {}),
                  custom: customs.map(x => x.tableId === c.tableId ? updated : x),
                })}
              />
            </CollapsibleCard>
          ))}
        </div>
      )}
      {showAddPicker ? (
        <FilesSourceInlineSelector
          defaultSpaceId={d.effectiveSpaceId}
          onSelect={(config) => {
            if (!customs.some(x => x.tableId === config.tableId)) {
              update({ ...(fav || {}), custom: [...customs, { tableId: config.tableId, tableName: config.tableName, tableIcon: config.tableIcon }] });
            }
            setShowAddPicker(false);
          }}
          onCancel={() => setShowAddPicker(false)}
          showHeader={false}
        />
      ) : (
        <button
          onClick={() => setShowAddPicker(true)}
          className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] transition-colors border border-dashed border-[var(--border-primary)]"
        >+ Добавить таблицу</button>
      )}
    </div>
  );
}

type FavoriteMappingField = {
  key: 'iconColumn' | 'displayColumn' | 'descriptionColumn' | 'statusColumn' | 'priorityColumn' | 'categoryColumn';
  label: string;
  emptyLabel: string;
};

const DOCUMENTS_FIELDS: readonly FavoriteMappingField[] = [
  { key: 'iconColumn',        label: 'Иконка',    emptyLabel: 'нет'  },
  { key: 'displayColumn',     label: 'Название',  emptyLabel: 'авто' },
  { key: 'descriptionColumn', label: 'Описание',  emptyLabel: 'нет'  },
  { key: 'statusColumn',      label: 'Статус',    emptyLabel: 'нет'  },
  { key: 'categoryColumn',    label: 'Категория', emptyLabel: 'нет'  },
];

const CUSTOM_FIELDS: readonly FavoriteMappingField[] = [
  { key: 'displayColumn',     label: 'Название',  emptyLabel: 'авто' },
  { key: 'descriptionColumn', label: 'Описание',  emptyLabel: 'нет'  },
  { key: 'statusColumn',      label: 'Статус',    emptyLabel: 'нет'  },
  { key: 'priorityColumn',    label: 'Приоритет', emptyLabel: 'нет'  },
];

const RELATION_DICT_KEY: Partial<Record<FavoriteMappingField['key'], keyof FavoriteTable>> = {
  statusColumn: 'statusDictTableId',
  priorityColumn: 'priorityDictTableId',
  categoryColumn: 'categoryDictTableId',
};

/** Column-mapping editor for a favorite table. `kind` switches the field set: documents (icon+category) vs custom (priority). */
function FavoriteTableMapping({
  table, onChange, kind = 'custom',
}: {
  table: FavoriteTable;
  onChange: (t: FavoriteTable) => void;
  kind?: 'documents' | 'custom';
}) {
  const { data: columns = [] } = useQuery<Array<{ column_name: string; display_name: string; type: string; config?: string }>>({
    queryKey: ['favorite-table-columns', table.tableId],
    queryFn: async () => {
      const response = await apiClient.get<{
        success: boolean;
        data: Array<{ column_name: string; display_name: string; type: string; config?: string }>;
      }>(`/tables/${table.tableId}/columns`);
      return response.success ? (response.data || []) : [];
    },
    enabled: !!table.tableId,
    staleTime: 5 * 60_000,
  });

  if (columns.length === 0) return null;

  const fields = kind === 'documents' ? DOCUMENTS_FIELDS : CUSTOM_FIELDS;

  const currentMapping: Record<string, string | undefined> = {};
  for (const f of fields) currentMapping[f.key] = table[f.key] as string | undefined;

  const effectivePreset = table.preset
    ?? detectMatchingPreset(currentMapping, CHAT_SOURCE_PRESETS, kind, table.tableId, columns)
    ?? undefined;
  const usingPreset = !!effectivePreset;

  const applyResolvedDictIds = (base: FavoriteTable, resolved: Record<string, string | undefined>): FavoriteTable => {
    const next: FavoriteTable = { ...base };
    // First clear all field-keys we're managing, then apply resolved values.
    for (const f of fields) {
      (next as unknown as Record<string, unknown>)[f.key] = resolved[f.key];
    }
    // Then resolve dict ids for relation columns.
    for (const f of fields) {
      const dictKey = RELATION_DICT_KEY[f.key];
      if (!dictKey) continue;
      const colName = resolved[f.key];
      if (colName) {
        const colInfo = columns.find(c => ((c as { name?: string }).name ?? c.column_name) === colName);
        if (colInfo?.config) {
          try {
            const p = JSON.parse(colInfo.config);
            if (p?.relationTableId) (next as unknown as Record<string, unknown>)[dictKey] = p.relationTableId;
          } catch { /* ignore */ }
        }
      } else {
        (next as unknown as Record<string, unknown>)[dictKey] = undefined;
      }
    }
    return next;
  };

  return (
    <div className="pt-2 space-y-2">
      <p className="text-[10px] text-[var(--text-tertiary)] uppercase font-medium">Маппинг полей</p>
      <MappingPresetSelector
        kind={kind}
        tableId={table.tableId}
        currentPreset={table.preset}
        currentMapping={currentMapping}
        availableColumns={columns}
        onSelectPreset={(presetId, resolved) => {
          onChange(applyResolvedDictIds({ ...table, preset: presetId }, resolved));
        }}
        onSelectCustom={() => {
          onChange({ ...table, preset: undefined });
        }}
      />
      {usingPreset ? (
        <div className="flex items-center justify-between text-[10px] text-[var(--text-tertiary)]">
          <span>Используется пресет</span>
          <button
            type="button"
            onClick={() => onChange({ ...table, preset: undefined })}
            className="text-[var(--color-primary-500)] hover:underline"
          >Кастомизировать</button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {fields.map(({ key, label, emptyLabel }) => (
            <div key={key}>
              <label className="block text-[10px] text-[var(--text-tertiary)] mb-1">{label}</label>
              <select
                value={(table[key] as string | undefined) || ''}
                onChange={(e) => {
                  const colName = e.target.value || undefined;
                  const next: FavoriteTable = { ...table, [key]: colName };
                  const dictKey = RELATION_DICT_KEY[key];
                  if (dictKey && colName) {
                    const colInfo = columns.find(c => c.column_name === colName);
                    if (colInfo?.config) {
                      try {
                        const p = JSON.parse(colInfo.config);
                        if (p?.relationTableId) (next as unknown as Record<string, unknown>)[dictKey] = p.relationTableId;
                      } catch { /* ignore */ }
                    }
                  }
                  onChange(next);
                }}
                className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
              >
                <option value="">— {emptyLabel} —</option>
                {columns.map(col => <option key={col.column_name} value={col.column_name}>{col.display_name || col.column_name}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
