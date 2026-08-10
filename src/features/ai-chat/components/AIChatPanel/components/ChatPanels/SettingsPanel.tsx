import React, { useState } from 'react';
import {
  Bot,
  Users,
  Settings,
  User,
  Loader2,
  Save,
  Trash2,
  Inbox,
  AlertCircle,
  Bell,
  Shield,
  Globe2,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { TicketsSourceInlineSelector } from '@/features/ai-chat/components/TicketsSourceInlineSelector';
import { FilesSourceInlineSelector } from '@/features/ai-chat/components/FilesSourceInlineSelector';
import { ContextSettingsSection } from './ContextSettingsSection';
import { PersonalNotificationSettings } from '@/features/ai-chat/components/ChatNotifications/PersonalNotificationSettings';
import { AdminSpaceNotifications } from '@/features/ai-chat/components/ChatNotifications/AdminSpaceNotifications';
import { AdminGlobalNotifications } from '@/features/ai-chat/components/ChatNotifications/AdminGlobalNotifications';
import { useSpaceAccessLevel } from '@/features/spaces/hooks/useSpaceAccessLevel';

const APP_OWNER_SPACE_ID = 11; // ADR-0040 / ADR-0064: same gate as _secrets
import type {
  Agent,
  Operator,
  Model,
  TicketsSource,
  FilesSource,
  Space,
  Conversation,
  ChatPartner,
  ChatMessage,
  ContextSettings,
} from '../../types';

const DEFAULT_QUICK_EMOJIS = ['👍', '❤️', '😂', '🔥', '💯', '🙏', '😍', '😮'];

type SettingsSubTab = 'ai' | 'people' | 'widget' | 'notifications';

interface SettingsPanelProps {
  settingsTab: SettingsSubTab;
  currentAgent: Agent | null;
  operators: Operator[];
  models: Model[];
  agents: Agent[];
  chatOperatorId: number | null;
  chatModelId: string;
  chatSystemPrompt: string;
  isAdminOrOwner: boolean;
  isSavingAgentSettings: boolean;
  messages: ChatMessage[];
  availableAgents: Array<{ row_id: number; name: string; icon: string | null; description: string | null }>;
  isLoadingAgents?: boolean;
  chatPartner: ChatPartner | null;
  totalUnreadCount: number;
  inboxConversations: Conversation[];
  ticketsSource: TicketsSource | undefined;
  filesSource: FilesSource | undefined;
  currentSpace: Space | null;
  defaultAgentId: number | null;
  isSavingDefaultAgent: boolean;
  quickEmojis: string[];
  isSavingEmojis: boolean;
  voiceMode: 'webSpeech' | 'whisper';
  webSpeechAvailable: boolean;
  voiceError: string | null;
  setSettingsTab: (tab: SettingsSubTab) => void;
  setChatOperatorId: (id: number | null) => void;
  setChatModelId: (id: string) => void;
  setChatSystemPrompt: (prompt: string) => void;
  saveAgentSettings: () => void;
  clearMessages: () => void;
  setChatMode: (mode: string) => void;
  setActivePanel: (panel: string) => void;
  refetchInbox: () => void;
  setTicketsSource: (source: TicketsSource | undefined) => void;
  setFilesSource: (source: FilesSource | undefined) => void;
  saveDefaultAgent: (agentId: number | null) => void;
  setQuickEmojis: (emojis: string[]) => void;
  saveQuickEmojis: (emojis: string[]) => void;
  setVoiceMode: (mode: 'webSpeech' | 'whisper') => void;
  // ADR-110: Context settings
  contextSettings: ContextSettings | string | undefined | null;
  isSavingContextSettings: boolean;
  onContextSettingsChange: (settings: ContextSettings) => void;
  onContextSettingsSave: (settings: ContextSettings) => void;
  // Summary agent
  summaryAgentId?: number | null;
  isSavingSummaryAgent?: boolean;
  onSummaryAgentChange?: (agentId: number | null) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settingsTab,
  currentAgent,
  operators,
  models,
  agents,
  chatOperatorId,
  chatModelId,
  chatSystemPrompt,
  isAdminOrOwner,
  isSavingAgentSettings,
  messages,
  availableAgents,
  isLoadingAgents,
  chatPartner,
  totalUnreadCount,
  inboxConversations,
  ticketsSource,
  filesSource,
  currentSpace,
  defaultAgentId,
  isSavingDefaultAgent,
  quickEmojis,
  isSavingEmojis,
  voiceMode,
  webSpeechAvailable,
  voiceError,
  setSettingsTab,
  setChatOperatorId,
  setChatModelId,
  setChatSystemPrompt,
  saveAgentSettings,
  clearMessages,
  setChatMode,
  setActivePanel,
  refetchInbox,
  setTicketsSource,
  setFilesSource,
  saveDefaultAgent,
  setQuickEmojis,
  saveQuickEmojis,
  setVoiceMode,
  // ADR-110: Context settings
  contextSettings,
  isSavingContextSettings,
  onContextSettingsChange,
  onContextSettingsSave,
  // Summary agent
  summaryAgentId,
  isSavingSummaryAgent,
  onSummaryAgentChange,
}) => {
  const hasAgentSettingsChanged = currentAgent && (
    chatOperatorId !== (currentAgent.provider_id || currentAgent.operator_id) ||
    chatModelId !== currentAgent.model ||
    chatSystemPrompt !== currentAgent.system_prompt
  );

  // ADR-0064 WP-C: top-level Personal/Admin split. Admin tab only shown to
  // space-admin+; Global sub-tab inside Admin only shown to app-owner.
  const [topTab, setTopTab] = useState<'personal' | 'admin'>('personal');
  const [adminSubTab, setAdminSubTab] = useState<'space' | 'global'>('space');
  const appOwnerAccess = useSpaceAccessLevel(APP_OWNER_SPACE_ID);
  const isAppOwner = appOwnerAccess.isOwner;
  const canSeeAdminTab = isAdminOrOwner;

  return (
    <div className="flex flex-col h-full">
      {/* Top-level Personal / Admin tabs (ADR-0064 §Two-tier settings pane) */}
      {canSeeAdminTab && (
        <div className="flex border-b border-[var(--border-secondary)] bg-[var(--bg-primary)]">
          <button
            onClick={() => setTopTab('personal')}
            className={cn(
              'flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1',
              topTab === 'personal'
                ? 'text-[var(--color-primary-500)] border-b-2 border-[var(--color-primary-500)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
            )}
          >
            <User className="w-3 h-3" />
            Личное
          </button>
          <button
            onClick={() => setTopTab('admin')}
            className={cn(
              'flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1',
              topTab === 'admin'
                ? 'text-amber-500 border-b-2 border-amber-500'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
            )}
          >
            <Shield className="w-3 h-3" />
            Админ
          </button>
        </div>
      )}

      {/* Sub-tabs: Personal sub-tabs (notifications/ai/people/widget) OR Admin sub-tabs (space/global) */}
      {topTab === 'personal' ? (
        <div className="flex border-b border-[var(--border-secondary)]">
          <button
            onClick={() => setSettingsTab('notifications')}
            className={cn(
              'flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1',
              settingsTab === 'notifications'
                ? 'text-red-500 border-b-2 border-red-500'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
            )}
          >
            <Bell className="w-3 h-3" />
            Уведомл.
          </button>
          <button
            onClick={() => setSettingsTab('ai')}
            className={cn(
              'flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1',
              settingsTab === 'ai'
                ? 'text-purple-500 border-b-2 border-purple-500'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
            )}
          >
            <Bot className="w-3 h-3" />
            AI
          </button>
          <button
            onClick={() => setSettingsTab('people')}
            className={cn(
              'flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1',
              settingsTab === 'people'
                ? 'text-blue-500 border-b-2 border-blue-500'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
            )}
          >
            <Users className="w-3 h-3" />
            Люди
          </button>
          <button
            onClick={() => setSettingsTab('widget')}
            className={cn(
              'flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1',
              settingsTab === 'widget'
                ? 'text-[var(--color-primary-500)] border-b-2 border-[var(--color-primary-500)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
            )}
          >
            <Settings className="w-3 h-3" />
            Вид
          </button>
        </div>
      ) : (
        <div className="flex border-b border-[var(--border-secondary)]">
          <button
            onClick={() => setAdminSubTab('space')}
            className={cn(
              'flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1',
              adminSubTab === 'space'
                ? 'text-amber-500 border-b-2 border-amber-500'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
            )}
          >
            <Shield className="w-3 h-3" />
            Пространство
          </button>
          {isAppOwner && (
            <button
              onClick={() => setAdminSubTab('global')}
              className={cn(
                'flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1',
                adminSubTab === 'global'
                  ? 'text-amber-500 border-b-2 border-amber-500'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
              )}
            >
              <Globe2 className="w-3 h-3" />
              Глобально
            </button>
          )}
        </div>
      )}

      {/* Admin content */}
      {topTab === 'admin' && (
        <div className="p-3 space-y-3 overflow-y-auto flex-1">
          {adminSubTab === 'space' && currentSpace ? (
            <AdminSpaceNotifications
              spaceId={currentSpace.id}
              spaceName={currentSpace.name}
              disabled={!isAdminOrOwner}
            />
          ) : adminSubTab === 'space' ? (
            <div className="text-xs text-[var(--text-tertiary)]">Выберите пространство.</div>
          ) : null}
          {adminSubTab === 'global' && isAppOwner && <AdminGlobalNotifications />}
        </div>
      )}

      {/* Personal/Notifications content */}
      {topTab === 'personal' && settingsTab === 'notifications' && (
        <div className="p-3 space-y-3 overflow-y-auto flex-1">
          <PersonalNotificationSettings />
        </div>
      )}
      
      {/* AI Settings Tab */}
      {topTab === 'personal' && settingsTab === 'ai' && (
        <div className="p-3 space-y-3 overflow-y-auto flex-1">
          <div className="flex items-center gap-2 p-2 rounded-lg bg-[var(--bg-tertiary)]">
            {currentAgent ? (
              <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center text-base flex-shrink-0">
                {currentAgent.icon || '🤖'}
              </div>
            ) : (
              <div className="w-8 h-8 rounded-lg bg-gray-500/20 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-gray-400" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                {currentAgent?.name || 'Не выбран'}
              </div>
              <div className="text-[10px] text-[var(--text-tertiary)]">AI Агент</div>
            </div>
          </div>
          {currentAgent && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-[var(--text-tertiary)] uppercase mb-1 block">Оператор</label>
                  <select
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
                  <label className="text-[10px] text-[var(--text-tertiary)] uppercase mb-1 block">Модель</label>
                  <select
                    value={chatModelId}
                    onChange={(e) => setChatModelId(e.target.value)}
                    disabled={!isAdminOrOwner || !chatOperatorId}
                    className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30 disabled:opacity-60"
                  >
                    <option value="">— Выбрать —</option>
                    {models.map((m: Model) => (
                      <option key={m.model_id || m.id} value={m.model_id}>{m.name || m.model_id}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-[var(--text-tertiary)] uppercase mb-1 block">Системный промпт</label>
                <textarea
                  value={chatSystemPrompt}
                  onChange={(e) => setChatSystemPrompt(e.target.value)}
                  readOnly={!isAdminOrOwner}
                  rows={4}
                  className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30 resize-none"
                  placeholder="Системный промпт..."
                />
              </div>
              {isAdminOrOwner && hasAgentSettingsChanged && (
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
          {/* Ticket #81439: SubAgentSelector removed — sub-agents invoked via /command */}
          {/* ADR-110: Context Settings */}
          {currentAgent && (
            <ContextSettingsSection
              contextSettings={contextSettings}
              onChange={onContextSettingsChange}
              onSave={onContextSettingsSave}
              isSaving={isSavingContextSettings}
              disabled={!isAdminOrOwner}
            />
          )}
        </div>
      )}

      {/* People Settings Tab */}
      {topTab === 'personal' && settingsTab === 'people' && (
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
          <button
            type="button"
            onClick={() => setSettingsTab('notifications')}
            className="w-full flex items-center gap-2 p-3 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-primary)] transition-colors text-left"
          >
            <Bell className="w-4 h-4 text-red-400 flex-shrink-0" />
            <div className="flex-1">
              <div className="text-sm text-[var(--text-primary)]">Уведомления</div>
              <div className="text-[10px] text-[var(--text-tertiary)]">
                Настроить звук, попапы и бейдж →
              </div>
            </div>
          </button>
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
      {topTab === 'personal' && settingsTab === 'widget' && (
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          <div>
            <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Источник тикетов</h4>
            <p className="text-xs text-[var(--text-tertiary)] mb-2">
              Настройка для спейса {currentSpace?.name ? `«${currentSpace.name}»` : ''}
            </p>
            {ticketsSource ? (
              <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-tertiary)]">
                <div className="flex items-center gap-2">
                  <span>{ticketsSource.tableIcon || '📋'}</span>
                  <span className="text-sm text-[var(--text-primary)]">{ticketsSource.tableName}</span>
                </div>
                <button
                  onClick={() => setTicketsSource(undefined)}
                  className="text-xs text-red-400 hover:underline"
                >
                  Удалить
                </button>
              </div>
            ) : (
              <TicketsSourceInlineSelector
                defaultSpaceId={currentSpace?.id}
                onSelect={(config) => {
                  setTicketsSource(config);
                }}
                onCancel={() => {}}
                showHeader={false}
              />
            )}
          </div>
          <div>
            <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Источник файлов</h4>
            <p className="text-xs text-[var(--text-tertiary)] mb-2">
              Таблица файлов для кнопки "+" в спейсе {currentSpace?.name ? `«${currentSpace.name}»` : ''}
            </p>
            {filesSource ? (
              <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-tertiary)]">
                <div className="flex items-center gap-2">
                  <span>{filesSource.tableIcon || '📁'}</span>
                  <span className="text-sm text-[var(--text-primary)]">{filesSource.tableName}</span>
                </div>
                <button
                  onClick={() => setFilesSource(undefined)}
                  className="text-xs text-red-400 hover:underline"
                >
                  Удалить
                </button>
              </div>
            ) : (
              <FilesSourceInlineSelector
                defaultSpaceId={currentSpace?.id}
                onSelect={(config) => {
                  setFilesSource(config);
                }}
                onCancel={() => {}}
                showHeader={false}
              />
            )}
          </div>
          <div className="pt-2 border-t border-[var(--border-secondary)]">
            <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Агент по умолчанию</h4>
            <p className="text-xs text-[var(--text-tertiary)] mb-2">
              Автоматически выбирается при открытии чата в спейсе {currentSpace?.name ? `«${currentSpace.name}»` : ''}
            </p>
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

          {/* Summary Agent Selector */}
          {onSummaryAgentChange && (
          <div className="pt-2 border-t border-[var(--border-secondary)]">
            <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Summary Agent</h4>
            <p className="text-xs text-[var(--text-tertiary)] mb-2">
              Агент для генерации сводок чата
            </p>
            <div className="flex items-center gap-2">
              <select
                value={summaryAgentId || ''}
                onChange={(e) => {
                  const newId = e.target.value ? Number(e.target.value) : null;
                  onSummaryAgentChange(newId);
                }}
                disabled={isSavingSummaryAgent || !isAdminOrOwner}
                className="flex-1 px-3 py-2 text-sm rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30 disabled:opacity-50"
              >
                <option value="">По умолчанию (gpt-4o-mini)</option>
                {agents.map(agent => (
                  <option key={agent.id} value={agent.id}>
                    {agent.icon || '🤖'} {agent.name}
                  </option>
                ))}
              </select>
              {isSavingSummaryAgent && (
                <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />
              )}
            </div>
            {summaryAgentId && agents.find(a => a.id === summaryAgentId) && (
              <div className="mt-2 flex items-center gap-2 p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <div className="w-6 h-6 rounded bg-blue-500/20 flex items-center justify-center text-sm">
                  {agents.find(a => a.id === summaryAgentId)?.icon || '🤖'}
                </div>
                <span className="text-xs text-blue-400">
                  {agents.find(a => a.id === summaryAgentId)?.name}
                </span>
              </div>
            )}
          </div>
          )}

          {/* Quick Reaction Emojis */}
          <div className="pt-2 border-t border-[var(--border-secondary)]">
            <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase mb-2">Быстрые реакции</h4>
            <p className="text-xs text-[var(--text-tertiary)] mb-3">До 10 эмодзи для быстрых реакций в чате</p>
            
            <div className="grid grid-cols-[repeat(auto-fill,minmax(32px,1fr))] gap-1.5 mb-3">
              {quickEmojis.map((emoji, index) => (
                <div key={index} className="relative group">
                  <input
                    type="text"
                    value={emoji}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      const emojiMatch = newValue.match(/\p{Extended_Pictographic}/gu);
                      const lastEmoji = emojiMatch ? emojiMatch[emojiMatch.length - 1] : emoji;
                      const newEmojis = [...quickEmojis];
                      newEmojis[index] = lastEmoji;
                      setQuickEmojis(newEmojis);
                    }}
                    disabled={!isAdminOrOwner}
                    className="w-8 h-8 text-center text-base rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30 disabled:opacity-50"
                    maxLength={4}
                  />
                  {isAdminOrOwner && quickEmojis.length > 1 && (
                    <button
                      onClick={() => {
                        const newEmojis = quickEmojis.filter((_, i) => i !== index);
                        setQuickEmojis(newEmojis);
                      }}
                      className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      x
                    </button>
                  )}
                </div>
              ))}
              {isAdminOrOwner && quickEmojis.length < 10 && (
                <button
                  onClick={() => setQuickEmojis([...quickEmojis, '😊'])}
                  className="w-8 h-8 text-center text-base rounded-lg bg-[var(--bg-tertiary)] border border-dashed border-[var(--border-primary)] hover:border-[var(--color-primary-500)] hover:bg-[var(--color-primary-500)]/10 transition-colors flex items-center justify-center text-[var(--text-tertiary)]"
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
              <label className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
                <input
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
              
              <label className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
                <input
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
};