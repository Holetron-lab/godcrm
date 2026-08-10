/**
 * SettingsPanelInline — Settings panel render extracted from AIChatPanel.tsx renderSettingsPanel().
 * Split into three tabs: AI, People, Widget.
 */
import React from 'react';
import { Bot, Users, Settings, Loader2, Save, Trash2, User } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { ContextSettingsSection } from './ContextSettingsSection';
import type { ContextSettings } from '../../types';
import type { AIAgent } from '../../../../types';
import type { TasksSourceConfig, FilesSourceConfig } from '../../../AIChatPanel.types';

export interface SettingsPanelInlineProps {
  settingsTab: 'ai' | 'people' | 'widget';
  setSettingsTab: (tab: 'ai' | 'people' | 'widget') => void;
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
  isAdminOrOwner: boolean;
  operators: Array<{ id: number; name: string }>;
  models: Array<{ id: number; name: string; model_id?: string }>;
  isSavingAgentSettings: boolean;
  saveAgentSettings: () => void;
  clearMessages: () => void;
  messages: unknown[];
  contextSettings: ContextSettings | string | undefined | null;
  handleContextSettingsChange: (settings: ContextSettings) => void;
  saveContextSettings: (settings: ContextSettings) => void;
  isSavingContextSettings: boolean;
  // People tab
  chatPartner: { type: string; name: string; email?: string; avatarUrl?: string } | null;
  totalUnreadCount: number;
  inboxConversationsCount: number;
  setChatMode: (mode: string) => void;
  setActivePanel: (panel: string) => void;
  refetchInbox: () => void;
  // Widget tab
  tasksSource: TasksSourceConfig | undefined;
  updateTasksSource: (config: TasksSourceConfig | undefined) => void;
  tasksTableColumns: Array<{ column_name: string; display_name: string; type: string; config?: string }>;
  filesSource: FilesSourceConfig | undefined;
  updateFilesSource: (config: FilesSourceConfig | undefined) => void;
  defaultAgentId: number | null;
  saveDefaultAgent: (agentId: number | null) => void;
  isSavingDefaultAgent: boolean;
  quickEmojis: string[];
  setQuickEmojis: (emojis: string[]) => void;
  isSavingEmojis: boolean;
  saveQuickEmojis: (emojis: string[]) => void;
  DEFAULT_QUICK_EMOJIS: string[];
  voiceMode: 'webSpeech' | 'whisper';
  setVoiceMode: (mode: 'webSpeech' | 'whisper') => void;
  webSpeechAvailable: boolean;
  voiceError: string | null;
  effectiveSpaceId: number | string | undefined;
  // Inline selectors
  TasksSourceInlineSelector: React.ComponentType<{ defaultSpaceId?: number | string; onSelect: (config: TasksSourceConfig) => void; onCancel: () => void; showHeader?: boolean }>;
  FilesSourceInlineSelector: React.ComponentType<{ defaultSpaceId?: number | string; onSelect: (config: FilesSourceConfig) => void; onCancel: () => void; showHeader?: boolean }>;
}

export function SettingsPanelInline(props: SettingsPanelInlineProps) {
  const { settingsTab, setSettingsTab } = props;

  return (
    <div className="flex flex-col h-full">
      {/* Settings Tabs */}
      <div className="flex border-b border-[var(--border-secondary)]">
        <button onClick={() => setSettingsTab('ai')} className={cn("flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1", settingsTab === 'ai' ? "text-purple-500 border-b-2 border-purple-500" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]")}>
          <Bot className="w-3 h-3" /> AI
        </button>
        <button onClick={() => setSettingsTab('people')} className={cn("flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1", settingsTab === 'people' ? "text-blue-500 border-b-2 border-blue-500" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]")}>
          <Users className="w-3 h-3" /> Люди
        </button>
        <button onClick={() => setSettingsTab('widget')} className={cn("flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1", settingsTab === 'widget' ? "text-[var(--color-primary-500)] border-b-2 border-[var(--color-primary-500)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]")}>
          <Settings className="w-3 h-3" /> Виджет
        </button>
      </div>

      {settingsTab === 'ai' && <AISettingsTab {...props} />}
      {settingsTab === 'people' && <PeopleSettingsTab {...props} />}
      {settingsTab === 'widget' && <WidgetSettingsTab {...props} />}
    </div>
  );
}

function AISettingsTab({ currentAgent, agents, handleAgentSelect, chatOperatorId, setChatOperatorId, chatModelId, setChatModelId, chatSystemPrompt, setChatSystemPrompt, isAdminOrOwner, operators, models, isSavingAgentSettings, saveAgentSettings, clearMessages, messages, contextSettings, handleContextSettingsChange, saveContextSettings, isSavingContextSettings }: SettingsPanelInlineProps) {
  return (
    <div className="p-3 space-y-3 overflow-y-auto flex-1">
      <div className="flex items-center gap-2 p-2 rounded-lg bg-[var(--bg-tertiary)]">
        <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center text-base flex-shrink-0">{currentAgent?.icon || '🤖'}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] text-[var(--text-tertiary)] mb-0.5">AI Агент</div>
          <select value={currentAgent?.id || ''} onChange={(e) => { const a = agents.find(a => a.id === Number(e.target.value)); if (a) handleAgentSelect(a); }}
            className="w-full px-1.5 py-1 text-xs rounded bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-secondary)] focus:outline-none focus:ring-1 focus:ring-purple-500/30">
            <option value="">— Выберите агента —</option>
            {agents.map(a => (<option key={a.id} value={a.id}>{a.icon || '🤖'} {a.name}</option>))}
          </select>
        </div>
      </div>
      {currentAgent && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="chat-operator-select" className="text-[10px] text-[var(--text-tertiary)] uppercase mb-1 block">Оператор</label>
              <select id="chat-operator-select" value={chatOperatorId || ''} onChange={(e) => { setChatOperatorId(e.target.value ? Number(e.target.value) : null); setChatModelId(''); }} disabled={!isAdminOrOwner}
                className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30 disabled:opacity-60">
                <option value="">— Выбрать —</option>
                {operators.map(op => (<option key={op.id} value={op.id}>{op.name}</option>))}
              </select>
            </div>
            <div>
              <label htmlFor="chat-model-select" className="text-[10px] text-[var(--text-tertiary)] uppercase mb-1 block">Модель</label>
              <select id="chat-model-select" value={chatModelId} onChange={(e) => setChatModelId(e.target.value)} disabled={!isAdminOrOwner || !chatOperatorId}
                className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30 disabled:opacity-60">
                <option value="">— Выбрать —</option>
                {models.map((m) => (<option key={m.model_id || m.id} value={m.model_id}>{m.name || m.model_id}</option>))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="chat-system-prompt" className="text-[10px] text-[var(--text-tertiary)] uppercase mb-1 block">Системный промпт</label>
            <textarea id="chat-system-prompt" value={chatSystemPrompt} onChange={(e) => setChatSystemPrompt(e.target.value)} readOnly={!isAdminOrOwner} rows={4}
              className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30 resize-none" placeholder="Системный промпт..." />
          </div>
          {isAdminOrOwner && (chatOperatorId !== (currentAgent.provider_id || currentAgent.operator_id) || chatModelId !== currentAgent.model || chatSystemPrompt !== currentAgent.system_prompt) && (
            <button onClick={saveAgentSettings} disabled={isSavingAgentSettings}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)] disabled:opacity-50 transition-colors">
              {isSavingAgentSettings ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Сохранить в агента
            </button>
          )}
        </>
      )}
      <div className="pt-2 border-t border-[var(--border-secondary)]">
        <button onClick={clearMessages} disabled={(messages as unknown[]).length === 0}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed">
          <Trash2 className="w-3.5 h-3.5" /> Очистить AI историю
        </button>
      </div>
      {currentAgent && (
        <ContextSettingsSection contextSettings={contextSettings} onChange={handleContextSettingsChange} onSave={saveContextSettings} isSaving={isSavingContextSettings} disabled={!isAdminOrOwner} />
      )}
    </div>
  );
}

function PeopleSettingsTab({ chatPartner, totalUnreadCount, inboxConversationsCount, setChatMode, setActivePanel, refetchInbox }: SettingsPanelInlineProps) {
  return (
    <div className="p-3 space-y-3 overflow-y-auto flex-1">
      <div className="flex items-center gap-2 p-2 rounded-lg bg-[var(--bg-tertiary)]">
        {chatPartner?.type === 'user' ? (
          chatPartner.avatarUrl ? (
            <img src={chatPartner.avatarUrl} alt={chatPartner.name} className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0"><User className="w-4 h-4 text-blue-400" /></div>
          )
        ) : (
          <div className="w-8 h-8 rounded-lg bg-gray-500/20 flex items-center justify-center flex-shrink-0"><Users className="w-4 h-4 text-gray-400" /></div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-[var(--text-primary)] truncate">{chatPartner?.name || 'Не выбран'}</div>
          <div className="text-[10px] text-[var(--text-tertiary)]">{chatPartner?.email || 'Выберите контакт'}</div>
        </div>
      </div>
      <div className="p-3 rounded-lg bg-[var(--bg-tertiary)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[var(--text-tertiary)]">Непрочитанных сообщений</span>
          <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", totalUnreadCount > 0 ? "bg-red-500/20 text-red-400" : "bg-gray-500/20 text-gray-400")}>{totalUnreadCount}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-tertiary)]">Активных бесед</span>
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">{inboxConversationsCount}</span>
        </div>
      </div>
      <div className="pt-2 border-t border-[var(--border-secondary)] space-y-1">
        <button onClick={() => { setChatMode('people'); setActivePanel('contacts'); }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]">
          <Users className="w-3.5 h-3.5" /> Открыть контакты
        </button>
        <button onClick={() => { setChatMode('people'); setActivePanel('inbox'); refetchInbox(); }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]">
          <Settings className="w-3.5 h-3.5" /> Открыть входящие
        </button>
      </div>
    </div>
  );
}

function WidgetSettingsTab(props: SettingsPanelInlineProps) {
  const { tasksSource, updateTasksSource, tasksTableColumns, filesSource, updateFilesSource, defaultAgentId, saveDefaultAgent, isSavingDefaultAgent, agents, isAdminOrOwner, quickEmojis, setQuickEmojis, isSavingEmojis, saveQuickEmojis, DEFAULT_QUICK_EMOJIS, voiceMode, setVoiceMode, webSpeechAvailable, voiceError, effectiveSpaceId, TasksSourceInlineSelector, FilesSourceInlineSelector } = props;
  return (
    <div className="p-4 space-y-4 overflow-y-auto flex-1">
      {/* Tasks source */}
      <div>
        <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Источник задач</h4>
        {tasksSource ? (
          <>
            <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-tertiary)]">
              <div className="flex items-center gap-2"><span>{tasksSource.tableIcon || '📋'}</span><span className="text-sm text-[var(--text-primary)]">{tasksSource.tableName}</span></div>
              <button onClick={() => updateTasksSource(undefined)} className="text-xs text-red-400 hover:underline">Удалить</button>
            </div>
            {tasksTableColumns.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-[10px] text-[var(--text-tertiary)] uppercase font-medium">Маппинг полей</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['displayColumn', 'descriptionColumn', 'statusColumn', 'priorityColumn'] as const).map(field => {
                    const labels: Record<string, string> = { displayColumn: 'Название', descriptionColumn: 'Описание', statusColumn: 'Статус', priorityColumn: 'Приоритет' };
                    return (
                      <div key={field}>
                        <label className="block text-[10px] text-[var(--text-tertiary)] mb-1">{labels[field]}</label>
                        <select value={tasksSource[field] || ''} onChange={(e) => {
                          const colName = e.target.value || undefined;
                          if (field === 'statusColumn' || field === 'priorityColumn') {
                            const colInfo = tasksTableColumns.find(c => c.column_name === colName);
                            let dictId: number | undefined;
                            if (colInfo?.config) { try { const p = JSON.parse(colInfo.config); if (p?.relationTableId) dictId = p.relationTableId; } catch {} }
                            const dictKey = field === 'statusColumn' ? 'statusDictTableId' : 'priorityDictTableId';
                            updateTasksSource({ ...tasksSource, [field]: colName, [dictKey]: dictId });
                          } else {
                            updateTasksSource({ ...tasksSource, [field]: colName });
                          }
                        }} className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30">
                          <option value="">{field === 'displayColumn' ? '— авто —' : '— нет —'}</option>
                          {tasksTableColumns.map(col => (<option key={col.column_name} value={col.column_name}>{col.display_name || col.column_name}</option>))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          <TasksSourceInlineSelector defaultSpaceId={effectiveSpaceId} onSelect={(config) => updateTasksSource(config)} onCancel={() => {}} showHeader={false} />
        )}
      </div>
      {/* Files source */}
      <div>
        <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Источник файлов</h4>
        {filesSource ? (
          <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-tertiary)]">
            <div className="flex items-center gap-2"><span>{filesSource.tableIcon || '📁'}</span><span className="text-sm text-[var(--text-primary)]">{filesSource.tableName}</span></div>
            <button onClick={() => updateFilesSource(undefined)} className="text-xs text-red-400 hover:underline">Удалить</button>
          </div>
        ) : (
          <FilesSourceInlineSelector defaultSpaceId={effectiveSpaceId} onSelect={(config) => updateFilesSource(config)} onCancel={() => {}} showHeader={false} />
        )}
      </div>
      {/* Default agent */}
      <div className="pt-2 border-t border-[var(--border-secondary)]">
        <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Агент по умолчанию</h4>
        <select value={defaultAgentId || ''} onChange={(e) => saveDefaultAgent(e.target.value ? Number(e.target.value) : null)} disabled={isSavingDefaultAgent || !isAdminOrOwner}
          className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30 disabled:opacity-50">
          <option value="">— Не выбран —</option>
          {agents.map(a => (<option key={a.id} value={a.id}>{a.icon || '🤖'} {a.name}</option>))}
        </select>
      </div>
      {/* Quick emojis */}
      <div className="pt-2 border-t border-[var(--border-secondary)]">
        <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Быстрые реакции</h4>
        <div className="flex flex-wrap gap-2 mb-3">
          {quickEmojis.map((emoji, idx) => (
            <div key={idx} className="relative group">
              <input type="text" value={emoji} onChange={(e) => { const m = e.target.value.match(/\p{Extended_Pictographic}/gu); const last = m ? m[m.length - 1] : emoji; const n = [...quickEmojis]; n[idx] = last; setQuickEmojis(n); }} disabled={!isAdminOrOwner}
                className="w-10 h-10 text-center text-xl rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30 disabled:opacity-50" maxLength={4} />
              {isAdminOrOwner && quickEmojis.length > 1 && (
                <button onClick={() => setQuickEmojis(quickEmojis.filter((_, i) => i !== idx))} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">x</button>
              )}
            </div>
          ))}
          {isAdminOrOwner && quickEmojis.length < 6 && (
            <button onClick={() => setQuickEmojis([...quickEmojis, '😊'])} className="w-10 h-10 rounded-lg bg-[var(--bg-tertiary)] border border-dashed border-[var(--border-primary)] hover:border-[var(--color-primary-500)] flex items-center justify-center text-[var(--text-tertiary)]">+</button>
          )}
        </div>
        {isAdminOrOwner && (
          <div className="flex items-center gap-2">
            <button onClick={() => saveQuickEmojis(quickEmojis)} disabled={isSavingEmojis}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)] disabled:opacity-50 transition-colors">
              {isSavingEmojis ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Сохранить
            </button>
            <button onClick={() => setQuickEmojis(DEFAULT_QUICK_EMOJIS)} className="px-3 py-2 rounded-lg text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] transition-colors">Сбросить</button>
          </div>
        )}
      </div>
      {/* Voice settings */}
      <div className="pt-2 border-t border-[var(--border-secondary)]">
        <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Голосовой ввод</h4>
        <div className="space-y-2">
          <label htmlFor="voice-mode-web-speech" className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
            <input id="voice-mode-web-speech" type="radio" name="voiceMode" value="webSpeech" checked={voiceMode === 'webSpeech'} onChange={() => setVoiceMode('webSpeech')} className="w-4 h-4" />
            <div className="flex-1">
              <div className="text-sm text-[var(--text-primary)] flex items-center gap-2">
                Web Speech API
                {webSpeechAvailable ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">Доступен</span> : <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">Недоступен</span>}
              </div>
            </div>
          </label>
          <label htmlFor="voice-mode-whisper" className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
            <input id="voice-mode-whisper" type="radio" name="voiceMode" value="whisper" checked={voiceMode === 'whisper'} onChange={() => setVoiceMode('whisper')} className="w-4 h-4" />
            <div className="flex-1"><div className="text-sm text-[var(--text-primary)]">OpenAI Whisper</div></div>
          </label>
        </div>
        {voiceError && <div className="mt-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">{voiceError}</div>}
      </div>
    </div>
  );
}
