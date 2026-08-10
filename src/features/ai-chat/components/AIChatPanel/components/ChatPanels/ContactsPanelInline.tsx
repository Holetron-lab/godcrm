/**
 * ContactsPanelInline — Contacts panel render extracted from AIChatPanel.tsx renderContactsPanel().
 * Uses the same props pattern as the inline render function it replaces.
 */
import React from 'react';
import { X, Star, Search, Loader2 } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { AccordionContactItem } from '../../../AccordionContactItem';

export interface ContactsPanelInlineProps {
  contactsSearch: string;
  setContactsSearch: (v: string) => void;
  showFavorites: boolean;
  setShowFavorites: (fn: (prev: boolean) => boolean) => void;
  userTypeFilter: 'all' | 'humans' | 'agents';
  setUserTypeFilter: (f: 'all' | 'humans' | 'agents') => void;
  showAllContacts: boolean;
  setShowAllContacts: (fn: (prev: boolean) => boolean) => void;
  setActivePanel: (panel: string) => void;
  filteredUsers: Array<{
    id: number;
    name: string;
    email?: string;
    avatar_url?: string;
    managed_by_agent_table_id?: number;
  }>;
  isLoadingUsers: boolean;
  chatParticipants: Array<{ id: number; name: string; type: string }>;
  chatPartner: { type: string; id: number; name: string } | null;
  favorites: number[];
  handleUserSelect: (user: { id: number; name: string; email?: string | null; avatar_url?: string | null; managed_by_agent_table_id?: number | null }) => void;
  selectConversation: (id: number) => Promise<unknown>;
  toggleFavorite: (userId: number) => void;
  handleAddToGroup: (user: { id: number; name: string }) => void;
  forceNewChatRef: React.MutableRefObject<boolean>;
  createNewConversation: () => void;
  setUserConversationId: (id: number | null) => void;
  setChatPartner: (partner: { type: string; id: number; name: string; avatarUrl?: string; email?: string }) => void;
  setChatParticipants: (participants: Array<{ type: string; id: number; name: string; email?: string; avatar?: string }>) => void;
}

export function ContactsPanelInline({
  contactsSearch, setContactsSearch, showFavorites, setShowFavorites,
  userTypeFilter, setUserTypeFilter, showAllContacts, setShowAllContacts,
  setActivePanel, filteredUsers, isLoadingUsers, chatParticipants, chatPartner,
  favorites, handleUserSelect, selectConversation, toggleFavorite, handleAddToGroup,
  forceNewChatRef, createNewConversation, setUserConversationId, setChatPartner, setChatParticipants,
}: ContactsPanelInlineProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-[var(--border-secondary)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFavorites(prev => !prev)}
            className={cn(
              "p-1.5 rounded-lg transition-colors",
              showFavorites
                ? "bg-yellow-500/20 text-yellow-400"
                : "text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            )}
            title="Избранные"
          >
            <Star className={cn("w-4 h-4", showFavorites && "fill-current")} />
          </button>
          <select
            value={userTypeFilter}
            onChange={(e) => setUserTypeFilter(e.target.value as 'all' | 'humans' | 'agents')}
            className="px-2 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)] border-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30"
          >
            <option value="all">Все</option>
            <option value="humans">Люди</option>
            <option value="agents">AI</option>
          </select>
          <button
            onClick={() => setShowAllContacts(prev => !prev)}
            className={cn(
              "px-2 py-1.5 text-xs rounded-lg transition-colors whitespace-nowrap",
              showAllContacts
                ? "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]"
                : "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            )}
            title={showAllContacts ? "Показать только участников спейса" : "Показать всех пользователей"}
          >
            {showAllContacts ? "Все" : "Спейс"}
          </button>
        </div>
        <button
          onClick={() => setActivePanel('none')}
          className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          title="Закрыть"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-2 py-1.5 border-b border-[var(--border-secondary)]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
          <input
            type="text"
            value={contactsSearch}
            onChange={(e) => setContactsSearch(e.target.value)}
            placeholder="Поиск контактов..."
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoadingUsers ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">
            {contactsSearch ? 'Не найдено' : 'Нет контактов'}
          </div>
        ) : (
          filteredUsers.map(user => {
            const isInChat = chatParticipants.some(p => p.id === user.id);
            const isCurrent = chatPartner?.type === 'user' && chatPartner.id === user.id;
            const isFavorite = favorites.includes(user.id);
            return (
              <AccordionContactItem
                key={user.id}
                user={user}
                isCurrentPartner={isCurrent}
                isInGroup={isInChat}
                isFavorite={isFavorite}
                onSelect={handleUserSelect}
                onSelectChat={(chat) => {
                  selectConversation(chat.id);
                  setActivePanel('none');
                }}
                onToggleFavorite={toggleFavorite}
                onAddToGroup={handleAddToGroup}
                onCreateNewChat={(targetUser) => {
                  forceNewChatRef.current = true;
                  createNewConversation();
                  setUserConversationId(null);
                  setChatPartner({
                    type: 'user',
                    id: targetUser.id,
                    name: targetUser.name,
                    avatarUrl: targetUser.avatar_url ?? undefined,
                    email: targetUser.email ?? undefined
                  });
                  setChatParticipants([{
                    type: targetUser.managed_by_agent_table_id ? 'agent' : 'user',
                    id: targetUser.id,
                    name: targetUser.name,
                    email: targetUser.email ?? undefined,
                    avatar: targetUser.avatar_url ?? undefined
                  }]);
                  setActivePanel('none');
                }}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
