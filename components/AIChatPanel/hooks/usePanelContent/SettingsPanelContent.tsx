/** SettingsPanelContent — ADR-119 extracted from usePanelContent.tsx */
import React from 'react';
import { Loader2, Bot, Users, User, Settings, Save, Trash2, AlertCircle, Inbox } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { ContextSettingsSection } from '../../components/ChatPanels/ContextSettingsSection';
import { TasksSourceInlineSelector } from '../../../TasksSourceInlineSelector';
import { FilesSourceInlineSelector } from '../../../FilesSourceInlineSelector';
import type { TasksSourceConfig } from '../../../AIChatPanel.types';
import type { PanelContentDeps } from './PanelContentTypes';

const DEFAULT_QUICK_EMOJIS = ['\uD83D\uDC4D', '\u2764\uFE0F', '\uD83D\uDE02', '\uD83D\uDD25', '\uD83D\uDCAF', '\uD83D\uDE4F', '\uD83D\uDE0D', '\uD83D\uDE2E'];

export function SettingsPanelContent(d: PanelContentDeps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-[var(--border-secondary)]">
        {(['ai', 'people', 'widget'] as const).map(tab => {
          const icons = { ai: Bot, people: Users, widget: Settings };
          const labels = { ai: 'AI', people: 'Люди', widget: 'Виджет' };
          const colors = { ai: 'purple', people: 'blue', widget: 'primary' };
          const Icon = icons[tab];
          const colorVar = colors[tab] === 'primary' ? 'var(--color-primary-500)' : `rgb(var(--color-${colors[tab]}-500))`;
          return (
            <button key={tab} onClick={() => d.setSettingsTab(tab)}
              className={cn("flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1",
                d.settingsTab === tab ? `text-${colors[tab]}-500 border-b-2 border-${colors[tab]}-500` : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              )} style={d.settingsTab === tab ? { color: colorVar, borderColor: colorVar } : undefined}>
              <Icon className="w-3 h-3" />{labels[tab]}
            </button>
          );
        })}
      </div>

      {d.settingsTab === 'ai' && (
        <div className="p-3 space-y-3 overflow-y-auto flex-1">
          <div className="flex items-center gap-2 p-2 rounded-lg bg-[var(--bg-tertiary)]">
            <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center text-base flex-shrink-0">{d.currentAgent?.icon || '\uD83E\uDD16'}</div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] text-[var(--text-tertiary)] mb-0.5">AI Агент</div>
              <select value={d.currentAgent?.id || ''} onChange={(e) => { const a = d.agents.find(a => a.id === Number(e.target.value)); if (a) d.handleAgentSelect(a); }}
                className="w-full px-1.5 py-1 text-xs rounded bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-secondary)] focus:outline-none focus:ring-1 focus:ring-purple-500/30">
                <option value="">— Выберите агента —</option>
                {d.agents.map(a => <option key={a.id} value={a.id}>{a.icon || '\uD83E\uDD16'} {a.name}</option>)}
              </select>
            </div>
          </div>
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
              className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed">
              <Trash2 className="w-3.5 h-3.5" />Очистить AI историю
            </button>
          </div>
          {d.currentAgent && (
            <ContextSettingsSection contextSettings={d.contextSettings} onChange={d.handleContextSettingsChange} onSave={d.saveContextSettings} isSaving={d.isSavingContextSettings} disabled={!d.isAdminOrOwner} />
          )}
        </div>
      )}

      {d.settingsTab === 'people' && (
        <div className="p-3 space-y-3 overflow-y-auto flex-1">
          <div className="flex items-center gap-2 p-2 rounded-lg bg-[var(--bg-tertiary)]">
            {d.chatPartner?.type === 'user' ? (
              d.chatPartner.avatarUrl ? <img src={d.chatPartner.avatarUrl} alt={d.chatPartner.name} className="w-8 h-8 rounded-lg object-cover flex-shrink-0" /> :
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0"><User className="w-4 h-4 text-blue-400" /></div>
            ) : (
              <div className="w-8 h-8 rounded-lg bg-gray-500/20 flex items-center justify-center flex-shrink-0"><Users className="w-4 h-4 text-gray-400" /></div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-[var(--text-primary)] truncate">{d.chatPartner?.name || 'Не выбран'}</div>
              <div className="text-[10px] text-[var(--text-tertiary)]">{d.chatPartner?.email || 'Выберите контакт'}</div>
            </div>
          </div>
          <div className="pt-2 border-t border-[var(--border-secondary)] space-y-1">
            <button onClick={() => { d.setChatMode('people'); d.setActivePanel('contacts'); }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]">
              <Users className="w-3.5 h-3.5" />Открыть контакты
            </button>
            <button onClick={() => { d.setChatMode('people'); d.setActivePanel('inbox'); d.refetchInbox(); }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]">
              <Inbox className="w-3.5 h-3.5" />Открыть входящие
            </button>
          </div>
        </div>
      )}

      {d.settingsTab === 'widget' && (
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          <div>
            <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Источник задач</h4>
            {d.tasksSource ? (
              <>
                <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-tertiary)]">
                  <div className="flex items-center gap-2"><span>{d.tasksSource.tableIcon || '\uD83D\uDCCB'}</span><span className="text-sm text-[var(--text-primary)]">{d.tasksSource.tableName}</span></div>
                  <button onClick={() => d.updateTasksSource(undefined)} className="text-xs text-red-400 hover:underline">Удалить</button>
                </div>
                {d.tasksTableColumns.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-[10px] text-[var(--text-tertiary)] uppercase font-medium">Маппинг полей</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(['displayColumn', 'descriptionColumn', 'statusColumn', 'priorityColumn'] as const).map(field => {
                        const labels: Record<string, string> = { displayColumn: 'Название', descriptionColumn: 'Описание', statusColumn: 'Статус', priorityColumn: 'Приоритет' };
                        return (
                          <div key={field}>
                            <label className="block text-[10px] text-[var(--text-tertiary)] mb-1">{labels[field]}</label>
                            <select value={d.tasksSource?.[field] || ''} onChange={(e) => {
                              const colName = e.target.value || undefined;
                              const update: Partial<TasksSourceConfig> = { [field]: colName };
                              if ((field === 'statusColumn' || field === 'priorityColumn') && colName) {
                                const colInfo = d.tasksTableColumns.find(c => c.column_name === colName);
                                if (colInfo?.config) { try { const p = JSON.parse(colInfo.config); if (p?.relationTableId) update[field === 'statusColumn' ? 'statusDictTableId' : 'priorityDictTableId'] = p.relationTableId; } catch {} }
                              }
                              d.updateTasksSource({ ...d.tasksSource!, ...update });
                            }}
                              className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30">
                              <option value="">— {field === 'displayColumn' ? 'авто' : 'нет'} —</option>
                              {d.tasksTableColumns.map(col => <option key={col.column_name} value={col.column_name}>{col.display_name || col.column_name}</option>)}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <TasksSourceInlineSelector defaultSpaceId={d.effectiveSpaceId} onSelect={(config) => d.updateTasksSource(config)} onCancel={() => {}} showHeader={false} />
            )}
          </div>
          <div>
            <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Источник файлов</h4>
            {d.filesSource ? (
              <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-tertiary)]">
                <div className="flex items-center gap-2"><span>{d.filesSource.tableIcon || '\uD83D\uDCC1'}</span><span className="text-sm text-[var(--text-primary)]">{d.filesSource.tableName}</span></div>
                <button onClick={() => d.updateFilesSource(undefined)} className="text-xs text-red-400 hover:underline">Удалить</button>
              </div>
            ) : (
              <FilesSourceInlineSelector defaultSpaceId={d.effectiveSpaceId} onSelect={(config) => d.updateFilesSource(config)} onCancel={() => {}} showHeader={false} />
            )}
          </div>
          <div className="pt-2 border-t border-[var(--border-secondary)]">
            <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Агент по умолчанию</h4>
            <select value={d.defaultAgentId || ''} onChange={(e) => d.saveDefaultAgent(e.target.value ? Number(e.target.value) : null)} disabled={d.isSavingDefaultAgent || !d.isAdminOrOwner}
              className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30 disabled:opacity-50">
              <option value="">— Не выбран —</option>
              {d.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.icon || '\uD83E\uDD16'} {agent.name}</option>)}
            </select>
          </div>
          <div className="pt-2 border-t border-[var(--border-secondary)]">
            <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Быстрые реакции</h4>
            <div className="flex flex-wrap gap-2 mb-3">
              {d.quickEmojis.map((emoji, index) => (
                <div key={index} className="relative group">
                  <input type="text" value={emoji} onChange={(e) => { const m = e.target.value.match(/\p{Extended_Pictographic}/gu); const last = m ? m[m.length - 1] : emoji; const ne = [...d.quickEmojis]; ne[index] = last; d.setQuickEmojis(ne); }} disabled={!d.isAdminOrOwner}
                    className="w-10 h-10 text-center text-xl rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30 disabled:opacity-50" maxLength={4} />
                  {d.isAdminOrOwner && d.quickEmojis.length > 1 && (
                    <button onClick={() => d.setQuickEmojis(d.quickEmojis.filter((_, i) => i !== index))}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">&times;</button>
                  )}
                </div>
              ))}
              {d.isAdminOrOwner && d.quickEmojis.length < 6 && (
                <button onClick={() => d.setQuickEmojis([...d.quickEmojis, '\uD83D\uDE0A'])}
                  className="w-10 h-10 text-center text-xl rounded-lg bg-[var(--bg-tertiary)] border border-dashed border-[var(--border-primary)] hover:border-[var(--color-primary-500)] hover:bg-[var(--color-primary-500)]/10 transition-colors flex items-center justify-center text-[var(--text-tertiary)]">+</button>
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
      )}
    </div>
  );
}
