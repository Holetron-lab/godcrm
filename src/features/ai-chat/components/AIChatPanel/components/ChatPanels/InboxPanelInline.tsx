/**
 * InboxPanelInline — Inbox panel render extracted from AIChatPanel.tsx renderInboxPanel().
 * Ticket #81443/#81444: Enhanced with filters (search, agent, date).
 */
import React, { useMemo, useRef, useCallback, useEffect } from 'react';
import { X, Search, Loader2, Inbox, Filter, User, Users, ChevronRight, Link2, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useAuthStore } from '@/features/auth/store/authStore';
import type { InboxConversation } from '../../../AIChatPanel.types';
import type { AIAgent } from '../../../../types';

export interface InboxPanelInlineProps {
  inboxSearch: string;
  setInboxSearch: (v: string) => void;
  inboxAgentFilter: string;
  setInboxAgentFilter: (v: string) => void;
  inboxDateFrom: string;
  setInboxDateFrom: (v: string) => void;
  inboxDateTo: string;
  setInboxDateTo: (v: string) => void;
  showInboxFilters: boolean;
  setShowInboxFilters: (fn: (prev: boolean) => boolean) => void;
  hasActiveInboxFilters: boolean;
  totalUnreadCount: number;
  inboxConversations: InboxConversation[];
  isLoadingInbox: boolean;
  safeAgents: AIAgent[];
  inboxRenamingId: number | null;
  setInboxRenamingId: (id: number | null) => void;
  inboxRenamingTitle: string;
  setInboxRenamingTitle: (v: string) => void;
  inboxRenameInputRef: React.RefObject<HTMLInputElement | null>;
  renameConversation: (id: number, title: string) => void;
  userConversationId: number | null;
  currentConversationId: number | null;
  chatPartner: { type: string; id: number; name: string } | null;
  onConversationSelect: (conv: InboxConversation, displayName: string) => void;
  fetchNextInboxPage?: () => void;
  hasNextInboxPage?: boolean;
  isFetchingNextInboxPage?: boolean;
}

export function InboxPanelInline({
  inboxSearch, setInboxSearch, inboxAgentFilter, setInboxAgentFilter,
  inboxDateFrom, setInboxDateFrom, inboxDateTo, setInboxDateTo,
  showInboxFilters, setShowInboxFilters, hasActiveInboxFilters,
  totalUnreadCount, inboxConversations, isLoadingInbox, safeAgents,
  inboxRenamingId, setInboxRenamingId, inboxRenamingTitle, setInboxRenamingTitle,
  inboxRenameInputRef, renameConversation, userConversationId, currentConversationId,
  chatPartner, onConversationSelect,
  fetchNextInboxPage, hasNextInboxPage, isFetchingNextInboxPage,
}: InboxPanelInlineProps) {
  // Collect unique agents from conversations for filter dropdown
  const inboxAgentOptions = useMemo(() => {
    const agentMap = new Map<string, { id: number; name: string; icon?: string | null }>();
    for (const conv of (inboxConversations || [])) {
      if (conv.agent_id) {
        const agentForConv = safeAgents.find(a => a.id === conv.agent_id);
        const name = conv.agent_name || agentForConv?.name || `Agent #${conv.agent_id}`;
        const icon = conv.agent_icon || agentForConv?.icon || null;
        agentMap.set(String(conv.agent_id), { id: conv.agent_id, name, icon });
      }
    }
    return Array.from(agentMap.values());
  }, [inboxConversations, safeAgents]);

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

      {/* Search bar */}
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
            <button onClick={() => setInboxSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-[var(--bg-secondary)] rounded">
              <X className="w-3 h-3 text-[var(--text-tertiary)]" />
            </button>
          )}
        </div>
      </div>

      {/* Filter controls */}
      {showInboxFilters && (
        <div className="px-3 py-2 border-b border-[var(--border-secondary)] space-y-2 bg-[var(--bg-secondary)]">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-[var(--text-tertiary)] mb-0.5 block">От</label>
              <input type="date" value={inboxDateFrom} onChange={(e) => setInboxDateFrom(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30" />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-[var(--text-tertiary)] mb-0.5 block">До</label>
              <input type="date" value={inboxDateTo} onChange={(e) => setInboxDateTo(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30" />
            </div>
          </div>
          {hasActiveInboxFilters && (
            <button onClick={() => { setInboxSearch(''); setInboxAgentFilter(''); setInboxDateFrom(''); setInboxDateTo(''); }}
              className="text-[10px] text-[var(--color-primary-500)] hover:underline">
              Сбросить фильтры
            </button>
          )}
        </div>
      )}

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {isLoadingInbox ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" /></div>
        ) : inboxConversations.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">{hasActiveInboxFilters ? 'Ничего не найдено' : 'Нет активных бесед'}</div>
        ) : (
          <>
          {inboxConversations.map(conv => {
            const currentUserId = useAuthStore.getState().user?.id;
            const otherParticipants = conv.participants?.filter(p => currentUserId && p.user_id !== Number(currentUserId)) || [];
            const agentForConv = conv.agent_id ? safeAgents.find(a => a.id === conv.agent_id) : null;
            const agentName = conv.agent_name || agentForConv?.name || null;
            const agentIcon = conv.agent_icon || agentForConv?.icon || null;
            const displayName = conv.title || otherParticipants.map(p => p.name).join(', ') || agentName || 'Беседа';

            return (
              <button
                key={conv.id}
                onClick={() => onConversationSelect(conv, displayName)}
                className={cn("w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--bg-tertiary)] transition-colors text-left", conv.unread_count > 0 && "bg-[var(--color-primary-500)]/5")}
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
                              // Parent handles chatPartner update
                            }
                          }
                          setInboxRenamingId(null);
                        } else if (e.key === 'Escape') { setInboxRenamingId(null); }
                      }}
                      onBlur={() => {
                        const newTitle = inboxRenamingTitle.trim();
                        if (newTitle) renameConversation(conv.id, newTitle);
                        setInboxRenamingId(null);
                      }}
                      className="w-full px-1.5 py-0.5 text-xs bg-[var(--bg-tertiary)] border border-[var(--color-primary-500)]/40 rounded text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/50"
                      autoFocus
                    />
                  ) : (
                    <div className={cn("text-sm truncate flex items-center gap-1 group/inbox-title", conv.unread_count > 0 ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>
                      <span
                        className="truncate"
                        onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); setInboxRenamingId(conv.id); setInboxRenamingTitle(displayName); setTimeout(() => inboxRenameInputRef.current?.select(), 50); }}
                      >{displayName}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setInboxRenamingId(conv.id); setInboxRenamingTitle(displayName); setTimeout(() => inboxRenameInputRef.current?.select(), 50); }}
                        className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover/inbox-title:opacity-100 hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-all"
                        title="Переименовать"
                      >
                        <Pencil className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  )}
                  <div className="text-[10px] text-[var(--text-tertiary)]">
                    {agentName ? `🤖 ${agentName}` : conv.type === 'direct' ? 'Личный чат' : `${conv.participants?.length || 0} участников`}
                    {' • '}
                    {new Date(conv.updated_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                  </div>
                  {conv.bound_row_id && (
                    <div className="flex items-center gap-1 text-[10px] text-blue-400/70 mt-0.5">
                      <Link2 className="w-2.5 h-2.5" />
                      <span className="truncate">
                        {conv.bound_table_icon || ''}{' '}
                        {conv.bound_table_name ? `${conv.bound_table_name}: ` : ''}
                        {conv.bound_row_title || `#${conv.bound_row_id}`}
                      </span>
                    </div>
                  )}
                </div>
                {conv.unread_count > 0 && <ChevronRight className="w-4 h-4 text-[var(--color-primary-500)]" />}
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
