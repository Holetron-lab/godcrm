/** InboxPanelContent — ADR-119 extracted from usePanelContent.tsx */
import React from 'react';
import { X, Search, Loader2, Users, User, Inbox, Filter, Pencil, Link2, ChevronRight } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useAuthStore } from '@/features/auth/store/authStore';
import type { PanelContentDeps } from './PanelContentTypes';

export function InboxPanelContent(d: PanelContentDeps) {
  const safeAgents = d.safeAgents;
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <Inbox className="w-3.5 h-3.5" /><span>Все чаты</span>
          </div>
          <div className="flex items-center gap-1">
            {d.totalUnreadCount > 0 && <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-red-500 text-white">{d.totalUnreadCount}</span>}
            <button onClick={() => d.setShowInboxFilters(prev => !prev)}
              className={cn("p-1 rounded transition-colors",
                d.showInboxFilters || d.hasActiveInboxFilters ? "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              )} title="Фильтры">
              <Filter className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="px-3 py-1.5 border-b border-[var(--border-secondary)]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" />
          <input type="text" value={d.inboxSearch} onChange={(e) => d.setInboxSearch(e.target.value)} placeholder="Поиск чатов..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30" />
          {d.inboxSearch && (
            <button onClick={() => d.setInboxSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-[var(--bg-secondary)] rounded">
              <X className="w-3 h-3 text-[var(--text-tertiary)]" />
            </button>
          )}
        </div>
      </div>

      {d.showInboxFilters && (
        <div className="px-3 py-2 border-b border-[var(--border-secondary)] space-y-2 bg-[var(--bg-secondary)]">
          <div>
            <label className="text-[10px] text-[var(--text-tertiary)] mb-0.5 block">Агент</label>
            <select value={d.inboxAgentFilter} onChange={(e) => d.setInboxAgentFilter(e.target.value)}
              className="w-full px-2 py-1 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30">
              <option value="">Все агенты</option>
              {d.inboxAgentOptions.map(agent => <option key={agent.id} value={agent.id}>{agent.icon || '\uD83E\uDD16'} {agent.name}</option>)}
            </select>
          </div>
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
          {d.hasActiveInboxFilters && (
            <button onClick={() => { d.setInboxSearch(''); d.setInboxAgentFilter(''); d.setInboxDateFrom(''); d.setInboxDateTo(''); }}
              className="text-[10px] text-[var(--color-primary-500)] hover:underline">Сбросить фильтры</button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {d.isLoadingInbox ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" /></div>
        ) : d.inboxConversations.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">{d.hasActiveInboxFilters ? 'Ничего не найдено' : 'Нет активных бесед'}</div>
        ) : (
          d.inboxConversations.map(conv => {
            const currentUserId = useAuthStore.getState().user?.id;
            const otherParticipants = conv.participants?.filter(p => currentUserId && p.user_id !== Number(currentUserId)) || [];
            const agentForConv = conv.agent_id ? safeAgents.find(a => a.id === conv.agent_id) : null;
            const agentName = conv.agent_name || agentForConv?.name || null;
            const agentIcon = conv.agent_icon || agentForConv?.icon || null;
            const displayName = conv.title || otherParticipants.map(p => p.name).join(', ') || agentName || 'Беседа';

            return (
              <button key={conv.id}
                onClick={() => {
                  if (otherParticipants.length === 1) {
                    const partner = otherParticipants[0];
                    d.setChatPartner({ type: 'user', id: partner.user_id, name: partner.name, email: partner.email, avatarUrl: partner.avatar_url });
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
                className={cn("w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--bg-tertiary)] transition-colors text-left", conv.unread_count > 0 && "bg-[var(--color-primary-500)]/5")}
              >
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-sm">
                    {agentIcon || agentForConv ? <span className="text-lg">{agentIcon || agentForConv?.icon || '\uD83E\uDD16'}</span> :
                     conv.type === 'direct' ? <User className="w-5 h-5 text-[var(--text-tertiary)]" /> : <Users className="w-5 h-5 text-[var(--text-tertiary)]" />}
                  </div>
                  {conv.unread_count > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-red-500 text-white flex items-center justify-center">
                      {conv.unread_count > 99 ? '99+' : conv.unread_count}
                    </span>
                  )}
                </div>
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
                    <div className={cn("text-sm truncate flex items-center gap-1 group/inbox-title", conv.unread_count > 0 ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>
                      <span className="truncate" onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); d.setInboxRenamingId(conv.id); d.setInboxRenamingTitle(displayName); setTimeout(() => d.inboxRenameInputRef.current?.select(), 50); }}>{displayName}</span>
                      <button onClick={(e) => { e.stopPropagation(); d.setInboxRenamingId(conv.id); d.setInboxRenamingTitle(displayName); setTimeout(() => d.inboxRenameInputRef.current?.select(), 50); }}
                        className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover/inbox-title:opacity-100 hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-all" title="Переименовать">
                        <Pencil className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  )}
                  <div className="text-[10px] text-[var(--text-tertiary)]">
                    {agentName ? `\uD83E\uDD16 ${agentName}` : conv.type === 'direct' ? 'Личный чат' : `${conv.participants?.length || 0} участников`}
                    {' \u2022 '}
                    {new Date(conv.updated_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                  </div>
                  {conv.bound_row_id && (
                    <div className="flex items-center gap-1 text-[10px] text-blue-400/70 mt-0.5">
                      <Link2 className="w-2.5 h-2.5" />
                      <span className="truncate">{conv.bound_table_icon || ''}{' '}{conv.bound_table_name ? `${conv.bound_table_name}: ` : ''}{conv.bound_row_title || `#${conv.bound_row_id}`}</span>
                    </div>
                  )}
                </div>
                {conv.unread_count > 0 && <ChevronRight className="w-4 h-4 text-[var(--color-primary-500)]" />}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
