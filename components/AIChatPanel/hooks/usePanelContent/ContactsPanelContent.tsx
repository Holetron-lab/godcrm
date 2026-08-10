/** ContactsPanelContent — ADR-119 extracted from usePanelContent.tsx */
import React from 'react';
import { X, Search, Star, Loader2 } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { AccordionContactItem } from '../../../AccordionContactItem';
import type { PanelContentDeps } from './PanelContentTypes';

export function ContactsPanelContent(d: PanelContentDeps) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-[var(--border-secondary)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => d.setShowFavorites(prev => !prev)}
            className={cn("p-1.5 rounded-lg transition-colors",
              d.showFavorites ? "bg-yellow-500/20 text-yellow-400" : "text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            )} title="Избранные">
            <Star className={cn("w-4 h-4", d.showFavorites && "fill-current")} />
          </button>
          <select value={d.userTypeFilter} onChange={(e) => d.setUserTypeFilter(e.target.value as 'all' | 'humans' | 'agents')}
            className="px-2 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)] border-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30">
            <option value="all">Все</option>
            <option value="humans">Люди</option>
            <option value="agents">AI</option>
          </select>
          <button onClick={() => d.setShowAllContacts(prev => !prev)}
            className={cn("px-2 py-1.5 text-xs rounded-lg transition-colors whitespace-nowrap",
              d.showAllContacts ? "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]" : "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            )} title={d.showAllContacts ? "Показать только участников спейса" : "Показать всех пользователей"}>
            {d.showAllContacts ? "Все" : "Спейс"}
          </button>
        </div>
        <button onClick={() => d.setActivePanel('none')} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors" title="Закрыть">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="px-2 py-1.5 border-b border-[var(--border-secondary)]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
          <input type="text" value={d.contactsSearch} onChange={(e) => d.setContactsSearch(e.target.value)} placeholder="Поиск контактов..."
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {d.isLoadingUsers ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" /></div>
        ) : d.filteredUsers.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">{d.contactsSearch ? 'Не найдено' : 'Нет контактов'}</div>
        ) : (
          d.filteredUsers.map(user => {
            const isInChat = d.chatParticipants.some(p => p.id === user.id);
            const isCurrent = d.chatPartner?.type === 'user' && d.chatPartner.id === user.id;
            const isFavorite = d.favorites.includes(user.id);
            return (
              <AccordionContactItem key={user.id} user={user} isCurrentPartner={isCurrent} isInGroup={isInChat} isFavorite={isFavorite}
                onSelect={d.handleUserSelect}
                onSelectChat={(chatId: number) => { d.selectConversation(chatId); d.setActivePanel('none'); }}
                onToggleFavorite={d.toggleFavorite} onAddToGroup={d.handleAddToGroup}
                onCreateNewChat={(targetUser: typeof user) => {
                  d.forceNewChatRef.current = true; d.createNewConversation(); d.setUserConversationId(null);
                  d.setChatPartner({ type: 'user', id: targetUser.id, name: targetUser.name, avatarUrl: targetUser.avatar_url ?? undefined, email: targetUser.email ?? undefined });
                  d.setChatParticipants([{ type: targetUser.managed_by_agent_table_id ? 'agent' : 'user', id: targetUser.id, name: targetUser.name, email: targetUser.email ?? undefined, avatar: targetUser.avatar_url ?? undefined }]);
                  d.setActivePanel('none');
                }}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
