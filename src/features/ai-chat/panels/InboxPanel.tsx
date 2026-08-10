/**
 * InboxPanel — extracted from AIChatPanel.renderInboxPanel()
 * Displays inbox conversations with search, agent filter, and date range filtering.
 */

import React, { useRef, useCallback, useEffect } from 'react';
import {
  X,
  Search,
  Loader2,
  User,
  Users,
  Inbox,
  Filter,
  Link2,
  Pencil,
  Trash2,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useAuthStore } from '@/features/auth/store/authStore';
import type { AIAgent } from '../types';

type PanelTab = 'none' | 'contacts' | 'ai-agents' | 'tasks' | 'settings' | 'inbox';

interface InboxConversation {
  id: number;
  title: string | null;
  type: string;
  agent_id?: number;
  agent_name?: string | null;
  agent_icon?: string | null;
  unread_count: number;
  updated_at: string;
  participants: Array<{
    user_id: number;
    name: string;
    email?: string;
    avatar_url?: string;
  }>;
  sub_agents?: Array<{ row_id: number; name: string; icon?: string | null; response_mode?: string }>;
  bound_table_id?: number | null;
  bound_row_id?: number | null;
  bound_row_title?: string | null;
  bound_table_name?: string | null;
  bound_table_icon?: string | null;
  participant_msg_counts?: Array<{ sender_id: number; name: string; count: number }>;
}

interface ChatPartner {
  type: string;
  id: number;
  name: string;
  avatarUrl?: string;
  email?: string;
  icon?: string | null;
  participants?: Array<{ id: number; name: string; type: 'user' | 'agent' }>;
}

interface ChatParticipant {
  id: number;
  name: string;
  type: 'user' | 'agent';
  email?: string;
  avatar?: string;
}

interface BoundRow {
  table_id: number;
  row_id: number;
  table_name?: string;
  table_icon?: string;
  row_title?: string;
}

export interface InboxPanelProps {
  inboxConversations: InboxConversation[];
  safeAgents: AIAgent[];
  totalUnreadCount: number;
  showInboxFilters: boolean;
  setShowInboxFilters: React.Dispatch<React.SetStateAction<boolean>>;
  hasActiveInboxFilters: boolean;
  inboxSearch: string;
  setInboxSearch: (value: string) => void;
  inboxAgentFilter: string;
  setInboxAgentFilter: (value: string) => void;
  inboxAgentOptions: Array<{ id: number; name: string; icon?: string | null }>;
  inboxDateFrom: string;
  setInboxDateFrom: (value: string) => void;
  inboxDateTo: string;
  setInboxDateTo: (value: string) => void;
  isLoadingInbox: boolean;
  inboxRenamingId: number | null;
  setInboxRenamingId: (id: number | null) => void;
  inboxRenamingTitle: string;
  setInboxRenamingTitle: (title: string) => void;
  inboxRenameInputRef: React.RefObject<HTMLInputElement>;
  renameConversation: (id: number, title: string) => void;
  userConversationId: number | null;
  currentConversationId: number | null;
  chatPartner: ChatPartner | null;
  setChatPartner: (partner: ChatPartner | null) => void;
  setChatParticipants: (participants: ChatParticipant[]) => void;
  setChatMode: (mode: 'ai' | 'people') => void;
  selectAgent: (agent: AIAgent) => void;
  selectConversation: (id: number) => void;
  setUserConversationId: (id: number | null) => void;
  setBoundRows: (rows: BoundRow[]) => void;
  setShowBoundRowsBar: (show: boolean) => void;
  markAsReadMutation: { mutate: (id: number) => void };
  setActivePanel: (panel: PanelTab) => void;
  fetchNextInboxPage?: () => void;
  hasNextInboxPage?: boolean;
  isFetchingNextInboxPage?: boolean;
  deleteConversation?: (id: number) => void;
  refetchInbox?: () => void;
}

export function InboxPanel({
  inboxConversations,
  safeAgents,
  totalUnreadCount,
  showInboxFilters,
  setShowInboxFilters,
  hasActiveInboxFilters,
  inboxSearch,
  setInboxSearch,
  inboxAgentFilter,
  setInboxAgentFilter,
  inboxAgentOptions,
  inboxDateFrom,
  setInboxDateFrom,
  inboxDateTo,
  setInboxDateTo,
  isLoadingInbox,
  inboxRenamingId,
  setInboxRenamingId,
  inboxRenamingTitle,
  setInboxRenamingTitle,
  inboxRenameInputRef,
  renameConversation,
  userConversationId,
  currentConversationId,
  chatPartner,
  setChatPartner,
  setChatParticipants,
  setChatMode,
  selectAgent,
  selectConversation,
  setUserConversationId,
  setBoundRows,
  setShowBoundRowsBar,
  markAsReadMutation,
  setActivePanel,
  fetchNextInboxPage,
  hasNextInboxPage,
  isFetchingNextInboxPage,
  deleteConversation,
  refetchInbox,
}: InboxPanelProps) {
  // Infinite scroll: observe a sentinel element at the bottom of the list
  const sentinelRef = useRef<HTMLDivElement>(null);
  const handleLoadMore = useCallback(() => {
    if (hasNextInboxPage && !isFetchingNextInboxPage && fetchNextInboxPage) {
      fetchNextInboxPage();
    }
  }, [hasNextInboxPage, isFetchingNextInboxPage, fetchNextInboxPage]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) handleLoadMore(); },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [handleLoadMore]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <Inbox className="w-3.5 h-3.5" />
            <span>Все чаты</span>
          </div>
          <div className="flex items-center gap-1">
            {totalUnreadCount > 0 && (
              <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-red-500 text-white">
                {totalUnreadCount}
              </span>
            )}
            <button
              onClick={() => setShowInboxFilters(prev => !prev)}
              className={cn(
                "p-1 rounded transition-colors",
                showInboxFilters || hasActiveInboxFilters
                  ? "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              )}
              title="Фильтры"
            >
              <Filter className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Search bar — always visible */}
      <div className="px-3 py-1.5 border-b border-[var(--border-secondary)]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" />
          <input
            type="text"
            value={inboxSearch}
            onChange={(e) => setInboxSearch(e.target.value)}
            placeholder="Поиск чатов..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
          />
          {inboxSearch && (
            <button
              onClick={() => setInboxSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-[var(--bg-secondary)] rounded"
            >
              <X className="w-3 h-3 text-[var(--text-tertiary)]" />
            </button>
          )}
        </div>
      </div>

      {/* Ticket #81444: Filter controls — collapsible */}
      {showInboxFilters && (
        <div className="px-3 py-2 border-b border-[var(--border-secondary)] space-y-2 bg-[var(--bg-secondary)]">
          {/* Agent filter */}
          <div>
            <label className="text-[10px] text-[var(--text-tertiary)] mb-0.5 block">Агент</label>
            <select
              value={inboxAgentFilter}
              onChange={(e) => setInboxAgentFilter(e.target.value)}
              className="w-full px-2 py-1 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
            >
              <option value="">Все агенты</option>
              {inboxAgentOptions.map(agent => (
                <option key={agent.id} value={agent.id}>
                  {agent.icon || '🤖'} {agent.name}
                </option>
              ))}
            </select>
          </div>
          {/* Date range */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-[var(--text-tertiary)] mb-0.5 block">От</label>
              <input
                type="date"
                value={inboxDateFrom}
                onChange={(e) => setInboxDateFrom(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
              />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-[var(--text-tertiary)] mb-0.5 block">До</label>
              <input
                type="date"
                value={inboxDateTo}
                onChange={(e) => setInboxDateTo(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
              />
            </div>
          </div>
          {/* Clear filters */}
          {hasActiveInboxFilters && (
            <button
              onClick={() => {
                setInboxSearch('');
                setInboxAgentFilter('');
                setInboxDateFrom('');
                setInboxDateTo('');
              }}
              className="text-[10px] text-[var(--color-primary-500)] hover:underline"
            >
              Сбросить фильтры
            </button>
          )}
        </div>
      )}

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {isLoadingInbox ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
          </div>
        ) : inboxConversations.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">
            {hasActiveInboxFilters ? 'Ничего не найдено' : 'Нет активных бесед'}
          </div>
        ) : (
          <>
          {inboxConversations.map(conv => {
            const currentUserId = useAuthStore.getState().user?.id;
            const otherParticipants = conv.participants?.filter(p => currentUserId && p.user_id !== Number(currentUserId)) || [];
            // For agent conversations with no other participants, show agent name from response or local cache
            const agentForConv = conv.agent_id ? safeAgents.find(a => a.id === conv.agent_id) : null;
            const agentName = conv.agent_name || agentForConv?.name || null;
            const agentIcon = conv.agent_icon || agentForConv?.icon || null;
            const displayName = conv.title || otherParticipants.map(p => p.name).join(', ') || agentName || 'Беседа';

            return (
              <button
                key={conv.id}
                onClick={() => {
                  if (otherParticipants.length === 1) {
                    const partner = otherParticipants[0];
                    setChatPartner({
                      type: 'user',
                      id: partner.user_id,
                      name: partner.name,
                      email: partner.email,
                      avatarUrl: partner.avatar_url
                    });
                    setChatParticipants([{ id: partner.user_id, name: partner.name, type: 'user' }]);
                  } else if (otherParticipants.length > 1) {
                    setChatPartner({
                      type: 'group',
                      id: conv.id,
                      name: displayName,
                      participants: otherParticipants.map(p => ({
                        id: p.user_id,
                        name: p.name,
                        type: 'user' as const
                      }))
                    });
                    setChatParticipants(otherParticipants.map(p => ({
                      id: p.user_id,
                      name: p.name,
                      type: 'user' as const
                    })));
                  } else {
                    // No other participants — self-chat or agent conversation
                    if (agentForConv) {
                      // Bug fix: Restore full agent context so sendMessage works
                      const partnerName = conv.title || agentForConv.name;
                      selectAgent(agentForConv);
                      setChatMode('ai');
                      setChatPartner({
                        type: 'agent',
                        id: agentForConv.id,
                        name: partnerName,
                        icon: agentForConv.icon,
                      });
                      setChatParticipants([]);
                      // Restore AI conversation context
                      selectConversation(conv.id);
                    } else if (conv.agent_id) {
                      // Agent conversation but agent not in local list — selectConversation
                      // will store pendingAgentId for deferred lookup when agents load
                      const partnerName = conv.title || conv.agent_name || 'AI Agent';
                      setChatMode('ai');
                      setChatPartner({
                        type: 'agent',
                        id: conv.agent_id,
                        name: partnerName,
                        icon: conv.agent_icon || undefined,
                      });
                      setChatParticipants([]);
                      selectConversation(conv.id);
                    } else {
                      const currentUser = useAuthStore.getState().user;
                      setChatPartner({
                        type: 'user',
                        id: Number(currentUser?.id || 0),
                        name: conv.title || currentUser?.name || 'Я',
                      });
                      setChatParticipants([{ id: Number(currentUser?.id || 0), name: currentUser?.name || 'Я', type: 'user' }]);
                    }
                  }
                  // Only set userConversationId for people chats; agent conversations use selectConversation
                  if (!conv.agent_id) {
                    setUserConversationId(conv.id);
                  }
                  // Bug fix: Restore bound rows from inbox conversation data (not just clear)
                  if (conv.bound_table_id && conv.bound_row_id) {
                    setBoundRows([{
                      table_id: conv.bound_table_id,
                      row_id: conv.bound_row_id,
                      table_name: conv.bound_table_name || undefined,
                      table_icon: conv.bound_table_icon || undefined,
                      row_title: conv.bound_row_title || undefined,
                    }]);
                    setShowBoundRowsBar(true);
                  } else {
                    setBoundRows([]);
                    setShowBoundRowsBar(false);
                  }
                  markAsReadMutation.mutate(conv.id);
                  setActivePanel('none');
                }}
                className={cn(
                  "group w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--bg-tertiary)] transition-colors text-left",
                  conv.unread_count > 0 && "bg-[var(--color-primary-500)]/5"
                )}
              >
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-sm">
                    {agentIcon || agentForConv ? (
                      <span className="text-lg">{agentIcon || agentForConv?.icon || '🤖'}</span>
                    ) : conv.type === 'direct' ? (
                      <User className="w-5 h-5 text-[var(--text-tertiary)]" />
                    ) : (
                      <Users className="w-5 h-5 text-[var(--text-tertiary)]" />
                    )}
                  </div>
                  {conv.unread_count > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-red-500 text-white flex items-center justify-center">
                      {conv.unread_count > 99 ? '99+' : conv.unread_count}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {inboxRenamingId === conv.id ? (
                    <input
                      ref={inboxRenameInputRef}
                      type="text"
                      value={inboxRenamingTitle}
                      onChange={(e) => setInboxRenamingTitle(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                          const newTitle = inboxRenamingTitle.trim();
                          if (newTitle) {
                            renameConversation(conv.id, newTitle);
                            const activeId = userConversationId || currentConversationId;
                            if (activeId === conv.id && chatPartner) {
                              setChatPartner({ ...chatPartner, name: newTitle });
                            }
                          }
                          setInboxRenamingId(null);
                        } else if (e.key === 'Escape') {
                          setInboxRenamingId(null);
                        }
                      }}
                      onBlur={() => {
                        const newTitle = inboxRenamingTitle.trim();
                        if (newTitle) {
                          renameConversation(conv.id, newTitle);
                          const activeId = userConversationId || currentConversationId;
                          if (activeId === conv.id && chatPartner) {
                            setChatPartner({ ...chatPartner, name: newTitle });
                          }
                        }
                        setInboxRenamingId(null);
                      }}
                      className="w-full px-1.5 py-0.5 text-xs bg-[var(--bg-tertiary)] border border-[var(--color-primary-500)]/40 rounded text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/50"
                      autoFocus
                    />
                  ) : (
                  <div className={cn(
                    "text-sm truncate flex items-center gap-1 group/inbox-title",
                    conv.unread_count > 0 ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                  )}>
                    <span
                      className="truncate"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setInboxRenamingId(conv.id);
                        setInboxRenamingTitle(displayName);
                        setTimeout(() => inboxRenameInputRef.current?.select(), 50);
                      }}
                    >{displayName}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setInboxRenamingId(conv.id);
                        setInboxRenamingTitle(displayName);
                        setTimeout(() => inboxRenameInputRef.current?.select(), 50);
                      }}
                      className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover/inbox-title:opacity-100 hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-all"
                      title="Переименовать"
                    >
                      <Pencil className="w-2.5 h-2.5" />
                    </button>
                  </div>
                  )}
                  {/* Bound row — right under chat name */}
                  {conv.bound_row_id && (
                    <div className="flex items-center gap-1 text-[10px] text-blue-400/70 mt-0.5">
                      <Link2 className="w-2.5 h-2.5 flex-shrink-0" />
                      <span className="truncate">
                        {conv.bound_table_icon || ''}{' '}
                        {conv.bound_table_name ? `${conv.bound_table_name}: ` : ''}
                        {conv.bound_row_title || `#${conv.bound_row_id}`}
                      </span>
                    </div>
                  )}
                  {/* Per-participant message counts */}
                  {conv.participant_msg_counts && conv.participant_msg_counts.length > 0 && (
                    <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5 truncate">
                      {conv.participant_msg_counts.map((mc, i) => (
                        <span key={mc.sender_id}>{i > 0 ? ', ' : ''}{mc.name}: {mc.count}</span>
                      ))}
                      <span className="text-[var(--text-tertiary)]/60">
                        {' — '}
                        {conv.participant_msg_counts.reduce((sum, mc) => sum + mc.count, 0)} всего
                      </span>
                    </div>
                  )}
                  {/* Date + participants + delete row */}
                  <div className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)] mt-0.5">
                    <span className="truncate">
                      {agentName ? `🤖 ${agentName}` : conv.type === 'direct' ? 'Личный чат' : `${conv.participants?.length || 0} уч.`}
                      {' • '}
                      {new Date(conv.updated_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                    </span>
                    <span className="flex-1" />
                    {deleteConversation && (
                      <button onClick={(e) => { e.stopPropagation(); if (confirm('Удалить чат?')) { deleteConversation(conv.id); refetchInbox?.(); } }}
                        className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-[var(--text-tertiary)] hover:text-red-400 transition-all" title="Удалить чат">
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
          {/* Sentinel for infinite scroll */}
          <div ref={sentinelRef} className="h-1" />
          {isFetchingNextInboxPage && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />
            </div>
          )}
          </>
        )}
      </div>
    </div>
  );
}
