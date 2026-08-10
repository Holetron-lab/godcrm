/**
 * ChatHeaderFull — Full chat header with toolbar, title bar, bound row strip, row binding picker, search.
 * ADR-119: Extracted from AIChatPanel.tsx JSX return block.
 */

import React, { useState, useRef } from 'react';
import {
  X, Users, User, Bot, Settings, Zap, ListTodo, Plus,
  MessageSquare, Inbox, FileText, Search, Link2, Trash2,
  Pencil, Check
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { ToolbarButton } from '../shared/ToolbarButton';
import { RowBindingV2, BoundRow } from '../../../RowBindingV2';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import { showToast } from '@/shared/hooks/useToast';
import type { PanelTab, TasksSourceConfig } from '../../../AIChatPanel.types';

interface ChatPartner {
  type: 'agent' | 'user' | 'group';
  id: number;
  name: string;
  icon?: string;
  avatarUrl?: string;
  email?: string;
  participants?: Array<{ id: number; name: string; type: string }>;
}

interface ChatHeaderFullProps {
  chatMode: 'ai' | 'people';
  setChatMode: (v: 'ai' | 'people') => void;
  activePanel: PanelTab;
  togglePanel: (panel: PanelTab) => void;
  agents: Array<{ id: number }>;
  users: Array<unknown>;
  totalUnreadCount: number;
  refetchInbox: () => void;
  createNewConversation: () => void;
  closeChat: () => void;
  chatPartner: ChatPartner | null;
  setChatPartner: (v: ChatPartner | null | ((prev: ChatPartner | null) => ChatPartner | null)) => void;
  chatParticipants: Array<{ id: number; name: string }>;
  resolvedConvTitle: string | null;
  currentConversationId: number | null | undefined;
  userConversationId: number | null;
  renameConversation: (id: number, title: string) => void;
  deleteConversation: (id: number) => void;
  conversationMode: 'solo' | 'group' | null;
  showRowBinding: boolean;
  setShowRowBinding: (v: boolean | ((prev: boolean) => boolean)) => void;
  boundRows: BoundRow[];
  setBoundRows: (v: BoundRow[] | ((prev: BoundRow[]) => BoundRow[])) => void;
  setShowBoundRowsBar: (v: boolean) => void;
  effectiveSpaceId: number | undefined;
  tasksSource: TasksSourceConfig | undefined;
  currentAgent: { model_name?: string } | null;
  isWideMode: boolean;
  contactsSearch: string;
  setContactsSearch: (v: string) => void;
  isMobile: boolean;
}

export function ChatHeaderFull(props: ChatHeaderFullProps) {
  const {
    chatMode, setChatMode, activePanel, togglePanel, agents, users,
    totalUnreadCount, refetchInbox, createNewConversation, closeChat,
    chatPartner, setChatPartner, chatParticipants, resolvedConvTitle,
    currentConversationId, userConversationId, renameConversation, deleteConversation,
    conversationMode, showRowBinding, setShowRowBinding,
    boundRows, setBoundRows, setShowBoundRowsBar,
    effectiveSpaceId, tasksSource, currentAgent, isWideMode,
    contactsSearch, setContactsSearch, isMobile,
  } = props;

  // Chat rename state — header inline edit
  const [isEditingChatTitle, setIsEditingChatTitle] = useState(false);
  const [editingChatTitle, setEditingChatTitle] = useState('');
  const chatTitleInputRef = useRef<HTMLInputElement>(null);

  const handleSaveTitle = () => {
    const newTitle = editingChatTitle.trim();
    if (newTitle) {
      const convId = userConversationId || currentConversationId;
      if (convId) {
        renameConversation(convId, newTitle);
        if (chatPartner) {
          setChatPartner({ ...chatPartner, name: newTitle });
        }
      }
    }
    setIsEditingChatTitle(false);
  };

  return (
    <div className="border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] flex-shrink-0 sticky top-0 z-10">
      {/* Row 1: Unified toolbar */}
      <div className="flex items-center gap-0.5 px-3 py-1">
        <ToolbarButton icon={<Zap className="w-4 h-4" />} label="Агенты"
          active={activePanel === 'ai-agents' || (activePanel === 'none' && chatPartner?.type === 'agent')}
          onClick={() => { setChatMode('ai'); togglePanel('ai-agents'); }}
          badge={agents.length}
        />
        <ToolbarButton icon={<Inbox className="w-4 h-4" />} label="Входящие"
          active={activePanel === 'inbox'}
          onClick={() => { setChatMode('people'); togglePanel('inbox'); if (activePanel !== 'inbox') refetchInbox(); }}
          badge={totalUnreadCount}
          badgeColor={totalUnreadCount > 0 ? 'red' : undefined}
        />
        <ToolbarButton icon={<Users className="w-4 h-4" />} label="Контакты"
          active={activePanel === 'contacts'}
          onClick={() => { setChatMode('people'); togglePanel('contacts'); }}
          badge={users.length}
        />
        <ToolbarButton icon={<ListTodo className="w-4 h-4" />} label="Задачи"
          active={activePanel === 'tasks'}
          onClick={() => togglePanel('tasks')}
        />
        <div className="flex-1" />
        <div className="w-px h-5 bg-[var(--border-secondary)] mx-1" />
        <ToolbarButton icon={<FileText className="w-4 h-4" />} label="Сводка чата"
          onClick={async () => {
            const convId = userConversationId || currentConversationId;
            if (!convId) { showToast('Нет активного чата для создания сводки', 'info'); return; }
            try {
              await apiClient.post(`/chat/conversations/${convId}/summary`);
              showToast('Сводка создана', 'success');
            } catch { showToast('Функция сводки скоро будет доступна', 'info'); }
          }}
        />
        <ToolbarButton icon={<Settings className="w-4 h-4" />} label="Настройки"
          active={activePanel === 'settings'} onClick={() => togglePanel('settings')}
        />
        <ToolbarButton icon={<Plus className="w-4 h-4" />} label="Новый чат"
          onClick={() => createNewConversation()}
        />
        <ToolbarButton icon={<X className="w-4 h-4" />} label="Закрыть" onClick={closeChat} />
      </div>

      {/* Row 2: Chat title + avatar */}
      <div className="flex items-center gap-2 px-3 py-1 border-t border-[var(--border-secondary)]">
        <button onClick={() => { if (chatMode === 'ai') togglePanel('ai-agents'); else togglePanel('contacts'); }}
          className="flex-shrink-0 hover:opacity-80 transition-opacity">
          {chatPartner?.type === 'agent' ? (
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center text-xs">{chatPartner.icon || '🤖'}</div>
          ) : chatPartner?.type === 'user' ? (
            chatPartner.avatarUrl ? <img src={chatPartner.avatarUrl} alt={chatPartner.name} className="w-6 h-6 rounded-full object-cover" /> :
            <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center"><User className="w-3 h-3 text-blue-400" /></div>
          ) : chatPartner?.type === 'group' ? (
            <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center"><Users className="w-3 h-3 text-green-400" /></div>
          ) : (
            <div className="w-6 h-6 rounded-full bg-gray-500/20 flex items-center justify-center"><MessageSquare className="w-3 h-3 text-gray-400" /></div>
          )}
        </button>

        <div className="flex-1 min-w-0">
          {isEditingChatTitle ? (
            <div className="flex items-center gap-1">
              <input ref={chatTitleInputRef} type="text" value={editingChatTitle}
                onChange={(e) => setEditingChatTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSaveTitle(); } else if (e.key === 'Escape') setIsEditingChatTitle(false); }}
                onBlur={handleSaveTitle}
                className="flex-1 min-w-0 px-1.5 py-0.5 text-sm font-medium bg-[var(--bg-tertiary)] border border-[var(--color-primary-500)]/40 rounded text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/50"
                autoFocus
              />
              <button onClick={handleSaveTitle} className="p-0.5 rounded hover:bg-green-500/20 text-green-400" title="Сохранить">
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 group/title">
              <span className="font-medium text-sm text-[var(--text-primary)] truncate">
                {resolvedConvTitle || chatPartner?.name || 'Новый чат'}
              </span>
              {resolvedConvTitle && chatPartner?.type === 'agent' && chatPartner.name && resolvedConvTitle !== chatPartner.name && (
                <span className="text-[10px] text-[var(--text-tertiary)] truncate flex-shrink-0">({chatPartner.name})</span>
              )}
              {(userConversationId || currentConversationId) && (
                <button onClick={(e) => {
                  e.stopPropagation();
                  setEditingChatTitle(resolvedConvTitle || chatPartner?.name || '');
                  setIsEditingChatTitle(true);
                  setTimeout(() => chatTitleInputRef.current?.select(), 50);
                }} className="p-0.5 rounded opacity-0 group-hover/title:opacity-100 hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-all" title="Переименовать чат">
                  <Pencil className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
          {chatParticipants.length > 0 && (
            <div className="text-[10px] text-[var(--text-tertiary)]">
              {chatParticipants.map(p => p.name).join(', ')} · {chatParticipants.length} участник{chatParticipants.length === 1 ? '' : chatParticipants.length < 5 ? 'а' : 'ов'}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {conversationMode && (
            <span className={cn("inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium whitespace-nowrap",
              conversationMode === 'solo' ? "bg-purple-500/15 text-purple-400" : "bg-blue-500/15 text-blue-400")}>
              {conversationMode === 'solo' ? <Bot className="w-2.5 h-2.5" /> : <Users className="w-2.5 h-2.5" />}
              {conversationMode === 'solo' ? 'AI' : 'Group'}
            </span>
          )}
          <button onClick={() => setShowRowBinding(prev => !prev)}
            className={cn("relative flex items-center gap-1 p-1 rounded-md transition-colors",
              showRowBinding || boundRows.length > 0 ? "text-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
            )} title="Привязать строку к чату">
            <Link2 className="w-3.5 h-3.5" />
          </button>
          {(userConversationId || currentConversationId) && (
            <button onClick={() => {
              const convId = userConversationId || currentConversationId;
              if (convId && window.confirm('Удалить этот чат?')) deleteConversation(convId);
            }} className="p-1 rounded-md text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Удалить чат">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Bound row strip */}
      {boundRows.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-0.5 border-t border-[var(--border-secondary)] bg-gradient-to-r from-blue-500/5 to-transparent">
          <Link2 className="w-3 h-3 text-blue-400 flex-shrink-0" />
          {boundRows.map((br, idx) => (
            <React.Fragment key={idx}>
              <span className="flex items-center gap-1 text-[11px]">
                {br.table_icon && <span className="text-xs">{br.table_icon}</span>}
                <span className="text-[var(--text-tertiary)]">{br.table_name || 'Table'}:</span>
                <span className="text-[var(--text-primary)] font-medium">{br.row_title || `#${br.row_id}`}</span>
              </span>
              <button onClick={(e) => {
                e.stopPropagation(); setBoundRows([]); setShowBoundRowsBar(false);
                if (currentConversationId) {
                  apiClient.patch(`/chat/conversations/${currentConversationId}`, { bound_table_id: null, bound_row_id: null })
                    .catch(err => logger.warn('[AIChatPanel] Failed to unbind row:', err));
                }
              }} className="text-[var(--text-tertiary)] hover:text-red-400 transition-colors" title="Отвязать">
                <X className="w-3 h-3" />
              </button>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Row binding picker */}
      {showRowBinding && (
        <div className="px-3 py-2 border-t border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
          <RowBindingV2
            defaultSpaceId={effectiveSpaceId} boundRows={boundRows} maxBindings={1}
            compact={true} hideHeader={true} forceExpanded={true} tasksSource={tasksSource} allowOtherTables={true}
            onClose={() => setShowRowBinding(false)}
            onBind={(binding) => {
              setBoundRows([binding]); setShowRowBinding(false);
              if (currentConversationId) {
                apiClient.patch(`/chat/conversations/${currentConversationId}`, { bound_table_id: binding.table_id, bound_row_id: binding.row_id })
                  .catch(err => logger.warn('[AIChatPanel] Failed to persist row binding:', err));
              }
            }}
            onUnbind={(tableId, rowId) => {
              setBoundRows(prev => prev.filter(br => !(br.table_id === tableId && br.row_id === rowId)));
              if (currentConversationId) {
                apiClient.patch(`/chat/conversations/${currentConversationId}`, { bound_table_id: null, bound_row_id: null })
                  .catch(err => logger.warn('[AIChatPanel] Failed to persist row unbinding:', err));
              }
            }}
          />
        </div>
      )}

      {/* Search bar for contacts in non-wide mode */}
      {!isWideMode && activePanel !== 'none' && activePanel === 'contacts' && (
        <div className="px-3 py-1.5 border-t border-[var(--border-secondary)]">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
            <input type="text" value={contactsSearch}
              onChange={(e) => setContactsSearch(e.target.value)}
              placeholder="Поиск контактов..."
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30"
            />
          </div>
        </div>
      )}
    </div>
  );
}
