/**
 * ContactsPanel Component
 * Extracted from AIChatPanel.tsx - lines 1367-1489
 */

import { X, Star, Search, Loader2 } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { PanelContainer } from '../shared/PanelContainer';
import { AccordionContactItem, type SharedChat } from '../../../../components/AccordionContactItem';
import { ChatUser, UserTypeFilter, PanelTab, ChatPartner } from '../../types';
import { Participant } from '../../../../components/ParticipantSelector';

interface ContactsPanelProps {
  contactsSearch: string;
  setContactsSearch: (search: string) => void;
  showFavorites: boolean;
  setShowFavorites: (show: boolean | ((prev: boolean) => boolean)) => void;
  userTypeFilter: UserTypeFilter;
  setUserTypeFilter: (filter: UserTypeFilter) => void;
  showAllContacts: boolean;
  setShowAllContacts: (show: boolean | ((prev: boolean) => boolean)) => void;
  setActivePanel: (panel: PanelTab) => void;
  users: (ChatUser & { user_type?: string })[];
  isLoadingUsers: boolean;
  chatParticipants: Participant[];
  chatPartner: ChatPartner | null;
  favorites: number[];
  onUserSelect: (user: ChatUser) => void;
  onSelectChat: (chat: SharedChat) => void;
  onToggleFavorite: (userId: number) => void;
  onAddToGroup: (user: ChatUser) => void;
  onCreateNewChat: (user: ChatUser) => void;
}

export function ContactsPanel({
  contactsSearch,
  setContactsSearch,
  showFavorites,
  setShowFavorites,
  userTypeFilter,
  setUserTypeFilter,
  showAllContacts,
  setShowAllContacts,
  setActivePanel,
  users,
  isLoadingUsers,
  chatParticipants,
  chatPartner,
  favorites,
  onUserSelect,
  onSelectChat,
  onToggleFavorite,
  onAddToGroup,
  onCreateNewChat
}: ContactsPanelProps) {
  // Filter users based on search and filters
  const filteredUsers = users.filter(user => {
    // Search filter
    if (contactsSearch) {
      const searchLower = contactsSearch.toLowerCase();
      const matchesName = user.name.toLowerCase().includes(searchLower);
      const matchesEmail = user.email?.toLowerCase().includes(searchLower);
      if (!matchesName && !matchesEmail) return false;
    }
    
    // Type filter
    const isAg = user.managed_by_agent_table_id != null || user.user_type === 'agent' || user.user_type === 'bot';
    const isSvc = user.user_type === 'service';
    if (userTypeFilter === 'humans' && (isAg || isSvc)) return false;
    if (userTypeFilter === 'agents' && !isAg && !isSvc) return false;
    
    // Favorites filter
    if (showFavorites && !favorites.includes(user.id)) return false;
    
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header with close button */}
      <div className="p-2 border-b border-[var(--border-secondary)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Favorites toggle */}
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
          
          {/* Type filter */}
          <select
            value={userTypeFilter}
            onChange={(e) => setUserTypeFilter(e.target.value as UserTypeFilter)}
            className="px-2 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)] border-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30"
          >
            <option value="all">Все</option>
            <option value="humans">Люди</option>
            <option value="agents">AI / Сервис</option>
          </select>
          
          {/* Show all users toggle */}
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
        
        {/* Close panel - fixed right */}
        <button
          onClick={() => setActivePanel('none')}
          className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          title="Закрыть"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      
      {/* Search - shown in wide mode sidebar */}
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
      
      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoadingUsers ? (
          <div className="flex items-center justify-center py-8" role="status">
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
                onSelect={onUserSelect}
                onSelectChat={onSelectChat}
                onToggleFavorite={onToggleFavorite}
                onAddToGroup={onAddToGroup}
                onCreateNewChat={onCreateNewChat}
              />
            );
          })
        )}
      </div>
    </div>
  );
}