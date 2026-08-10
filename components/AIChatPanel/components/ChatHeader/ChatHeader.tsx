import React from 'react';
import {
  Users,
  Bot,
  Zap,
  ListTodo,
  Inbox,
  Settings,
  Plus,
  X,
  Search,
  User,
  MessageSquare,
  Link2,
  FileText
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { ToolbarButton } from '../shared/ToolbarButton';
import type {
  ChatPartner,
  Agent,
  User as UserType,
  Conversation,
  ChatParticipant
} from '../../types';

/** Bound row reference for chat header display */
interface BoundRowInfo {
  table_id: number;
  row_id: number;
  table_name?: string;
  table_icon?: string;
  row_title?: string;
}

/** ADR-078: Chat conversation mode — solo (AI auto-responds) or group (use /command) */
export type ChatConversationMode = 'solo' | 'group' | null;

interface ChatHeaderProps {
  chatMode: 'ai' | 'people';
  activePanel: string;
  chatPartner: ChatPartner | null;
  chatParticipants: ChatParticipant[];
  agents: Agent[];
  users: UserType[];
  conversations: Conversation[];
  totalUnreadCount: number;
  isWideMode: boolean;
  contactsSearch: string;
  historySearch: string;
  currentAgent?: Agent | null;
  /** ADR-078: Current conversation mode (solo/group) */
  conversationMode?: ChatConversationMode;
  /** ADR-078: Polling error message (null = healthy) */
  pollingError?: string | null;
  /** ADR-078: Reconnect callback when polling stopped */
  onReconnect?: () => void;
  /** Bound rows for display strip under header */
  boundRows?: BoundRowInfo[];
  /** Callback to generate chat summary */
  onSummary?: () => void;
  setChatMode: (mode: 'ai' | 'people') => void;
  setActivePanel: (panel: string) => void;
  setChatPartner: (partner: ChatPartner | null) => void;
  setChatParticipants: (participants: ChatParticipant[]) => void;
  togglePanel: (panel: string) => void;
  loadConversations: () => void;
  refetchInbox: () => void;
  createNewConversation: () => void;
  closeChat: () => void;
  setContactsSearch: (search: string) => void;
  setHistorySearch: (search: string) => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  chatMode,
  activePanel,
  chatPartner,
  chatParticipants,
  agents,
  users,
  conversations,
  totalUnreadCount,
  isWideMode,
  contactsSearch,
  historySearch,
  currentAgent,
  conversationMode,
  pollingError,
  onReconnect,
  boundRows,
  onSummary,
  setChatMode,
  setActivePanel,
  setChatPartner,
  setChatParticipants,
  togglePanel,
  loadConversations,
  refetchInbox,
  createNewConversation,
  closeChat,
  setContactsSearch,
  setHistorySearch
}) => {
  return (
    <div className="border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
      {/* Row 1: Unified toolbar — no mode toggle, all tabs visible */}
      <div className="flex items-center gap-0.5 px-3 py-1">
        {/* Left: All panel tabs in one row */}
        <ToolbarButton
          icon={<Zap className="w-4 h-4" />}
          label="Агенты"
          active={activePanel === 'ai-agents' || (activePanel === 'none' && chatPartner?.type === 'agent')}
          onClick={() => {
            setChatMode('ai');
            togglePanel('ai-agents');
          }}
          badge={agents.length}
        />
        <ToolbarButton
          icon={<Inbox className="w-4 h-4" />}
          label="Входящие"
          active={activePanel === 'inbox'}
          onClick={() => {
            setChatMode('people');
            togglePanel('inbox');
            if (activePanel !== 'inbox') refetchInbox();
          }}
          badge={totalUnreadCount}
          badgeColor={totalUnreadCount > 0 ? 'red' : undefined}
        />
        <ToolbarButton
          icon={<Users className="w-4 h-4" />}
          label="Контакты"
          active={activePanel === 'contacts'}
          onClick={() => {
            setChatMode('people');
            togglePanel('contacts');
          }}
          badge={users.length}
        />
        {/* History button removed — replaced by enhanced Inbox (Ticket #81448) */}
        <ToolbarButton
          icon={<ListTodo className="w-4 h-4" />}
          label="Задачи"
          active={activePanel === 'tasks'}
          onClick={() => togglePanel('tasks')}
        />

        {/* Right-aligned: Settings, New chat, Close */}
        <div className="flex-1" />
        <div className="w-px h-5 bg-[var(--border-secondary)] mx-1" />
        {onSummary && (
          <ToolbarButton
            icon={<FileText className="w-4 h-4" />}
            label="Сводка чата"
            onClick={onSummary}
          />
        )}
        <ToolbarButton
          icon={<Settings className="w-4 h-4" />}
          label="Настройки"
          active={activePanel === 'settings'}
          onClick={() => togglePanel('settings')}
        />
        <ToolbarButton
          icon={<Plus className="w-4 h-4" />}
          label="Новый чат"
          onClick={() => createNewConversation()}
        />
        <ToolbarButton
          icon={<X className="w-4 h-4" />}
          label="Закрыть"
          onClick={closeChat}
        />
      </div>

      {/* Row 2: Chat partner info - hidden when panel is open (shown in panel footer instead) */}
      {(isWideMode || activePanel === 'none') && (
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-[var(--border-secondary)]">
        {/* Chat partner info - clickable to open panel */}
        <button 
          onClick={() => {
            if (chatMode === 'ai') {
              togglePanel('ai-agents');
            } else {
              togglePanel('contacts');
            }
          }}
          className="flex items-center gap-2 flex-1 min-w-0 hover:bg-[var(--bg-tertiary)] rounded-lg p-1 -m-1 transition-colors text-left"
        >
        {chatPartner?.type === 'agent' ? (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center text-base">
            {chatPartner.icon || '🤖'}
          </div>
        ) : chatPartner?.type === 'user' ? (
          chatPartner.avatarUrl ? (
            <img src={chatPartner.avatarUrl} alt={chatPartner.name} className="w-8 h-8 rounded-full object-cover" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
              <User className="w-4 h-4 text-blue-400" />
            </div>
          )
        ) : chatPartner?.type === 'group' ? (
          <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
            <Users className="w-4 h-4 text-green-400" />
          </div>
        ) : (
          <div className="w-8 h-8 rounded-full bg-gray-500/20 flex items-center justify-center">
            <MessageSquare className="w-4 h-4 text-gray-400" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          {/* Show all participants if any */}
          {chatParticipants.length > 0 ? (
            <div className="text-sm text-[var(--text-primary)] line-clamp-2 leading-tight">
              {chatParticipants.map(p => p.name).join(', ')}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm text-[var(--text-primary)]">
                {chatPartner?.name || 'Новый чат'}
              </span>
            </div>
          )}
          {/* Subtitle */}
          {chatParticipants.length === 0 && chatPartner?.type === 'user' && chatPartner.email && (
            <div className="text-[10px] text-[var(--text-tertiary)] truncate">
              {chatPartner.email}
            </div>
          )}
          {chatParticipants.length === 0 && chatPartner?.type === 'agent' && currentAgent?.model_name && (
            <div className="text-[10px] text-[var(--text-tertiary)] truncate">
              {currentAgent.model_name}
            </div>
          )}
          {chatParticipants.length > 0 && (
            <div className="text-[10px] text-[var(--text-tertiary)]">
              {chatParticipants.length} участник{chatParticipants.length === 1 ? '' : chatParticipants.length < 5 ? 'а' : 'ов'}
            </div>
          )}
        </div>
        </button> {/* End chat partner info */}

        {/* ADR-078: Chat mode indicator — solo (AI auto) vs group (/command) */}
        {conversationMode && (
          <span
            className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap",
              conversationMode === 'solo'
                ? "bg-purple-500/15 text-purple-400"
                : "bg-blue-500/15 text-blue-400"
            )}
            title={
              conversationMode === 'solo'
                ? 'AI Mode — Agent responds automatically to every message'
                : 'Group Mode — Use /agent to invoke AI'
            }
            role="status"
            aria-label={
              conversationMode === 'solo'
                ? 'AI auto-response mode'
                : 'Group mode, use slash command for AI'
            }
          >
            {conversationMode === 'solo' ? (
              <>
                <Bot className="w-3 h-3" />
                AI Mode
              </>
            ) : (
              <>
                <Users className="w-3 h-3" />
                Group
              </>
            )}
          </span>
        )}

        {/* ADR-078: Polling error indicator */}
        {pollingError && (
          <button
            onClick={onReconnect}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
            title={pollingError}
            aria-label="Reconnect to chat"
          >
            <Zap className="w-3 h-3" />
            {pollingError.includes('reconnect') ? 'Reconnect' : 'Connection issue'}
          </button>
        )}
      </div>
      )} {/* End Row 2 (chat info) */}

      {/* Row 2.5: Bound row strip */}
      {boundRows && boundRows.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1 border-t border-[var(--border-secondary)] bg-[var(--bg-tertiary)]/50">
          <Link2 className="w-3 h-3 text-[var(--text-tertiary)]" />
          {boundRows.map((row, i) => (
            <span key={i} className="text-[11px] text-[var(--text-secondary)] flex items-center gap-1">
              {row.table_icon && <span>{row.table_icon}</span>}
              <span>{row.row_title || `#${row.row_id}`}</span>
              {i < boundRows.length - 1 && <span className="text-[var(--text-tertiary)]">&middot;</span>}
            </span>
          ))}
        </div>
      )}

      {/* Row 3: Search bar - shown when panel is active, but NOT in wide mode (search is in sidebar then) */}
      {/* NOTE: ai-agents has search in its own toolbar, inbox has its own search (Ticket #81444) */}
      {!isWideMode && activePanel !== 'none' && activePanel === 'contacts' && (
        <div className="px-3 py-1.5 border-t border-[var(--border-secondary)]">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
            <input
              type="text"
              value={
                activePanel === 'contacts' ? contactsSearch :
                ''
              }
              onChange={(e) => {
                if (activePanel === 'contacts') setContactsSearch(e.target.value);
              }}
              placeholder={
                activePanel === 'contacts' ? 'Поиск контактов...' :
                'Поиск...'
              }
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30"
            />
          </div>
        </div>
      )}
    </div>
  );
};