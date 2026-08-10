/** InboxPanelContent — ADR-119 extracted from usePanelContent.tsx */
import React, { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Loader2, Users, User, Bot, Inbox, Filter, Pencil, Link2, Trash2, MessageSquare, Mail, ChevronDown, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useAuthStore } from '@/features/auth/store/authStore';
import type { PanelContentDeps } from './PanelContentTypes';

/** Determine chat type from conversation data */
function getChatType(conv: any, currentUserId: number | undefined, safeAgents: any[]): 'ai' | 'group' | 'direct' | 'service' {
  const otherParticipants = conv.participants?.filter((p: any) => currentUserId && p.user_id !== Number(currentUserId)) || [];
  // If has agent_id or matched agent → AI chat
  if (conv.agent_id || safeAgents.find((a: any) => a.id === conv.agent_id)) return 'ai';
  // If any participant is a service account → service chat
  if (otherParticipants.some((p: any) => p.user_type === 'service' || p.account_type === 'service')) return 'service';
  // If 2+ other participants → group
  if (otherParticipants.length > 1) return 'group';
  // If 1 other participant → direct (1-on-1)
  if (otherParticipants.length === 1) return 'direct';
  // Solo chat (only current user) — treat as AI if has agent, else direct
  return 'direct';
}

/** Color config per chat type */
const typeColors: Record<string, { bg: string; text: string; icon: string }> = {
  ai: { bg: 'bg-purple-500/20', text: 'text-purple-400', icon: 'text-purple-400' },
  group: { bg: 'bg-blue-500/20', text: 'text-blue-400', icon: 'text-blue-400' },
  direct: { bg: 'bg-green-500/20', text: 'text-green-400', icon: 'text-green-400' },
  service: { bg: 'bg-orange-500/20', text: 'text-orange-400', icon: 'text-orange-400' },
};

/** Participant filter: label + mode toggle on top row, tags below, add-select at bottom */
function ParticipantFilter({ selected, onChange, options, mode, onModeChange }: {
  selected: string[];
  onChange: (v: string[]) => void;
  options: Array<{ id: number; name: string; avatar_url?: string | null }>;
  mode: 'any' | 'all';
  onModeChange: (v: 'any' | 'all') => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);
  };

  // Filter out already-selected from dropdown
  const unselectedOptions = options.filter(o => !selected.includes(String(o.id)));

  return (
    <div className="space-y-1.5">
      {/* Row 1: "Участники" label + any/all toggle */}
      <div className="flex items-center justify-between">
        <label className="text-[10px] text-[var(--text-tertiary)]">Участники</label>
        {selected.length >= 2 && (
          <div className="flex items-center gap-1">
            <button onClick={() => onModeChange('any')}
              className={cn("px-2 py-0.5 text-[10px] rounded-full border transition-colors",
                mode === 'any'
                  ? "bg-[var(--color-primary-500)]/20 border-[var(--color-primary-500)]/40 text-[var(--color-primary-500)]"
                  : "border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              )}>
              Любой из
            </button>
            <button onClick={() => onModeChange('all')}
              className={cn("px-2 py-0.5 text-[10px] rounded-full border transition-colors",
                mode === 'all'
                  ? "bg-[var(--color-primary-500)]/20 border-[var(--color-primary-500)]/40 text-[var(--color-primary-500)]"
                  : "border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              )}>
              Все вместе
            </button>
          </div>
        )}
      </div>
      {/* Row 2: Selected participant tags */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {options.filter(o => selected.includes(String(o.id))).map(o => (
            <span key={o.id} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded-full bg-[var(--color-primary-500)]/15 text-[var(--color-primary-500)]">
              {o.name}
              <button onClick={() => toggle(String(o.id))} className="hover:text-[var(--text-primary)]">
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      {/* Row 3: "Добавить участника" dropdown */}
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between px-2 py-1 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
        >
          <span className="truncate">Добавить участника...</span>
          <ChevronDown className={cn("w-3 h-3 ml-1 flex-shrink-0 transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <div className="absolute z-50 mt-1 w-full max-h-40 overflow-y-auto rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] shadow-lg">
            {unselectedOptions.length === 0 ? (
              <div className="px-2 py-1.5 text-[10px] text-[var(--text-tertiary)]">Все участники выбраны</div>
            ) : unselectedOptions.map(o => (
              <button
                key={o.id}
                onClick={() => { toggle(String(o.id)); setOpen(false); }}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-left hover:bg-[var(--bg-secondary)] transition-colors"
              >
                <span className="truncate">{o.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Sort button with portal dropdown */
function SortButton({ sortBy, setSortBy, sortDir, setSortDir }: {
  sortBy: 'created' | 'updated';
  setSortBy: (v: 'created' | 'updated') => void;
  sortDir: 'asc' | 'desc';
  setSortDir: (v: 'asc' | 'desc') => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node) &&
          btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen(!open);
  };

  const options: Array<{ key: 'created' | 'updated'; label: string }> = [
    { key: 'created', label: 'По дате создания' },
    { key: 'updated', label: 'По последнему сообщению' },
  ];

  return (
    <>
      <button ref={btnRef} onClick={handleOpen}
        className={cn("p-1 rounded transition-colors", open ? "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]")}
        title="Сортировка">
        <ArrowUpDown className="w-3.5 h-3.5" />
      </button>
      {open && createPortal(
        <div ref={dropRef} className="fixed z-[9999] min-w-[200px] rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] shadow-xl py-1"
          style={{ top: pos.top, right: pos.right }}>
          {options.map(opt => (
            <button key={opt.key}
              onClick={() => {
                if (sortBy === opt.key) {
                  setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
                } else {
                  setSortBy(opt.key);
                  setSortDir('desc');
                }
              }}
              className={cn(
                "w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-left hover:bg-[var(--bg-secondary)] transition-colors",
                sortBy === opt.key && "text-[var(--color-primary-500)]"
              )}>
              <span>{opt.label}</span>
              {sortBy === opt.key && (
                sortDir === 'desc' ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />
              )}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

export function InboxPanelContent(d: PanelContentDeps) {
  const safeAgents = d.safeAgents;
  const currentUserId = useAuthStore.getState().user?.id;

  // Build agent name→icon map for resolving agent avatars in inbox items
  const agentNameMap = useMemo(() => {
    const map = new Map<string, { icon?: string; color?: string }>();
    for (const agent of safeAgents || []) {
      if (agent.name && (agent.icon || agent.color)) {
        map.set(agent.name.toLowerCase(), { icon: agent.icon, color: agent.color });
      }
    }
    return map;
  }, [safeAgents]);

  // Infinite scroll: observe a sentinel element at the bottom of the list
  const sentinelRef = useRef<HTMLDivElement>(null);
  const handleLoadMore = useCallback(() => {
    if (d.hasNextInboxPage && !d.isFetchingNextInboxPage) {
      d.fetchNextInboxPage();
    }
  }, [d.hasNextInboxPage, d.isFetchingNextInboxPage, d.fetchNextInboxPage]);

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

  // Enrich conversations with computed type + filter by type
  const enrichedConversations = useMemo(() => {
    const all = (d.inboxConversations || []).map(conv => ({
      ...conv,
      _chatType: getChatType(conv, currentUserId ? Number(currentUserId) : undefined, safeAgents),
    }));
    if (d.inboxTypeFilter === 'all') return all;
    return all.filter(c => c._chatType === d.inboxTypeFilter);
  }, [d.inboxConversations, d.inboxTypeFilter, currentUserId, safeAgents]);

  return (
    <div className="flex flex-col h-full">
      {/* Header: search + sort + unread (with badge) + filter */}
      <div className="px-3 py-2 border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" />
            <input type="text" value={d.inboxSearch} onChange={(e) => d.setInboxSearch(e.target.value)} placeholder="Поиск чатов..."
              className="w-full pl-7 pr-7 py-1 text-xs rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30" />
            {d.inboxSearch && (
              <button onClick={() => d.setInboxSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-[var(--bg-secondary)] rounded">
                <X className="w-3 h-3 text-[var(--text-tertiary)]" />
              </button>
            )}
          </div>
          <SortButton sortBy={d.inboxSortBy} setSortBy={d.setInboxSortBy} sortDir={d.inboxSortDir} setSortDir={d.setInboxSortDir} />
          <button onClick={() => d.setInboxUnreadOnly(!d.inboxUnreadOnly)}
            className={cn("relative p-1 rounded transition-colors",
              d.inboxUnreadOnly ? "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            )} title="Только непрочитанные">
            <Mail className="w-3.5 h-3.5" />
            {d.totalUnreadCount > 0 && (
              <span className="absolute -top-1 -right-1.5 min-w-[16px] h-[16px] px-0.5 text-[9px] font-bold rounded-full bg-red-500 text-white flex items-center justify-center leading-none">
                {d.totalUnreadCount > 99 ? '99+' : d.totalUnreadCount}
              </span>
            )}
          </button>
          <button onClick={() => d.setShowInboxFilters(prev => !prev)}
            className={cn("p-1 rounded transition-colors",
              d.showInboxFilters || d.hasActiveInboxFilters ? "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            )} title="Фильтры">
            <Filter className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Filters panel (type + participants + date) */}
      {d.showInboxFilters && (
        <div className="px-3 py-2 border-b border-[var(--border-secondary)] space-y-2 bg-[var(--bg-secondary)]">
          {/* Chat type filter (moved from header) */}
          <div>
            <label className="text-[10px] text-[var(--text-tertiary)] mb-0.5 block">Тип чата</label>
            <select
              value={d.inboxTypeFilter}
              onChange={(e) => d.setInboxTypeFilter(e.target.value as any)}
              className="w-full text-xs bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg px-2 py-1 text-[var(--text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30 cursor-pointer"
            >
              <option value="all">Все чаты</option>
              <option value="ai">AI чаты</option>
              <option value="group">Групповые</option>
              <option value="direct">Личные</option>
              <option value="service">Сервисные</option>
            </select>
          </div>
          {/* Participant filter with inline mode toggle */}
          <ParticipantFilter
            selected={d.inboxUserFilter}
            onChange={d.setInboxUserFilter}
            options={d.inboxUserOptions}
            mode={d.inboxParticipantMode}
            onModeChange={d.setInboxParticipantMode}
          />
          {/* Date range */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-[var(--text-tertiary)] mb-0.5 block">От</label>
              <input type="date" value={d.inboxDateFrom} onChange={(e) => d.setInboxDateFrom(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30" />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-[var(--text-tertiary)] mb-0.5 block">До</label>
              <input type="date" value={d.inboxDateTo} onChange={(e) => d.setInboxDateTo(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30" />
            </div>
          </div>
          {(d.hasActiveInboxFilters || d.inboxTypeFilter !== 'all') && (
            <button onClick={() => { d.setInboxSearch(''); d.setInboxAgentFilter(''); d.setInboxUserFilter([]); d.setInboxDateFrom(''); d.setInboxDateTo(''); d.setInboxTypeFilter('all'); }}
              className="text-[10px] text-[var(--color-primary-500)] hover:underline">Сбросить фильтры</button>
          )}
        </div>
      )}

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {d.isLoadingInbox ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" /></div>
        ) : enrichedConversations.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">{d.hasActiveInboxFilters || d.inboxTypeFilter !== 'all' ? 'Ничего не найдено' : 'Нет активных бесед'}</div>
        ) : (
          <>
          {enrichedConversations.map(conv => {
            const otherParticipants = conv.participants?.filter(p => currentUserId && p.user_id !== Number(currentUserId)) || [];
            const agentForConv = conv.agent_id ? safeAgents.find(a => a.id === conv.agent_id) : null;
            const agentName = conv.agent_name || agentForConv?.name || null;
            // Resolve agent icon: from conversation, from matched agent, or from participant name lookup
            let agentIcon = conv.agent_icon || agentForConv?.icon || null;
            if (!agentIcon && otherParticipants.length > 0) {
              const agentParticipant = otherParticipants.find(p => p.user_type === 'agent');
              if (agentParticipant) {
                const match = agentNameMap.get(agentParticipant.name.toLowerCase());
                if (match?.icon) agentIcon = match.icon;
              }
            }
            const displayName = conv.title || otherParticipants.map(p => p.name).join(', ') || agentName || 'Беседа';
            const chatType = conv._chatType;
            const colors = typeColors[chatType] || typeColors.direct;
            const totalMessages = (conv as any).participant_msg_counts?.reduce((sum: number, mc: any) => sum + mc.count, 0) || 0;
            const hasUnread = conv.unread_count > 0;

            return (
              <button key={conv.id}
                onClick={() => {
                  if (otherParticipants.length === 1) {
                    const partner = otherParticipants[0];
                    const partnerIcon = partner.user_type === 'agent' ? agentIcon : undefined;
                    d.setChatPartner({ type: 'user', id: partner.user_id, name: partner.name, email: partner.email, avatarUrl: partner.avatar_url, icon: partnerIcon || undefined });
                    d.setChatParticipants([{ id: partner.user_id, name: partner.name, type: 'user' }]);
                  } else if (otherParticipants.length > 1) {
                    d.setChatPartner({ type: 'group', id: conv.id, name: displayName, participants: otherParticipants.map(p => ({ id: p.user_id, name: p.name, type: 'user' as const })) });
                    d.setChatParticipants(otherParticipants.map(p => ({ id: p.user_id, name: p.name, type: 'user' as const })));
                  } else if (agentForConv) {
                    const partnerName = conv.title || agentForConv.name;
                    d.selectAgent(agentForConv); d.setChatMode('ai');
                    d.setChatPartner({ type: 'agent', id: agentForConv.id, name: partnerName, icon: agentForConv.icon });
                    d.setChatParticipants([]); d.selectConversation(conv.id);
                  } else if (conv.agent_id) {
                    const partnerName = conv.title || conv.agent_name || 'AI Agent';
                    d.setChatMode('ai');
                    d.setChatPartner({ type: 'agent', id: conv.agent_id, name: partnerName, icon: conv.agent_icon || undefined });
                    d.setChatParticipants([]); d.selectConversation(conv.id);
                  } else {
                    const currentUser = useAuthStore.getState().user;
                    d.setChatPartner({ type: 'user', id: Number(currentUser?.id || 0), name: conv.title || currentUser?.name || 'Я' });
                    d.setChatParticipants([{ id: Number(currentUser?.id || 0), name: currentUser?.name || 'Я', type: 'user' }]);
                  }
                  if (!conv.agent_id) d.setUserConversationId(conv.id);
                  if (conv.bound_table_id && conv.bound_row_id) {
                    d.setBoundRows([{ table_id: conv.bound_table_id, row_id: conv.bound_row_id, table_name: conv.bound_table_name || undefined, table_icon: conv.bound_table_icon || undefined, row_title: conv.bound_row_title || undefined }]);
                    d.setShowBoundRowsBar(true);
                  } else { d.setBoundRows([]); d.setShowBoundRowsBar(false); }
                  d.markAsReadMutation.mutate(conv.id); d.setActivePanel('none');
                }}
                className={cn(
                  "group w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[var(--bg-tertiary)] transition-colors text-left",
                  hasUnread && "bg-[var(--color-primary-500)]/5"
                )}
              >
                {/* Colored icon with type indicator */}
                <div className="relative flex-shrink-0">
                  <div className={cn("w-9 h-9 rounded-full flex items-center justify-center", colors.bg)}>
                    {agentIcon ? <span className="text-base">{agentIcon}</span> :
                     chatType === 'ai' ? <Bot className={cn("w-4.5 h-4.5", colors.icon)} /> :
                     chatType === 'group' ? <Users className={cn("w-4.5 h-4.5", colors.icon)} /> :
                     <User className={cn("w-4.5 h-4.5", colors.icon)} />}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {d.inboxRenamingId === conv.id ? (
                    <input ref={d.inboxRenameInputRef} type="text" value={d.inboxRenamingTitle}
                      onChange={(e) => d.setInboxRenamingTitle(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                          const newTitle = d.inboxRenamingTitle.trim();
                          if (newTitle) { d.renameConversation(conv.id, newTitle); const activeId = d.userConversationId || d.currentConversationId; if (activeId === conv.id && d.chatPartner) d.setChatPartner({ ...d.chatPartner, name: newTitle }); }
                          d.setInboxRenamingId(null);
                        } else if (e.key === 'Escape') d.setInboxRenamingId(null);
                      }}
                      onBlur={() => {
                        const newTitle = d.inboxRenamingTitle.trim();
                        if (newTitle) { d.renameConversation(conv.id, newTitle); const activeId = d.userConversationId || d.currentConversationId; if (activeId === conv.id && d.chatPartner) d.setChatPartner({ ...d.chatPartner, name: newTitle }); }
                        d.setInboxRenamingId(null);
                      }}
                      className="w-full px-1.5 py-0.5 text-xs bg-[var(--bg-tertiary)] border border-[var(--color-primary-500)]/40 rounded text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/50"
                      autoFocus />
                  ) : (
                    <div className={cn("text-sm truncate flex items-center gap-1 group/inbox-title", hasUnread ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>
                      <span className="truncate" onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); d.setInboxRenamingId(conv.id); d.setInboxRenamingTitle(displayName); setTimeout(() => d.inboxRenameInputRef.current?.select(), 50); }}>{displayName}</span>
                      <button onClick={(e) => { e.stopPropagation(); d.setInboxRenamingId(conv.id); d.setInboxRenamingTitle(displayName); setTimeout(() => d.inboxRenameInputRef.current?.select(), 50); }}
                        className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover/inbox-title:opacity-100 hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-all" title="Переименовать">
                        <Pencil className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  )}
                  {/* Bound row */}
                  {conv.bound_row_id && (
                    <div className="flex items-center gap-1 text-[10px] text-blue-400/70 mt-0.5">
                      <Link2 className="w-2.5 h-2.5 flex-shrink-0" />
                      <span className="truncate">{conv.bound_table_icon || ''}{' '}{conv.bound_table_name ? `${conv.bound_table_name}: ` : ''}{conv.bound_row_title || `#${conv.bound_row_id}`}</span>
                    </div>
                  )}
                  {/* Per-participant message counts */}
                  {(conv as any).participant_msg_counts?.length > 0 && (
                    <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5 truncate">
                      {(conv as any).participant_msg_counts.map((mc: any, i: number) => (
                        <span key={mc.sender_id}>{i > 0 ? ', ' : ''}{mc.name}: {mc.count}</span>
                      ))}
                    </div>
                  )}
                  {/* Date + type + delete */}
                  <div className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)] mt-0.5">
                    <span className={cn("px-1 py-px rounded text-[9px] font-medium", colors.bg, colors.text)}>
                      {chatType === 'ai' ? 'AI' : chatType === 'group' ? 'Группа' : 'Личный'}
                    </span>
                    <span className="truncate">
                      {conv.participants?.length || 0} уч.
                      {' \u00b7 '}
                      {new Date(conv.updated_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                    </span>
                    <span className="flex-1" />
                    {/* Message count: unread/total */}
                    {totalMessages > 0 && (
                      <span className={cn("text-[9px] tabular-nums", hasUnread ? "font-bold text-[var(--color-primary-500)]" : "text-[var(--text-tertiary)]")}>
                        {hasUnread ? `${conv.unread_count}/` : ''}{totalMessages}
                      </span>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); if (confirm('Удалить чат?')) { d.deleteConversation(conv.id); setTimeout(() => d.refetchInbox(), 500); } }}
                      className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-[var(--text-tertiary)] hover:text-red-400 transition-all" title="Удалить чат">
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>
              </button>
            );
          })}
          {/* Sentinel for infinite scroll */}
          <div ref={sentinelRef} className="h-1" />
          {d.isFetchingNextInboxPage && (
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
