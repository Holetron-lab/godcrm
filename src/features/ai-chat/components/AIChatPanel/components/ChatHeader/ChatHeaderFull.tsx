/**
 * ChatHeaderFull — Split into ChatPanelToolbar (tabs) and ChatInfoBar (title/avatar).
 * ADR-119: Extracted from AIChatPanel.tsx JSX return block.
 */

import React, { useState, useRef } from 'react';
import {
  X, Users, User, Bot, Settings, Zap, Ticket, FileText, Plus,
  MessageSquare, Inbox,
  Pencil, Check, Play
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Avatar } from '@/shared/components/ui/Avatar';
import { ToolbarButton } from '../shared/ToolbarButton';
import type { PanelTab, TasksSourceConfig } from '../../../AIChatPanel.types';
import type { FavoritesConfig } from '../../types';

interface ChatPartner {
  type: 'agent' | 'user' | 'group';
  id: number;
  name: string;
  icon?: string;
  avatarUrl?: string;
  email?: string;
  participants?: Array<{ id: number; name: string; type: string }>;
}

/* ─── Part 1: Panel Toolbar (tabs at the very top) ─── */

interface ChatPanelToolbarProps {
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
  isWideMode: boolean;
  contactsSearch: string;
  setContactsSearch: (v: string) => void;
  cycleWidth?: () => void;
  isGlued?: boolean;
  panelWidth?: number;
  tasksSource?: TasksSourceConfig | null;
  favoritesConfig?: FavoritesConfig | null;
}

export function ChatPanelToolbar(props: ChatPanelToolbarProps) {
  const {
    chatMode, setChatMode, activePanel, togglePanel, agents, users,
    totalUnreadCount, refetchInbox, createNewConversation, closeChat,
    chatPartner, isWideMode, contactsSearch, setContactsSearch,
    cycleWidth, isGlued, panelWidth, tasksSource, favoritesConfig,
  } = props;
  const hasTasks = !!tasksSource?.tableId;
  const hasDocs = !!favoritesConfig?.documents?.tableId;

  // Triangle direction hints at next stop in the max → favorite → min → max
  // cycle. At max we'll shrink (point right). At min we'll wrap to max (point
  // left). In between we head toward min (point right).
  const cycleArrowRotation = isGlued ? 0 : (panelWidth !== undefined && panelWidth <= 328 ? 180 : 0);

  return (
    <div className="border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] flex-shrink-0 sticky top-0 z-10" data-chat-header>
      <div className="flex items-center gap-0.5 px-3 py-1">
        {cycleWidth && (
          <>
            <button
              onClick={cycleWidth}
              title="Цикл ширины: макс → любимая → мин"
              className="flex-shrink-0 px-0.5 py-2 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <Play
                className="w-1.5 h-1.5 fill-current"
                style={{ transform: `rotate(${cycleArrowRotation}deg)` }}
              />
            </button>
            <div className="w-px h-4 bg-[var(--border-secondary)] mx-1 flex-shrink-0" />
          </>
        )}
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
        <ToolbarButton icon={<Zap className="w-4 h-4" />} label="Агенты"
          active={activePanel === 'ai-agents' || (activePanel === 'none' && chatPartner?.type === 'agent')}
          onClick={() => { setChatMode('ai'); togglePanel('ai-agents'); }}
          badge={agents.length}
        />
        {hasTasks && (
          <ToolbarButton icon={<Ticket className="w-4 h-4" />} label="Тикеты"
            active={activePanel === 'tasks'}
            onClick={() => togglePanel('tasks')}
          />
        )}
        {hasDocs && (
          <ToolbarButton icon={<FileText className="w-4 h-4" />} label="Документы"
            active={activePanel === 'documents'}
            onClick={() => togglePanel('documents')}
          />
        )}
        <div className="flex-1" />
        <div className="w-px h-5 bg-[var(--border-secondary)] mx-1" />
        <ToolbarButton icon={<Settings className="w-4 h-4" />} label="Настройки"
          active={activePanel === 'settings'} onClick={() => togglePanel('settings')}
        />
        <ToolbarButton icon={<Plus className="w-4 h-4" />} label="Новый чат"
          onClick={() => { createNewConversation(); togglePanel('none' as PanelTab); }}
        />
        <ToolbarButton icon={<X className="w-4 h-4" />} label="Закрыть" onClick={closeChat} />
      </div>

    </div>
  );
}

/* ─── Part 2: Chat Info Bar (title, avatar, participants) ─── */

interface ChatInfoBarProps {
  chatMode: 'ai' | 'people';
  togglePanel: (panel: PanelTab) => void;
  chatPartner: ChatPartner | null;
  setChatPartner: (v: ChatPartner | null | ((prev: ChatPartner | null) => ChatPartner | null)) => void;
  chatParticipants: Array<{ id: number; name: string }>;
  resolvedConvTitle: string | null;
  currentConversationId: number | null | undefined;
  userConversationId: number | null;
  renameConversation: (id: number, title: string) => void;
  conversationMode: 'solo' | 'group' | null;
  isAgentProcessing?: boolean;
  processingAgentName?: string | null;
}

export function ChatInfoBar(props: ChatInfoBarProps) {
  const {
    chatMode, togglePanel, chatPartner, setChatPartner,
    chatParticipants, resolvedConvTitle,
    currentConversationId, userConversationId, renameConversation,
    conversationMode, isAgentProcessing, processingAgentName,
  } = props;

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
    <div className="border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] flex-shrink-0 px-3 py-1" data-chat-info-bar>
      <div className="flex items-center gap-2">
        <button onClick={() => { if (chatMode === 'ai') togglePanel('ai-agents'); else togglePanel('contacts'); }}
          className="flex-shrink-0 hover:opacity-80 transition-opacity">
          {chatPartner?.type === 'agent' ? (
            <Avatar emoji={chatPartner.icon || '🤖'} name={chatPartner.name} size={24} color="#a855f7" />
          ) : chatPartner?.type === 'user' ? (
            <Avatar url={chatPartner.avatarUrl} emoji={chatPartner.icon} name={chatPartner.name} size={24} color="#3b82f6" />
          ) : chatPartner?.type === 'group' ? (
            <Avatar emoji="👥" name={chatPartner.name} size={24} color="#22c55e" />
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
          {isAgentProcessing && processingAgentName && (
            <div className="flex items-center gap-1 text-[10px] text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span>{processingAgentName} работает...</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {chatPartner && (
            <span
              title={`Чат #${userConversationId || currentConversationId || '?'}`}
              className={cn("inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium whitespace-nowrap cursor-default",
              chatPartner.type === 'agent' ? "bg-purple-500/15 text-purple-400" :
              chatPartner.type === 'group' ? "bg-blue-500/15 text-blue-400" :
              "bg-green-500/15 text-green-400")}>
              {chatPartner.type === 'agent' ? <Bot className="w-2.5 h-2.5" /> :
               chatPartner.type === 'group' ? <Users className="w-2.5 h-2.5" /> :
               <User className="w-2.5 h-2.5" />}
              {chatPartner.type === 'agent' ? 'AI' : chatPartner.type === 'group' ? 'Group' : 'Direct'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Legacy wrapper (kept for backwards compat during transition) ─── */

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
  boundRows: any[];
  setBoundRows: (v: any[] | ((prev: any[]) => any[])) => void;
  setShowBoundRowsBar: (v: boolean) => void;
  effectiveSpaceId: number | undefined;
  tasksSource: TasksSourceConfig | undefined;
  currentAgent: { model_name?: string } | null;
  isWideMode: boolean;
  contactsSearch: string;
  setContactsSearch: (v: string) => void;
  isMobile: boolean;
  onSummaryOpen?: () => void;
}

export function ChatHeaderFull(props: ChatHeaderFullProps) {
  return (
    <>
      <ChatPanelToolbar {...props} />
      <ChatInfoBar {...props} />
    </>
  );
}
