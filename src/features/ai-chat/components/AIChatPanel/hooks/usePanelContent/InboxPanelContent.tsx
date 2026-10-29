import { useLanguage } from '@/shared/i18n/LanguageContext';
/** InboxPanelContent — ADR-119 extracted from usePanelContent.tsx */
import React, { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Loader2, Users, User, Bot, Inbox, Filter, Pencil, Link2, Trash2, MessageSquare, Mail, ChevronDown, ArrowUpDown, ArrowUp, ArrowDown, Star, Bell, Settings } from 'lucide-react';
import { ConversationDescription } from './ConversationDescription';
import { PerChatSettingsInline, type PerChatSettingsTab } from '../../../ChatNotifications/PerChatSettingsInline';
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
  const { t, language } = useLanguage();
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
        <label className="text-[10px] text-[var(--text-tertiary)]">{t('aiChat.ui.participants')}</label>
        {selected.length >= 2 && (
          <div className="flex items-center gap-1">
            <button onClick={() => onModeChange('any')}
              className={cn("px-2 py-0.5 text-[10px] rounded-full border transition-colors",
                mode === 'any'
                  ? "bg-[var(--color-primary-500)]/20 border-[var(--color-primary-500)]/40 text-[var(--color-primary-500)]"
                  : "border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              )}>
              {t('aiChat.ui.anyOf')}</button>
            <button onClick={() => onModeChange('all')}
              className={cn("px-2 py-0.5 text-[10px] rounded-full border transition-colors",
                mode === 'all'
                  ? "bg-[var(--color-primary-500)]/20 border-[var(--color-primary-500)]/40 text-[var(--color-primary-500)]"
                  : "border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              )}>
              {t('aiChat.ui.allOf')}</button>
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
          <span className="truncate">{t('aiChat.ui.addParticipant')}</span>
          <ChevronDown className={cn("w-3 h-3 ml-1 flex-shrink-0 transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <div className="absolute z-50 mt-1 w-full max-h-40 overflow-y-auto rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] shadow-lg">
            {unselectedOptions.length === 0 ? (
              <div className="px-2 py-1.5 text-[10px] text-[var(--text-tertiary)]">{t('aiChat.ui.allParticipantsSelected')}</div>
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
  const { t, language } = useLanguage();
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
    { key: 'created', label: t('aiChat.ui.byCreationDate') },
    { key: 'updated', label: t('aiChat.ui.byLastMessage') },
  ];

  return (
    <>
      <button ref={btnRef} onClick={handleOpen}
        className={cn("p-1 rounded transition-colors", open ? "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]")}
        title={t('kanban.sort')}>
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

function chatDescription(settings: unknown): string {
  try {
    const value: unknown = typeof settings === 'string' ? JSON.parse(settings) : settings;
    return value && typeof value === 'object' && 'description' in value && typeof value.description === 'string' ? value.description : '';
  } catch { return ''; }
}

function chatIcon(settings: unknown): string {
  try {
    const value: unknown = typeof settings === 'string' ? JSON.parse(settings) : settings;
    return value && typeof value === 'object' && 'icon' in value && typeof value.icon === 'string' ? value.icon : '';
  } catch { return ''; }
}

function chatColor(settings: unknown): string | undefined {
  try {
    const value: unknown = typeof settings === 'string' ? JSON.parse(settings) : settings;
    return value && typeof value === 'object' && 'color' in value && typeof value.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : undefined;
  } catch { return undefined; }
}

function readChatFavorites(key: string): number[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.filter((id: unknown): id is number => typeof id === 'number') : [];
  } catch { return []; }
}

export function InboxPanelContent(d: PanelContentDeps) {
  const { t, language } = useLanguage();
  const safeAgents = d.safeAgents;
  const currentUserId = useAuthStore.getState().user?.id;

  const favoriteKey = `chat-conversation-favorites:${currentUserId}:${d.effectiveSpaceId}`;
  const [favoriteChats, setFavoriteChats] = useState<number[]>(() => readChatFavorites(favoriteKey));
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [expandedChat, setExpandedChat] = useState<{ id: number; tab: PerChatSettingsTab } | null>(null);
  const [hasUnsavedDescription, setHasUnsavedDescription] = useState(false);
  const showChatSettings = (next: { id: number; tab: PerChatSettingsTab } | null) => {
    if (next?.id !== expandedChat?.id) {
      if (hasUnsavedDescription && !window.confirm(t('aiChat.ui.discardConfigurationDraft'))) return;
      setHasUnsavedDescription(false);
    }
    setExpandedChat(next);
  };
  useEffect(() => { setFavoriteChats(readChatFavorites(favoriteKey)); }, [favoriteKey]);
  const toggleFavoriteChat = (id: number) => {
    const next = favoriteChats.includes(id) ? favoriteChats.filter(value => value !== id) : [...favoriteChats, id];
    setFavoriteChats(next);
    try { localStorage.setItem(favoriteKey, JSON.stringify(next)); } catch { /* Session favorites remain usable when storage is unavailable. */ }
  };

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
    return all.filter(c => (d.inboxTypeFilter === 'all' || c._chatType === d.inboxTypeFilter) && (!favoritesOnly || favoriteChats.includes(c.id)));
  }, [d.inboxConversations, d.inboxTypeFilter, currentUserId, safeAgents, favoritesOnly, favoriteChats]);

  return (
    <div className="flex flex-col h-full">
      {/* Header: search + sort + unread (with badge) + filter */}
      <div className="px-3 py-2 border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label={t('aiChat.ui.favoritesOnly')} aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(v => !v)} className="p-1 rounded text-[var(--text-secondary)] focus-visible:ring-2"><Star className={cn('w-3.5 h-3.5', favoritesOnly && 'fill-current text-yellow-400')} /></button>
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" />
            <input type="text" value={d.inboxSearch} onChange={(e) => d.setInboxSearch(e.target.value)} placeholder={t('aiChat.ui.searchChats')}
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
            )} title={t('aiChat.ui.unreadOnly')}>
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
            )} title={t('aiChat.ui.filters')}>
            <Filter className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Filters panel (type + participants + date) */}
      {d.showInboxFilters && (
        <div className="px-3 py-2 border-b border-[var(--border-secondary)] space-y-2 bg-[var(--bg-secondary)]">
          {/* Chat type filter (moved from header) */}
          <div>
            <label className="text-[10px] text-[var(--text-tertiary)] mb-0.5 block">{t('aiChat.ui.chatType')}</label>
            <select
              value={d.inboxTypeFilter}
              onChange={(e) => d.setInboxTypeFilter(e.target.value as any)}
              className="w-full text-xs bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg px-2 py-1 text-[var(--text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30 cursor-pointer"
            >
              <option value="all">{t('aiChat.ui.allChats')}</option>
              <option value="ai">{t('aiChat.ui.aIChats')}</option>
              <option value="group">{t('aiChat.ui.groupChats')}</option>
              <option value="direct">{t('aiChat.ui.directChats')}</option>
              <option value="service">{t('aiChat.ui.serviceChats')}</option>
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
              <label className="text-[10px] text-[var(--text-tertiary)] mb-0.5 block">{t('table.fromDate')}</label>
              <input type="date" value={d.inboxDateFrom} onChange={(e) => d.setInboxDateFrom(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30" />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-[var(--text-tertiary)] mb-0.5 block">{t('table.toDate')}</label>
              <input type="date" value={d.inboxDateTo} onChange={(e) => d.setInboxDateTo(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30" />
            </div>
          </div>
          {(d.hasActiveInboxFilters || d.inboxTypeFilter !== 'all') && (
            <button onClick={() => { d.setInboxSearch(''); d.setInboxAgentFilter(''); d.setInboxUserFilter([]); d.setInboxDateFrom(''); d.setInboxDateTo(''); d.setInboxTypeFilter('all'); }}
              className="text-[10px] text-[var(--color-primary-500)] hover:underline">{t('aiChat.ui.resetFilters')}</button>
          )}
        </div>
      )}

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {d.isLoadingInbox ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" /></div>
        ) : enrichedConversations.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">{d.hasActiveInboxFilters || d.inboxTypeFilter !== 'all' ? t('columnSettings.nothingFound') : t('aiChat.ui.noActiveConversations')}</div>
        ) : (
          <>
          {enrichedConversations.map(conv => {
            const otherParticipants = conv.participants?.filter(p => currentUserId && p.user_id !== Number(currentUserId)) || [];
            const agentForConv = conv.agent_id ? safeAgents.find(a => a.id === conv.agent_id) : null;
            const agentName = conv.agent_name || agentForConv?.name || null;
            // Resolve agent icon: from conversation, from matched agent, or from participant name lookup
            let agentIcon = chatIcon(conv.settings) || conv.agent_icon || agentForConv?.icon || null;
            if (!agentIcon && otherParticipants.length > 0) {
              const agentParticipant = otherParticipants.find(p => p.user_type === 'agent');
              if (agentParticipant) {
                const match = agentNameMap.get(agentParticipant.name.toLowerCase());
                if (match?.icon) agentIcon = match.icon;
              }
            }
            const displayName = conv.title || otherParticipants.map(p => p.name).join(', ') || agentName || t('aiChat.ui.conversation');
            const chatType = conv._chatType;
            const colors = typeColors[chatType] || typeColors.direct;
            const avatarColor = chatColor(conv.settings);
            const totalMessages = (conv as any).participant_msg_counts?.reduce((sum: number, mc: any) => sum + mc.count, 0) || 0;
            const hasUnread = conv.unread_count > 0;

            const openConversation = () => {
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
                    d.setChatPartner({ type: 'user', id: Number(currentUser?.id || 0), name: conv.title || currentUser?.name || t('aiChat.ui.me') });
                    d.setChatParticipants([{ id: Number(currentUser?.id || 0), name: currentUser?.name || t('aiChat.ui.me'), type: 'user' }]);
                  }
                  if (otherParticipants.length > 0 || !conv.agent_id) d.setUserConversationId(conv.id);
                  if (conv.bound_table_id && conv.bound_row_id) {
                    d.setBoundRows([{ table_id: conv.bound_table_id, row_id: conv.bound_row_id, table_name: conv.bound_table_name || undefined, table_icon: conv.bound_table_icon || undefined, row_title: conv.bound_row_title || undefined }]);
                    d.setShowBoundRowsBar(true);
                  } else { d.setBoundRows([]); d.setShowBoundRowsBar(false); }
                  d.markAsReadMutation.mutate(conv.id); d.setActivePanel('none');
                 };
            return (
              <div key={conv.id} className="border-b border-[var(--border-secondary)]">
              <div
                className={cn(
                  "group w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[var(--bg-tertiary)] transition-colors text-left",
                  hasUnread && "bg-[var(--color-primary-500)]/5"
                )}
              >
                {/* Colored icon with type indicator */}
                <button type="button" onClick={openConversation} aria-label={displayName} className="relative flex-shrink-0 focus-visible:ring-2">
                  <div className={cn("w-9 h-9 rounded-full flex items-center justify-center", colors.bg)} style={avatarColor ? { backgroundColor: `${avatarColor}33`, color: avatarColor } : undefined}>
                    {agentIcon ? <span className="text-base">{agentIcon}</span> :
                     chatType === 'ai' ? <Bot className={cn("w-4.5 h-4.5", avatarColor ? 'text-current' : colors.icon)} /> :
                     chatType === 'group' ? <Users className={cn("w-4.5 h-4.5", avatarColor ? 'text-current' : colors.icon)} /> :
                     <User className={cn("w-4.5 h-4.5", avatarColor ? 'text-current' : colors.icon)} />}
                  </div>
                </button>

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
                      />
                  ) : (
                    <div className={cn("text-sm truncate flex items-center gap-1 group/inbox-title", hasUnread ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>
                      <button type="button" onClick={openConversation} className="truncate text-left focus-visible:ring-2" onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); d.setInboxRenamingId(conv.id); d.setInboxRenamingTitle(displayName); setTimeout(() => d.inboxRenameInputRef.current?.select(), 50); }}>{displayName}</button>
                      <button onClick={(e) => { e.stopPropagation(); d.setInboxRenamingId(conv.id); d.setInboxRenamingTitle(displayName); setTimeout(() => d.inboxRenameInputRef.current?.select(), 50); }}
                        className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover/inbox-title:opacity-100 hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-all" title={t('aiChat.ui.rename')}>
                        <Pencil className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  )}
                  {chatDescription(conv.settings) && <p className="text-xs text-[var(--text-secondary)] truncate" title={chatDescription(conv.settings)}>{chatDescription(conv.settings)}</p>}
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
                      {chatType === 'ai' ? 'AI' : chatType === 'group' ? t('aiChat.ui.group') : t('aiChat.ui.direct')}
                    </span>
                    <span className="truncate">
                      {t('aiChat.ui.participantCount', { count: conv.participants?.length || 0 })}
                      {' \u00b7 '}
                      {new Date(conv.updated_at).toLocaleDateString(language, { day: 'numeric', month: 'short' })}
                    </span>
                    <span className="flex-1" />
                    {/* Message count: unread/total */}
                    {totalMessages > 0 && (
                      <span className={cn("text-[9px] tabular-nums", hasUnread ? "font-bold text-[var(--color-primary-500)]" : "text-[var(--text-tertiary)]")}>
                        {hasUnread ? `${conv.unread_count}/` : ''}{totalMessages}
                      </span>
                    )}
                    <button type="button" aria-label={favoriteChats.includes(conv.id) ? t('aiChat.ui.removeFromFavorites') : t('aiChat.ui.addToFavorites')} aria-pressed={favoriteChats.includes(conv.id)} onClick={() => toggleFavoriteChat(conv.id)} className="p-1 rounded focus-visible:ring-2"><Star className={cn('w-3 h-3', favoriteChats.includes(conv.id) && 'fill-current text-yellow-400')} /></button>
                    <button type="button" aria-label={t('statusBar.notifications')} aria-expanded={expandedChat?.id === conv.id && expandedChat.tab === 'notifications'} onClick={() => showChatSettings(expandedChat?.id === conv.id && expandedChat.tab === 'notifications' ? null : { id: conv.id, tab: 'notifications' })} className="p-1 rounded focus-visible:ring-2"><Bell className="w-3 h-3" /></button>
                    <button type="button" aria-label={t('aiChat.ui.chatSettings')} aria-expanded={expandedChat?.id === conv.id && expandedChat.tab === 'participants'} onClick={() => showChatSettings(expandedChat?.id === conv.id && expandedChat.tab === 'participants' ? null : { id: conv.id, tab: 'participants' })} className="p-1 rounded focus-visible:ring-2"><Settings className="w-3 h-3" /></button>
                    <button onClick={(e) => { e.stopPropagation(); if (confirm(t('aiChat.ui.deleteChat'))) { d.deleteConversation(conv.id); setTimeout(() => d.refetchInbox(), 500); } }}
                      className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-[var(--text-tertiary)] hover:text-red-400 transition-all" title={t('aiChat.ui.deleteChat')}>
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>
              </div>
              {expandedChat?.id === conv.id && <div className="bg-[var(--bg-tertiary)]/40">
                <ConversationDescription key={conv.id} conversationId={conv.id} summaryAgentId={d.summaryAgentId} onSaved={d.refetchInbox} onDirtyChange={setHasUnsavedDescription} />
                <PerChatSettingsInline conversationId={conv.id} conversationTitle={displayName} initialTab={expandedChat.tab} currentUserId={currentUserId ? Number(currentUserId) : null} onClose={() => showChatSettings(null)} />
              </div>}
              </div>
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
