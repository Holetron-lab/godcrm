/** ContactsPanelContent — ADR-119 extracted from usePanelContent.tsx
 *
 * Header layout (unified with TasksPanelContent):
 *   row 1: [🔍 search...]                  [⭐] [filter] [✕]
 *   row 2: [type dropdown] [scope toggle]   ← only when filter toggle is on
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, Star, Loader2, Users, Maximize2, ChevronUp, ChevronDown, Filter } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { AccordionContactItem } from '../../../AccordionContactItem';
import type { SharedChat } from '../../../AccordionContactItem';
import type { PanelContentDeps } from './PanelContentTypes';
import { useAuthStore } from '@/features/auth/store/authStore';

const CONTACTS_PAGE = 30;

export function ContactsPanelContent(d: PanelContentDeps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount =
    (d.userTypeFilter !== 'all' ? 1 : 0) + (!d.showAllContacts ? 1 : 0);

  // Build agent color/icon map from loaded agents (agent.id = managed_by_agent_row_id)
  const agentMap = useMemo(() => {
    const map = new Map<number, { color?: string; icon?: string }>();
    for (const agent of d.agents || []) {
      if (agent.color || agent.icon) {
        map.set(agent.id, { color: agent.color, icon: agent.icon });
      }
    }
    return map;
  }, [d.agents]);

  // Client-side lazy rendering: avatars are inline base64 data URLs (HUGE in DOM),
  // so `loading="lazy"` on <img> is a no-op. Reset visible window when filters change,
  // grow it via IntersectionObserver on a sentinel near the bottom.
  const [visibleCount, setVisibleCount] = useState(CONTACTS_PAGE);
  useEffect(() => {
    setVisibleCount(CONTACTS_PAGE);
  }, [d.contactsSearch, d.userTypeFilter, d.showAllContacts, d.showFavorites, d.filteredUsers.length]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const visibleUsers = useMemo(
    () => d.filteredUsers.slice(0, visibleCount),
    [d.filteredUsers, visibleCount]
  );
  const hasMore = visibleCount < d.filteredUsers.length;

  useEffect(() => {
    if (!hasMore) return;
    const node = sentinelRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some(e => e.isIntersecting)) {
          setVisibleCount(c => Math.min(c + CONTACTS_PAGE, d.filteredUsers.length));
        }
      },
      { rootMargin: '200px' }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasMore, d.filteredUsers.length]);

  return (
    <div className="flex flex-col h-full">
      {/* Row 1: search + favorites + filter toggle */}
      <div className="px-3 py-2 border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" />
            <input
              type="text"
              value={d.contactsSearch}
              onChange={(e) => d.setContactsSearch(e.target.value)}
              placeholder="Поиск контактов..."
              className="w-full pl-7 pr-7 py-1 text-xs rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
            />
            {d.contactsSearch && (
              <button
                onClick={() => d.setContactsSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-[var(--bg-secondary)] rounded"
              >
                <X className="w-3 h-3 text-[var(--text-tertiary)]" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => d.setShowFavorites(prev => !prev)}
            title="Избранные"
            className={cn(
              'p-1 rounded transition-colors',
              d.showFavorites
                ? 'bg-yellow-500/20 text-yellow-500'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
            )}
          >
            <Star className={cn('w-3.5 h-3.5', d.showFavorites && 'fill-current')} />
          </button>
          <button
            type="button"
            onClick={() => setFiltersOpen(o => !o)}
            title={filtersOpen ? 'Скрыть фильтры' : 'Показать фильтры'}
            className={cn(
              'relative p-1 rounded transition-colors',
              activeFilterCount > 0 || filtersOpen
                ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
            )}
          >
            <Filter className="w-3.5 h-3.5" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-1 rounded-full bg-[var(--color-primary-500)] text-[9px] text-white flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Row 2: type dropdown + scope toggle (when filter open) */}
      {filtersOpen && (
        <div className="px-3 py-1.5 border-b border-[var(--border-secondary)] flex items-center gap-2">
          <select
            value={d.userTypeFilter}
            onChange={(e) => d.setUserTypeFilter(e.target.value as 'all' | 'humans' | 'agents')}
            className="px-2 py-1 text-xs rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
          >
            <option value="all">Все</option>
            <option value="humans">Люди</option>
            <option value="agents">AI</option>
          </select>
          <button
            onClick={() => d.setShowAllContacts(prev => !prev)}
            className={cn(
              'px-2 py-1 text-xs rounded-lg transition-colors whitespace-nowrap border',
              d.showAllContacts
                ? 'bg-[var(--color-primary-500)]/15 text-[var(--color-primary-500)] border-[var(--color-primary-500)]/30'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] border-[var(--border-primary)] hover:text-[var(--text-primary)]'
            )}
            title={d.showAllContacts ? 'Показать только участников спейса' : 'Показать всех пользователей'}
          >
            {d.showAllContacts ? 'Все' : 'Спейс'}
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto min-h-0">
        {d.isLoadingUsers ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" /></div>
        ) : d.filteredUsers.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">{d.contactsSearch ? 'Не найдено' : 'Нет контактов'}</div>
        ) : (
          <>
          {visibleUsers.map(user => {
            const isInChat = d.chatParticipants.some(p => p.id === user.id);
            const isCurrent = d.chatPartner?.type === 'user' && d.chatPartner.id === user.id;
            const isFavorite = d.favorites.includes(user.id);
            const agentInfo = user.managed_by_agent_row_id ? agentMap.get(user.managed_by_agent_row_id) : undefined;
            // Prefer the icon/color the API resolved from the managing agent row — works
            // for every agent-user regardless of space/active/locked filtering of `agents`.
            // Fall back to the in-memory agentMap for any older payloads without the fields.
            const resolvedIcon = user.agent_icon ?? agentInfo?.icon;
            const resolvedColor = user.agent_color ?? agentInfo?.color;
            return (
              <AccordionContactItem key={user.id} user={user} isCurrentPartner={isCurrent} isInGroup={isInChat} isFavorite={isFavorite}
                agentColor={resolvedColor} agentIcon={resolvedIcon}
                onSelect={d.handleUserSelect}
                onSelectChat={(chat: SharedChat) => {
                  const currentUserId = Number(useAuthStore.getState().user?.id || 0);
                  const otherParticipants = (chat.participants || []).filter(p => p.user_id !== currentUserId);

                  if (chat.agent_id) {
                    // AI conversation (with agent + maybe other users)
                    const agentForConv = d.agents.find(a => a.id === chat.agent_id);
                    const partnerName = chat.title || chat.agent_name || agentForConv?.name || 'AI Agent';
                    const partnerIcon = chat.agent_icon || agentForConv?.icon || undefined;
                    if (agentForConv) d.selectAgent(agentForConv);
                    d.setChatMode('ai');
                    d.setChatPartner({ type: 'agent', id: agentForConv?.id ?? chat.agent_id, name: partnerName, icon: partnerIcon });
                    d.setChatParticipants([]);
                    d.setUserConversationId(null);
                    d.selectConversation(chat.id);
                  } else if (otherParticipants.length === 1) {
                    const partner = otherParticipants[0];
                    d.setChatPartner({ type: 'user', id: partner.user_id, name: partner.name, email: partner.email, avatarUrl: partner.avatar_url });
                    d.setChatParticipants([{ id: partner.user_id, name: partner.name, type: 'user' }]);
                    d.setUserConversationId(chat.id);
                  } else if (otherParticipants.length > 1) {
                    const displayName = chat.title || otherParticipants.map(p => p.name).join(', ');
                    d.setChatPartner({ type: 'group', id: chat.id, name: displayName, participants: otherParticipants.map(p => ({ id: p.user_id, name: p.name, type: 'user' })) });
                    d.setChatParticipants(otherParticipants.map(p => ({ id: p.user_id, name: p.name, type: 'user' })));
                    d.setUserConversationId(chat.id);
                  } else {
                    // Self-only conversation
                    const me = useAuthStore.getState().user;
                    d.setChatPartner({ type: 'user', id: Number(me?.id || 0), name: chat.title || me?.name || 'Я' });
                    d.setChatParticipants([{ id: Number(me?.id || 0), name: me?.name || 'Я', type: 'user' }]);
                    d.setUserConversationId(chat.id);
                  }

                  if (chat.bound_table_id && chat.bound_row_id) {
                    d.setBoundRows([{
                      table_id: chat.bound_table_id,
                      row_id: chat.bound_row_id,
                      table_name: chat.bound_table_name || undefined,
                      table_icon: chat.bound_table_icon || undefined,
                      row_title: chat.bound_row_title || undefined,
                    }]);
                    d.setShowBoundRowsBar(true);
                  } else {
                    d.setBoundRows([]);
                    d.setShowBoundRowsBar(false);
                  }

                  d.markAsReadMutation.mutate(chat.id);
                  d.setActivePanel('none');
                }}
                onToggleFavorite={d.toggleFavorite} onAddToGroup={d.handleAddToGroup}
                onCreateNewChat={(targetUser: typeof user) => {
                  d.forceNewChatRef.current = true; d.createNewConversation(); d.setUserConversationId(null);
                  const targetAgentInfo = targetUser.managed_by_agent_row_id ? agentMap.get(targetUser.managed_by_agent_row_id) : undefined;
                  d.setChatPartner({ type: 'user', id: targetUser.id, name: targetUser.name, avatarUrl: targetUser.avatar_url ?? undefined, email: targetUser.email ?? undefined, icon: targetUser.agent_icon ?? targetAgentInfo?.icon });
                  d.setChatParticipants([{ type: targetUser.managed_by_agent_table_id ? 'agent' : 'user', id: targetUser.id, name: targetUser.name, email: targetUser.email ?? undefined, avatar: targetUser.avatar_url ?? undefined }]);
                  d.setBoundRows([]); d.setShowBoundRowsBar(false);
                  d.setActivePanel('none');
                }}
              />
            );
          })}
          {hasMore && (
            <div ref={sentinelRef} className="flex items-center justify-center py-3">
              <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />
            </div>
          )}
          </>
        )}
      </div>
      <div className="px-3 py-1.5 border-t border-[var(--border-secondary)] bg-[var(--bg-tertiary)] flex items-center justify-between gap-2 text-[10px] text-[var(--text-tertiary)] flex-shrink-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Users className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">Контакты</span>
          <span className="flex-shrink-0">·</span>
          <span className="flex-shrink-0">
            {hasMore ? `${visibleUsers.length} / ${d.filteredUsers.length}` : d.filteredUsers.length}
            {typeof d.usersTotalCount === 'number' && d.usersTotalCount !== d.filteredUsers.length ? ` (из ${d.usersTotalCount})` : ''}
          </span>
        </div>
        {d.togglePanelMode && (
          <button
            type="button"
            onClick={d.togglePanelMode}
            title={d.panelMode === 'fullscreen' ? 'Свернуть' : 'Развернуть'}
            className="p-1 rounded hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] flex-shrink-0"
          >
            {d.panelMode === 'fullscreen' ? <ChevronDown className="w-3 h-3" /> :
             d.panelMode === 'collapsed' ? <ChevronUp className="w-3 h-3" /> :
             <Maximize2 className="w-3 h-3" />}
          </button>
        )}
      </div>
    </div>
  );
}
