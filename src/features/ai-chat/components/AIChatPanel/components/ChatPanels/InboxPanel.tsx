/**
 * InboxPanel Component — Unified Conversation Browser
 * Ticket #81449: Replaces both old InboxPanel and HistoryPanel
 *
 * Shows ALL conversations (user-to-user + AI agent chats) with filters:
 * - Search by title/message
 * - Filter by agent
 * - Filter by date range
 * - Sort by date/name
 */

import { useState, useMemo } from 'react';
import { Inbox, Loader2, User, Users, ChevronDown, Bot, Search, X, Calendar, SlidersHorizontal, Trash2 } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useAuthStore } from '@/features/auth/store/authStore';
import { InboxConversation, PanelTab, ChatPartner, Agent } from '../../types';
import { Participant } from '../../../../components/ParticipantSelector';

type DateFilter = 'all' | 'today' | 'week' | 'month';
type SortBy = 'date' | 'name' | 'unread';

interface InboxPanelProps {
  totalUnreadCount: number;
  inboxConversations: InboxConversation[];
  isLoadingInbox: boolean;
  /** AI conversations from context (merged into unified list) */
  aiConversations?: InboxConversation[];
  isLoadingAiConversations?: boolean;
  /** Available agents for filter dropdown */
  agents?: Agent[];
  onConversationSelect: (conversationData: {
    conversationId: number;
    chatPartner: ChatPartner;
    participants: Participant[];
  }) => void;
  /** Callback for selecting AI conversations (different flow) */
  onAiConversationSelect?: (conversationId: number) => void;
  onMarkAsRead: (conversationId: number) => void;
  onDeleteConversation?: (conversationId: number) => void;
  setActivePanel: (panel: PanelTab) => void;
}

export function InboxPanel({
  totalUnreadCount,
  inboxConversations,
  isLoadingInbox,
  aiConversations = [],
  isLoadingAiConversations = false,
  agents = [],
  onConversationSelect,
  onAiConversationSelect,
  onMarkAsRead,
  onDeleteConversation,
  setActivePanel
}: InboxPanelProps) {
  // Filter state
  const [search, setSearch] = useState('');
  const [agentFilter, setAgentFilter] = useState<number | null>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [showFilters, setShowFilters] = useState(false);
  const [expandedCardId, setExpandedCardId] = useState<number | null>(null);

  // Merge inbox + AI conversations into unified list
  const allConversations = useMemo(() => {
    const inboxTagged: InboxConversation[] = (inboxConversations || []).map(c => ({
      ...c,
      _source: 'inbox' as const
    }));

    const aiTagged: InboxConversation[] = (aiConversations || []).map(c => ({
      ...c,
      _source: 'ai' as const,
      unread_count: c.unread_count ?? 0,
      participants: c.participants ?? []
    }));

    // Deduplicate by id (inbox takes priority since it has unread counts)
    const seen = new Set<number>();
    const merged: InboxConversation[] = [];

    for (const conv of inboxTagged) {
      seen.add(conv.id);
      merged.push(conv);
    }
    for (const conv of aiTagged) {
      if (!seen.has(conv.id)) {
        merged.push(conv);
      }
    }

    return merged;
  }, [inboxConversations, aiConversations]);

  // Apply filters
  const filteredConversations = useMemo(() => {
    let result = allConversations;

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(c => {
        const title = (c.title || '').toLowerCase();
        const agentName = (c.agent_name || '').toLowerCase();
        const lastMsg = (c.last_message || '').toLowerCase();
        const participantNames = c.participants?.map(p => p.name.toLowerCase()).join(' ') || '';
        return title.includes(q) || agentName.includes(q) || lastMsg.includes(q) || participantNames.includes(q);
      });
    }

    // Agent filter
    if (agentFilter !== null) {
      result = result.filter(c => c.agent_id === agentFilter);
    }

    // Date filter
    if (dateFilter !== 'all') {
      const now = new Date();
      let cutoff: Date;
      switch (dateFilter) {
        case 'today':
          cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
      }
      result = result.filter(c => new Date(c.updated_at) >= cutoff);
    }

    // Sort
    return [...result].sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return (a.title || '').localeCompare(b.title || '');
        case 'unread':
          return (b.unread_count || 0) - (a.unread_count || 0);
        case 'date':
        default:
          return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
      }
    });
  }, [allConversations, search, agentFilter, dateFilter, sortBy]);

  const isLoading = isLoadingInbox || isLoadingAiConversations;

  const handleConversationClick = (conv: InboxConversation) => {
    // AI conversation — use separate handler
    if (conv._source === 'ai' && onAiConversationSelect) {
      onAiConversationSelect(conv.id);
      setActivePanel('none');
      return;
    }

    // User/group conversation
    const currentUserId = useAuthStore.getState().user?.id;
    const otherParticipants = conv.participants?.filter(p => currentUserId && p.user_id !== Number(currentUserId)) || [];
    const displayName = conv.title || otherParticipants.map(p => p.name).join(', ') || 'Беседа';

    let chatPartner: ChatPartner;
    let participants: Participant[];

    if (otherParticipants.length === 1) {
      const partner = otherParticipants[0];
      chatPartner = {
        type: 'user',
        id: partner.user_id,
        name: partner.name,
        email: partner.email,
        avatarUrl: partner.avatar_url
      };
      participants = [{ id: partner.user_id, name: partner.name, type: 'user' }];
    } else if (otherParticipants.length > 1) {
      chatPartner = {
        type: 'group',
        id: conv.id,
        name: displayName,
        participants: otherParticipants.map(p => ({
          id: p.user_id,
          name: p.name,
          type: 'user' as const
        }))
      };
      participants = otherParticipants.map(p => ({
        id: p.user_id,
        name: p.name,
        type: 'user' as const
      }));
    } else {
      chatPartner = {
        type: 'user',
        id: conv.id,
        name: displayName
      };
      participants = [];
    }

    onConversationSelect({
      conversationId: conv.id,
      chatPartner,
      participants
    });

    if (conv.unread_count > 0) {
      onMarkAsRead(conv.id);
    }

    setActivePanel('none');
  };

  const dateFilterLabels: Record<DateFilter, string> = {
    all: 'Все',
    today: 'Сегодня',
    week: 'Неделя',
    month: 'Месяц'
  };

  const activeFiltersCount = (agentFilter !== null ? 1 : 0) + (dateFilter !== 'all' ? 1 : 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <Inbox className="w-3.5 h-3.5" />
            <span>Все беседы</span>
            <span className="text-[var(--text-tertiary)]">({allConversations.length})</span>
          </div>
          <div className="flex items-center gap-1.5">
            {totalUnreadCount > 0 && (
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-red-500 text-white">
                {totalUnreadCount}
              </span>
            )}
            <button
              onClick={() => setShowFilters(prev => !prev)}
              className={cn(
                "relative p-1 rounded transition-colors",
                showFilters
                  ? "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              )}
              title="Фильтры"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              {activeFiltersCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 text-[8px] font-bold rounded-full bg-[var(--color-primary-500)] text-white flex items-center justify-center">
                  {activeFiltersCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActivePanel('none')}
              className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              title="Закрыть"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-2 py-1.5 border-b border-[var(--border-secondary)]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск бесед..."
            className="w-full pl-8 pr-8 py-1.5 text-sm bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Filters panel (collapsible) */}
      {showFilters && (
        <div className="px-2 py-2 border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]/50 space-y-2">
          {/* Agent filter */}
          {agents.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Bot className="w-3.5 h-3.5 text-[var(--text-tertiary)] flex-shrink-0" />
              <select
                value={agentFilter ?? ''}
                onChange={(e) => setAgentFilter(e.target.value ? Number(e.target.value) : null)}
                className="flex-1 min-w-0 px-2 py-1 text-xs bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)] truncate"
              >
                <option value="">Все агенты</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id}>{a.icon ? `${a.icon} ` : ''}{a.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Date filter */}
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-[var(--text-tertiary)] flex-shrink-0" />
            <div className="flex gap-1 flex-1">
              {(Object.keys(dateFilterLabels) as DateFilter[]).map(key => (
                <button
                  key={key}
                  onClick={() => setDateFilter(key)}
                  className={cn(
                    "px-2 py-0.5 text-[10px] rounded-full transition-colors",
                    dateFilter === key
                      ? "bg-[var(--color-primary-500)] text-white"
                      : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                  )}
                >
                  {dateFilterLabels[key]}
                </button>
              ))}
            </div>
          </div>

          {/* Sort */}
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal className="w-3.5 h-3.5 text-[var(--text-tertiary)] flex-shrink-0" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="flex-1 min-w-0 px-2 py-1 text-xs bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]"
            >
              <option value="date">По дате</option>
              <option value="name">По имени</option>
              <option value="unread">По непрочитанным</option>
            </select>
          </div>

          {/* Clear filters */}
          {activeFiltersCount > 0 && (
            <button
              onClick={() => { setAgentFilter(null); setDateFilter('all'); }}
              className="w-full text-center text-[10px] text-[var(--color-primary-500)] hover:underline py-0.5"
            >
              Сбросить фильтры
            </button>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8" role="status">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">
            {search || activeFiltersCount > 0 ? 'Ничего не найдено' : 'Нет бесед'}
          </div>
        ) : (
          filteredConversations.map(conv => {
            const currentUserId = useAuthStore.getState().user?.id;
            const isAi = conv._source === 'ai' || !!conv.agent_id;
            const otherParticipants = conv.participants?.filter(p => currentUserId && p.user_id !== Number(currentUserId)) || [];
            const displayName = isAi
              ? (conv.title || conv.agent_name || 'AI Chat')
              : (conv.title || otherParticipants.map(p => p.name).join(', ') || 'Беседа');

            const isExpanded = expandedCardId === conv.id;

            return (
              <div key={`${conv._source || 'u'}-${conv.id}`} className="border-b border-[var(--border-secondary)]/50">
                <button
                  onClick={() => handleConversationClick(conv)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--bg-tertiary)] transition-colors text-left group",
                    conv.unread_count > 0 && "bg-[var(--color-primary-500)]/5"
                  )}
                >
                  {/* Avatar */}
                  <div className="relative flex-shrink-0">
                    {isAi ? (
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-400/20 to-purple-600/20 flex items-center justify-center text-base">
                        {conv.agent_icon || <Bot className="w-5 h-5 text-purple-400" />}
                      </div>
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-sm">
                        {conv.type === 'direct' || otherParticipants.length <= 1 ? (
                          <User className="w-5 h-5 text-[var(--text-tertiary)]" />
                        ) : (
                          <Users className="w-5 h-5 text-[var(--text-tertiary)]" />
                        )}
                      </div>
                    )}
                    {conv.unread_count > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-red-500 text-white flex items-center justify-center">
                        {conv.unread_count > 99 ? '99+' : conv.unread_count}
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className={cn(
                      "text-sm truncate",
                      conv.unread_count > 0 ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                    )}>
                      {displayName}
                    </div>
                    {/* Line 1: Bound row (if any) */}
                    {conv.bound_row_id && (
                      <div className="text-[10px] text-blue-400 truncate">
                        🔗 #{conv.bound_row_id}
                        {conv.bound_table_name && <span className="text-[var(--text-tertiary)]"> · {conv.bound_table_name}</span>}
                      </div>
                    )}
                    {/* Line 2: Participants / metadata */}
                    <div className="text-[10px] text-[var(--text-tertiary)] truncate">
                      {isAi ? (
                        <>
                          {conv.agent_name && <span>{conv.agent_name}</span>}
                          {conv.messages_count != null && <span> · {conv.messages_count} сообщ.</span>}
                        </>
                      ) : (
                        <span>{conv.type === 'direct' ? 'Личный чат' : `${conv.participants?.length || 0} участников`}</span>
                      )}
                      {' · '}
                      {new Date(conv.updated_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                    </div>
                    {/* Last message preview */}
                    {conv.last_message && (
                      <div className="text-[10px] text-[var(--text-tertiary)] truncate mt-0.5 opacity-70">
                        {conv.last_message.substring(0, 80)}
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    {onDeleteConversation && (
                      <button onClick={(e) => { e.stopPropagation(); if (confirm('Удалить чат?')) onDeleteConversation(conv.id); }}
                        className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-[var(--text-tertiary)] hover:text-red-400 transition-all" title="Удалить чат">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); setExpandedCardId(isExpanded ? null : conv.id); }}
                      className={cn(
                        "p-1 rounded transition-all",
                        isExpanded
                          ? "text-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10"
                          : "opacity-0 group-hover:opacity-100 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                      )} title="Подробнее">
                      <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", isExpanded && "rotate-180")} />
                    </button>
                  </div>
                </button>

                {/* Expanded card details */}
                {isExpanded && (
                  <div className="px-3 pb-2 bg-[var(--bg-tertiary)]/50 border-t border-[var(--border-secondary)]/30">
                    <div className="py-2 space-y-2">
                      {/* Participants list */}
                      {conv.participants && conv.participants.length > 0 && (
                        <div>
                          <div className="text-[10px] text-[var(--text-tertiary)] mb-1">Участники</div>
                          <div className="flex flex-wrap gap-1">
                            {conv.participants.map(p => (
                              <span key={p.user_id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--bg-secondary)] text-[10px] text-[var(--text-secondary)]">
                                <User className="w-2.5 h-2.5" />{p.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Agent info */}
                      {isAi && conv.agent_name && (
                        <div>
                          <div className="text-[10px] text-[var(--text-tertiary)] mb-1">Агент</div>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/10 text-[10px] text-purple-300">
                            {conv.agent_icon || '🤖'} {conv.agent_name}
                          </span>
                        </div>
                      )}
                      {/* Bound row */}
                      {conv.bound_row_id && (
                        <div>
                          <div className="text-[10px] text-[var(--text-tertiary)] mb-1">Привязанная строка</div>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 text-[10px] text-blue-300">
                            🔗 #{conv.bound_row_id}
                          </span>
                        </div>
                      )}
                      {/* Chat ID */}
                      <div className="text-[10px] text-[var(--text-quaternary)]">
                        Чат #{conv.id} · {conv.messages_count ?? 0} сообщ.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
