/**
 * SettingsPanel — extracted from AIChatPanel.renderSettingsPanel()
 * Settings panel with three tabs: AI, People, Widget.
 */

import React from 'react';
import {
  Bot,
  User,
  Users,
  Loader2,
  Save,
  Trash2,
  Settings,
  Inbox,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { ContextSettingsSection } from '../components/AIChatPanel/components/ChatPanels/ContextSettingsSection';
import type { ContextSettings } from '../components/AIChatPanel/types';
import type { AIAgent, ChatMessage } from '../types';

type PanelTab = 'none' | 'contacts' | 'ai-agents' | 'tasks' | 'settings' | 'inbox';
type SettingsTab = 'ai' | 'people' | 'widget';
type VoiceMode = 'webSpeech' | 'whisper';

interface ChatPartner {
  type: string;
  id: number;
  name: string;
  avatarUrl?: string;
  email?: string;
  icon?: string | null;
  participants?: Array<{ id: number; name: string; type: 'user' | 'agent' }>;
}

interface TasksSourceConfig {
  tableId: number;
  tableName: string;
  tableIcon?: string;
  displayColumn?: string;
  descriptionColumn?: string;
  statusColumn?: string;
  priorityColumn?: string;
  statusDictTableId?: number;
  priorityDictTableId?: number;
}

interface FilesSourceConfig {
  tableId: number;
  tableName: string;
  tableIcon?: string;
  projectId?: number;
}

interface InboxConversation {
  id: number;
  title: string | null;
  type: string;
  unread_count: number;
  updated_at: string;
  participants: Array<{ user_id: number; name: string }>;
}

interface TableColumn {
  column_name: string;
  display_name?: string;
  config?: string;
}

interface TasksSourceInlineSelectorProps {
  defaultSpaceId: number | null;
  onSelect: (config: TasksSourceConfig) => void;
  onCancel: () => void;
  showHeader?: boolean;
}

interface FilesSourceInlineSelectorProps {
  defaultSpaceId: number | null;
  onSelect: (config: FilesSourceConfig) => void;
  onCancel: () => void;
  showHeader?: boolean;
}

export interface SettingsPanelProps {
  settingsTab: SettingsTab;
  setSettingsTab: (tab: SettingsTab) => void;
  // AI tab
  currentAgent: AIAgent | null;
  agents: AIAgent[];
  handleAgentSelect: (agent: AIAgent) => void;
  chatOperatorId: number | null;
  setChatOperatorId: (id: number | null) => void;
  chatModelId: string;
  setChatModelId: (id: string) => void;
  chatSystemPrompt: string;
  setChatSystemPrompt: (prompt: string) => void;
  operators: Array<{ id: number; name: string }>;
  models: Array<{ id: number; name: string; model_id?: string }>;
  isAdminOrOwner: boolean;
  saveAgentSettings: () => void;
  isSavingAgentSettings: boolean;
  messages: ChatMessage[];
  clearMessages: () => void;
  contextSettings: ContextSettings;
  handleContextSettingsChange: (settings: ContextSettings) => void;
  saveContextSettings: () => void;
  isSavingContextSettings: boolean;
  // People tab
  chatPartner: ChatPartner | null;
  totalUnreadCount: number;
  inboxConversations: InboxConversation[];
  setChatMode: (mode: 'ai' | 'people') => void;
  setActivePanel: (panel: PanelTab) => void;
  refetchInbox: () => void;
  // Widget tab
  tasksSource: TasksSourceConfig | undefined;
  updateTasksSource: (config: TasksSourceConfig | undefined) => void;
  tasksTableColumns: TableColumn[];
  filesSource: FilesSourceConfig | undefined;
  updateFilesSource: (config: FilesSourceConfig | undefined) => void;
  effectiveSpaceId: number | null;
  defaultAgentId: number | null;
  saveDefaultAgent: (agentId: number | null) => void;
  isSavingDefaultAgent: boolean;
  quickEmojis: string[];
  setQuickEmojis: React.Dispatch<React.SetStateAction<string[]>>;
  saveQuickEmojis: (emojis: string[]) => void;
  isSavingEmojis: boolean;
  DEFAULT_QUICK_EMOJIS: string[];
  voiceMode: VoiceMode;
  setVoiceMode: (mode: VoiceMode) => void;
  webSpeechAvailable: boolean;
  voiceError: string | null;
  TasksSourceInlineSelector: React.ComponentType<TasksSourceInlineSelectorProps>;
  FilesSourceInlineSelector: React.ComponentType<FilesSourceInlineSelectorProps>;
}

export function SettingsPanel({
  settingsTab,
  setSettingsTab,
  // AI tab
  currentAgent,
  agents,
  handleAgentSelect,
  chatOperatorId,
  setChatOperatorId,
  chatModelId,
  setChatModelId,
  chatSystemPrompt,
  setChatSystemPrompt,
  operators,
  models,
  isAdminOrOwner,
  saveAgentSettings,
  isSavingAgentSettings,
  messages,
  clearMessages,
  contextSettings,
  handleContextSettingsChange,
  saveContextSettings,
  isSavingContextSettings,
  // People tab
  chatPartner,
  totalUnreadCount,
  inboxConversations,
  setChatMode,
  setActivePanel,
  refetchInbox,
  // Widget tab
  tasksSource,
  updateTasksSource,
  tasksTableColumns,
  filesSource,
  updateFilesSource,
  effectiveSpaceId,
  defaultAgentId,
  saveDefaultAgent,
  isSavingDefaultAgent,
  quickEmojis,
  setQuickEmojis,
  saveQuickEmojis,
  isSavingEmojis,
  DEFAULT_QUICK_EMOJIS,
  voiceMode,
  setVoiceMode,
  webSpeechAvailable,
  voiceError,
  TasksSourceInlineSelector,
  FilesSourceInlineSelector,
}: SettingsPanelProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Settings Tabs: AI | People | Widget */}
      <div className="flex border-b border-[var(--border-secondary)]">
        <button
          onClick={() => setSettingsTab('ai')}
          className={cn(
            "flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1",
            settingsTab === 'ai'
              ? "text-purple-500 border-b-2 border-purple-500"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          )}
        >
          <Bot className="w-3 h-3" />
          AI
        </button>
        <button
          onClick={() => setSettingsTab('people')}
          className={cn(
            "flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1",
            settingsTab === 'people'
              ? "text-blue-500 border-b-2 border-blue-500"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          )}
        >
          <Users className="w-3 h-3" />
          Люди
        </button>
        <button
          onClick={() => setSettingsTab('widget')}
          className={cn(
            "flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1",
            settingsTab === 'widget'
              ? "text-[var(--color-primary-500)] border-b-2 border-[var(--color-primary-500)]"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          )}
        >
          <Settings className="w-3 h-3" />
          Виджет
        </button>
      </div>

      {/* AI Settings Tab */}
      {settingsTab === 'ai' && (
        <div className="p-3 space-y-3 overflow-y-auto flex-1">
          <div className="flex items-center gap-2 p-2 rounded-lg bg-[var(--bg-tertiary)]">
            <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center text-base flex-shrink-0">
              {currentAgent?.icon || '🤖'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] text-[var(--text-tertiary)] mb-0.5">AI Агент</div>
              <select
                value={currentAgent?.id || ''}
                onChange={(e) => {
                  const agentId = Number(e.target.value);
                  const agent = agents.find(a => a.id === agentId);
                  if (agent) {
                    handleAgentSelect(agent);
                  }
                }}
                className="w-full px-1.5 py-1 text-xs rounded bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-secondary)] focus:outline-none focus:ring-1 focus:ring-purple-500/30"
              >
                <option value="">— Выберите агента —</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id}>{a.icon || '🤖'} {a.name}</option>
                ))}
              </select>
            </div>
          </div>
          {currentAgent && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="chat-operator-select" className="text-[10px] text-[var(--text-tertiary)] uppercase mb-1 block">Оператор</label>
                  <select
                    id="chat-operator-select"
                    value={chatOperatorId || ''}
                    onChange={(e) => {
                      setChatOperatorId(e.target.value ? Number(e.target.value) : null);
                      setChatModelId('');
                    }}
                    disabled={!isAdminOrOwner}
                    className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30 disabled:opacity-60"
                  >
                    <option value="">— Выбрать —</option>
                    {operators.map(op => (
                      <option key={op.id} value={op.id}>{op.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="chat-model-select" className="text-[10px] text-[var(--text-tertiary)] uppercase mb-1 block">Модель</label>
                  <select
                    id="chat-model-select"
                    value={chatModelId}
                    onChange={(e) => setChatModelId(e.target.value)}
                    disabled={!isAdminOrOwner || !chatOperatorId}
                    className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30 disabled:opacity-60"
                  >
                    <option value="">— Выбрать —</option>
                    {models.map((m: {id: number; name: string; model_id?: string}) => (
                      <option key={m.model_id || m.id} value={m.model_id}>{m.name || m.model_id}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="chat-system-prompt" className="text-[10px] text-[var(--text-tertiary)] uppercase mb-1 block">Системный промпт</label>
                <textarea
                  id="chat-system-prompt"
                  value={chatSystemPrompt}
                  onChange={(e) => setChatSystemPrompt(e.target.value)}
                  readOnly={!isAdminOrOwner}
                  rows={4}
                  className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30 resize-none"
                  placeholder="Системный промпт..."
                />
              </div>
              {isAdminOrOwner && (
                (chatOperatorId !== (currentAgent.provider_id || currentAgent.operator_id) ||
                 chatModelId !== currentAgent.model ||
                 chatSystemPrompt !== currentAgent.system_prompt) && (
                  <button
                    onClick={saveAgentSettings}
                    disabled={isSavingAgentSettings}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)] disabled:opacity-50 transition-colors"
                  >
                    {isSavingAgentSettings ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    Сохранить в агента
                  </button>
                )
              )}
            </>
          )}
          <div className="pt-2 border-t border-[var(--border-secondary)]">
            <button
              onClick={clearMessages}
              disabled={messages.length === 0}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Очистить AI историю
            </button>
          </div>
          {/* Ticket #81439: SubAgentSelector removed — sub-agents invoked via /command in new chat */}
          {/* ADR-110: Context Settings */}
          {currentAgent && (
            <ContextSettingsSection
              contextSettings={contextSettings}
              onChange={handleContextSettingsChange}
              onSave={saveContextSettings}
              isSaving={isSavingContextSettings}
              disabled={!isAdminOrOwner}
            />
          )}
        </div>
      )}

      {/* People Settings Tab */}
      {settingsTab === 'people' && (
        <div className="p-3 space-y-3 overflow-y-auto flex-1">
          <div className="flex items-center gap-2 p-2 rounded-lg bg-[var(--bg-tertiary)]">
            {chatPartner?.type === 'user' ? (
              chatPartner.avatarUrl ? (
                <img src={chatPartner.avatarUrl} alt={chatPartner.name} className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-blue-400" />
                </div>
              )
            ) : (
              <div className="w-8 h-8 rounded-lg bg-gray-500/20 flex items-center justify-center flex-shrink-0">
                <Users className="w-4 h-4 text-gray-400" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                {chatPartner?.name || 'Не выбран'}
              </div>
              <div className="text-[10px] text-[var(--text-tertiary)]">
                {chatPartner?.email || 'Выберите контакт'}
              </div>
            </div>
          </div>
          <div className="p-3 rounded-lg bg-[var(--bg-tertiary)]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[var(--text-tertiary)]">Непрочитанных сообщений</span>
              <span className={cn(
                "px-2 py-0.5 rounded-full text-xs font-medium",
                totalUnreadCount > 0 ? "bg-red-500/20 text-red-400" : "bg-gray-500/20 text-gray-400"
              )}>
                {totalUnreadCount}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-tertiary)]">Активных бесед</span>
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">
                {inboxConversations.length}
              </span>
            </div>
          </div>
          <div className="p-3 rounded-lg bg-[var(--bg-tertiary)]">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-[var(--text-primary)]">Уведомления</div>
                <div className="text-[10px] text-[var(--text-tertiary)]">Звук при новых сообщениях</div>
              </div>
              <button className="w-10 h-5 rounded-full bg-[var(--color-primary-500)] relative">
                <span className="absolute right-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow"></span>
              </button>
            </div>
          </div>
          <div className="pt-2 border-t border-[var(--border-secondary)] space-y-1">
            <button
              onClick={() => {
                setChatMode('people');
                setActivePanel('contacts');
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
            >
              <Users className="w-3.5 h-3.5" />
              Открыть контакты
            </button>
            <button
              onClick={() => {
                setChatMode('people');
                setActivePanel('inbox');
                refetchInbox();
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
            >
              <Inbox className="w-3.5 h-3.5" />
              Открыть входящие
            </button>
          </div>
        </div>
      )}

      {/* Widget Settings Tab */}
      {settingsTab === 'widget' && (
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          <div>
            <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Источник задач</h4>
            <p className="text-xs text-[var(--text-tertiary)] mb-2">Настройка для всех пользователей виджета</p>
            {tasksSource ? (
              <>
                <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-tertiary)]">
                  <div className="flex items-center gap-2">
                    <span>{tasksSource.tableIcon || '📋'}</span>
                    <span className="text-sm text-[var(--text-primary)]">{tasksSource.tableName}</span>
                  </div>
                  <button
                    onClick={() => updateTasksSource(undefined)}
                    className="text-xs text-red-400 hover:underline"
                  >
                    Удалить
                  </button>
                </div>
                {/* Column mapping */}
                {tasksTableColumns.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-[10px] text-[var(--text-tertiary)] uppercase font-medium">Маппинг полей</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="tasks-display-col" className="block text-[10px] text-[var(--text-tertiary)] mb-1">Название</label>
                        <select
                          id="tasks-display-col"
                          value={tasksSource.displayColumn || ''}
                          onChange={(e) => updateTasksSource({ ...tasksSource, displayColumn: e.target.value || undefined })}
                          className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
                        >
                          <option value="">— авто —</option>
                          {tasksTableColumns.map(col => (
                            <option key={col.column_name} value={col.column_name}>
                              {col.display_name || col.column_name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="tasks-desc-col" className="block text-[10px] text-[var(--text-tertiary)] mb-1">Описание</label>
                        <select
                          id="tasks-desc-col"
                          value={tasksSource.descriptionColumn || ''}
                          onChange={(e) => updateTasksSource({ ...tasksSource, descriptionColumn: e.target.value || undefined })}
                          className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
                        >
                          <option value="">— нет —</option>
                          {tasksTableColumns.map(col => (
                            <option key={col.column_name} value={col.column_name}>
                              {col.display_name || col.column_name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="tasks-status-col" className="block text-[10px] text-[var(--text-tertiary)] mb-1">Статус</label>
                        <select
                          id="tasks-status-col"
                          value={tasksSource.statusColumn || ''}
                          onChange={(e) => {
                            const colName = e.target.value || undefined;
                            const colInfo = tasksTableColumns.find(c => c.column_name === colName);
                            let dictId: number | undefined;
                            if (colInfo?.config) {
                              try {
                                const parsed = JSON.parse(colInfo.config);
                                if (parsed?.relationTableId) dictId = parsed.relationTableId;
                              } catch { /* ignore */ }
                            }
                            updateTasksSource({ ...tasksSource, statusColumn: colName, statusDictTableId: dictId });
                          }}
                          className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
                        >
                          <option value="">— нет —</option>
                          {tasksTableColumns.map(col => (
                            <option key={col.column_name} value={col.column_name}>
                              {col.display_name || col.column_name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="tasks-priority-col" className="block text-[10px] text-[var(--text-tertiary)] mb-1">Приоритет</label>
                        <select
                          id="tasks-priority-col"
                          value={tasksSource.priorityColumn || ''}
                          onChange={(e) => {
                            const colName = e.target.value || undefined;
                            const colInfo = tasksTableColumns.find(c => c.column_name === colName);
                            let dictId: number | undefined;
                            if (colInfo?.config) {
                              try {
                                const parsed = JSON.parse(colInfo.config);
                                if (parsed?.relationTableId) dictId = parsed.relationTableId;
                              } catch { /* ignore */ }
                            }
                            updateTasksSource({ ...tasksSource, priorityColumn: colName, priorityDictTableId: dictId });
                          }}
                          className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
                        >
                          <option value="">— нет —</option>
                          {tasksTableColumns.map(col => (
                            <option key={col.column_name} value={col.column_name}>
                              {col.display_name || col.column_name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <TasksSourceInlineSelector
                defaultSpaceId={effectiveSpaceId}
                onSelect={(config) => {
                  updateTasksSource(config);
                }}
                onCancel={() => {}}
                showHeader={false}
              />
            )}
          </div>
          <div>
            <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Источник файлов</h4>
            <p className="text-xs text-[var(--text-tertiary)] mb-2">Таблица файлов для кнопки &quot;+&quot; (по умолчанию Files из System Data)</p>
            {filesSource ? (
              <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-tertiary)]">
                <div className="flex items-center gap-2">
                  <span>{filesSource.tableIcon || '📁'}</span>
                  <span className="text-sm text-[var(--text-primary)]">{filesSource.tableName}</span>
                </div>
                <button
                  onClick={() => updateFilesSource(undefined)}
                  className="text-xs text-red-400 hover:underline"
                >
                  Удалить
                </button>
              </div>
            ) : (
              <FilesSourceInlineSelector
                defaultSpaceId={effectiveSpaceId}
                onSelect={(config) => {
                  updateFilesSource(config);
                }}
                onCancel={() => {}}
                showHeader={false}
              />
            )}
          </div>
          <div className="pt-2 border-t border-[var(--border-secondary)]">
            <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Агент по умолчанию</h4>
            <p className="text-xs text-[var(--text-tertiary)] mb-2">Автоматически выбирается при открытии чата в этом спейсе</p>
            <div className="flex items-center gap-2">
              <select
                value={defaultAgentId || ''}
                onChange={(e) => {
                  const newAgentId = e.target.value ? Number(e.target.value) : null;
                  saveDefaultAgent(newAgentId);
                }}
                disabled={isSavingDefaultAgent || !isAdminOrOwner}
                className="flex-1 px-3 py-2 text-sm rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30 disabled:opacity-50"
              >
                <option value="">— Не выбран —</option>
                {agents.map(agent => (
                  <option key={agent.id} value={agent.id}>
                    {agent.icon || '🤖'} {agent.name}
                  </option>
                ))}
              </select>
              {isSavingDefaultAgent && (
                <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />
              )}
            </div>
            {defaultAgentId && agents.find(a => a.id === defaultAgentId) && (
              <div className="mt-2 flex items-center gap-2 p-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
                <div className="w-6 h-6 rounded bg-purple-500/20 flex items-center justify-center text-sm">
                  {agents.find(a => a.id === defaultAgentId)?.icon || '🤖'}
                </div>
                <span className="text-xs text-purple-400">
                  {agents.find(a => a.id === defaultAgentId)?.name}
                </span>
              </div>
            )}
            {!isAdminOrOwner && (
              <p className="mt-2 text-[10px] text-[var(--text-tertiary)] italic">
                Только администраторы могут изменять эту настройку
              </p>
            )}
          </div>

          {/* Quick Reaction Emojis */}
          <div className="pt-2 border-t border-[var(--border-secondary)]">
            <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Быстрые реакции</h4>
            <p className="text-xs text-[var(--text-tertiary)] mb-3">До 6 эмодзи для быстрых реакций в чате</p>

            <div className="flex flex-wrap gap-2 mb-3">
              {quickEmojis.map((emoji, index) => (
                <div key={index} className="relative group">
                  <input
                    type="text"
                    value={emoji}
                    onChange={(e) => {
                      // Get only the last emoji character(s) if multiple are pasted
                      const newValue = e.target.value;
                      const emojiMatch = newValue.match(/\p{Extended_Pictographic}/gu);
                      const lastEmoji = emojiMatch ? emojiMatch[emojiMatch.length - 1] : emoji;
                      const newEmojis = [...quickEmojis];
                      newEmojis[index] = lastEmoji;
                      setQuickEmojis(newEmojis);
                    }}
                    disabled={!isAdminOrOwner}
                    className="w-10 h-10 text-center text-xl rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30 disabled:opacity-50"
                    maxLength={4}
                  />
                  {isAdminOrOwner && quickEmojis.length > 1 && (
                    <button
                      onClick={() => {
                        const newEmojis = quickEmojis.filter((_, i) => i !== index);
                        setQuickEmojis(newEmojis);
                      }}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {isAdminOrOwner && quickEmojis.length < 6 && (
                <button
                  onClick={() => setQuickEmojis([...quickEmojis, '😊'])}
                  className="w-10 h-10 text-center text-xl rounded-lg bg-[var(--bg-tertiary)] border border-dashed border-[var(--border-primary)] hover:border-[var(--color-primary-500)] hover:bg-[var(--color-primary-500)]/10 transition-colors flex items-center justify-center text-[var(--text-tertiary)]"
                >
                  +
                </button>
              )}
            </div>

            {isAdminOrOwner && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => saveQuickEmojis(quickEmojis)}
                  disabled={isSavingEmojis}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)] disabled:opacity-50 transition-colors"
                >
                  {isSavingEmojis ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  Сохранить
                </button>
                <button
                  onClick={() => setQuickEmojis(DEFAULT_QUICK_EMOJIS)}
                  className="px-3 py-2 rounded-lg text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] transition-colors"
                >
                  Сбросить
                </button>
              </div>
            )}
            {!isAdminOrOwner && (
              <p className="text-[10px] text-[var(--text-tertiary)] italic">
                Только администраторы могут изменять эмодзи
              </p>
            )}
          </div>

          {/* Voice Input Settings */}
          <div className="pt-2 border-t border-[var(--border-secondary)]">
            <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Голосовой ввод</h4>
            <p className="text-xs text-[var(--text-tertiary)] mb-3">Режим транскрипции голоса в текст</p>

            <div className="space-y-2">
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- label wraps radio input with nested text */}
              <label htmlFor="voice-mode-web-speech" className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
                <input
                  id="voice-mode-web-speech"
                  type="radio"
                  name="voiceMode"
                  value="webSpeech"
                  checked={voiceMode === 'webSpeech'}
                  onChange={() => setVoiceMode('webSpeech')}
                  className="w-4 h-4 text-[var(--color-primary-500)]"
                />
                <div className="flex-1">
                  <div className="text-sm text-[var(--text-primary)] flex items-center gap-2">
                    Web Speech API
                    {webSpeechAvailable ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">Доступен</span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">Недоступен</span>
                    )}
                  </div>
                  <p className="text-[10px] text-[var(--text-tertiary)]">
                    Бесплатно, быстро, работает в браузере
                  </p>
                </div>
              </label>

              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- label wraps radio input with nested text */}
              <label htmlFor="voice-mode-whisper" className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
                <input
                  id="voice-mode-whisper"
                  type="radio"
                  name="voiceMode"
                  value="whisper"
                  checked={voiceMode === 'whisper'}
                  onChange={() => setVoiceMode('whisper')}
                  className="w-4 h-4 text-[var(--color-primary-500)]"
                />
                <div className="flex-1">
                  <div className="text-sm text-[var(--text-primary)]">OpenAI Whisper</div>
                  <p className="text-[10px] text-[var(--text-tertiary)]">
                    Высокое качество, поддержка 50+ языков, платный
                  </p>
                </div>
              </label>
            </div>

            {voiceError && (
              <div className="mt-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <span className="text-xs text-red-400">{voiceError}</span>
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-[var(--border-secondary)]">
            <p className="text-xs text-[var(--text-tertiary)]">
              Нажмите 🎤 рядом с кнопкой отправки для голосового ввода
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
