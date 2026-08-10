/**
 * AccordionContactItem - TASK-043
 * 
 * Contact item with expandable accordion showing shared chats.
 * - Click on contact → opens default (most recent) chat
 * - Click on expand → shows all shared chats
 * - Click on specific chat → opens that chat
 */

import { useState } from 'react';
import { 
  ChevronDown, 
  MessageSquare,
  MessageSquarePlus,
  User, 
  Bot, 
  Star, 
  UserPlus, 
  UserMinus,
  Plus,
  Loader2
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { cn } from '@/shared/utils/cn';

// Types
interface SharedChat {
  id: number;
  title: string | null;
  type: string;
  messages_count: number;
  last_message_at: string | null;
  updated_at: string;
  participants: Array<{
    user_id: number;
    name: string;
    email?: string;
    avatar_url?: string;
  }>;
}

interface ContactUser {
  id: number;
  name: string;
  email?: string | null;
  avatar_url?: string | null;
  managed_by_agent_table_id?: number | null;
  user_type?: string;
}

interface AccordionContactItemProps {
  user: ContactUser;
  isCurrentPartner: boolean;
  isInGroup: boolean;
  isFavorite: boolean;
  onSelect: (user: ContactUser) => void;
  onSelectChat: (chatId: number) => void;
  onToggleFavorite: (userId: number) => void;
  onAddToGroup: (user: ContactUser) => void;
  onCreateNewChat: (user: ContactUser) => void;
}

export function AccordionContactItem({
  user,
  isCurrentPartner,
  isInGroup,
  isFavorite,
  onSelect,
  onSelectChat,
  onToggleFavorite,
  onAddToGroup,
  onCreateNewChat,
}: AccordionContactItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isAgent = user.managed_by_agent_table_id != null || user.user_type === 'agent';

  // Fetch shared chats when expanded
  const { data: sharedChats, isLoading: isLoadingChats } = useQuery<SharedChat[]>({
    queryKey: ['shared-chats', user.id],
    queryFn: async () => {
      const response = await apiClient.get<{ success: boolean; data: SharedChat[] }>(`/chat/conversations/with/${user.id}`);
      return response.data || [];
    },
    enabled: isExpanded,
    staleTime: 30000, // 30 seconds
  });

  const chatCount = sharedChats?.length || 0;

  const handleMainClick = () => {
    // Always create a new chat when clicking on a contact name/avatar.
    // Existing chats are accessible via the accordion expand button.
    onCreateNewChat(user);
  };

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  return (
    <div className="border-b border-[var(--border-secondary)] last:border-b-0">
      {/* Main row */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 transition-colors cursor-pointer group",
          isCurrentPartner 
            ? "bg-[var(--color-primary-500)]/15"
            : isInGroup 
              ? "bg-[var(--color-primary-500)]/5 hover:bg-[var(--color-primary-500)]/10"
              : "hover:bg-[var(--bg-tertiary)]"
        )}
      >
        {/* Avatar */}
        <div className="relative flex-shrink-0" onClick={handleMainClick}>
          {user.avatar_url ? (
            <img src={user.avatar_url} alt={user.name} className="w-8 h-8 rounded-full object-cover" />
          ) : (
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center",
              isAgent ? "bg-purple-500/20 text-purple-400" : "bg-blue-500/20 text-blue-400"
            )}>
              {isAgent ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
            </div>
          )}
          <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-gray-400 border border-[var(--bg-secondary)]" />
        </div>

        {/* Name & info */}
        <div className="flex-1 min-w-0 cursor-pointer" onClick={handleMainClick}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text-primary)] truncate">{user.name}</span>
            {isCurrentPartner && (
              <span className="text-[8px] px-1 py-0.5 rounded bg-[var(--color-primary-500)]/30 text-[var(--color-primary-400)]">
                текущий
              </span>
            )}
            {isInGroup && !isCurrentPartner && (
              <span className="text-[8px] px-1 py-0.5 rounded bg-green-500/20 text-green-400">
                в группе
              </span>
            )}
          </div>
          <div className="text-[10px] text-[var(--text-tertiary)]">
            {isAgent ? 'AI Агент' : 'Человек'}
            {user.email && ` • ${user.email}`}
          </div>
        </div>

        {/* New Chat button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCreateNewChat(user);
          }}
          className="p-1.5 rounded text-[var(--text-tertiary)] hover:text-[var(--color-primary-500)] hover:bg-[var(--color-primary-500)]/10 transition-colors"
          title="Новый чат"
        >
          <MessageSquarePlus className="w-4 h-4" />
        </button>

        {/* Expand button - shows chat count, expands accordion */}
        <button
          onClick={handleExpandClick}
          className={cn(
            "flex items-center gap-0.5 p-1.5 rounded transition-colors",
            isExpanded 
              ? "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
          )}
          title={isExpanded ? 'Свернуть чаты' : 'Показать чаты'}
        >
          {isLoadingChats ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            chatCount > 0 && <span className="text-[10px] font-medium">{chatCount}</span>
          )}
          <ChevronDown className={cn(
            "w-3.5 h-3.5 transition-transform",
            isExpanded && "rotate-180"
          )} />
        </button>

        {/* Favorite button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(user.id);
          }}
          title={isFavorite ? "Убрать из избранного" : "В избранное"}
          className={cn(
            "p-1 rounded transition-colors",
            isFavorite 
              ? "text-yellow-400" 
              : "text-[var(--text-tertiary)] hover:text-yellow-400"
          )}
        >
          <Star className={cn("w-3.5 h-3.5", isFavorite && "fill-current")} />
        </button>

        {/* Add to group button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddToGroup(user);
          }}
          title={isInGroup ? "Убрать из группы" : "Добавить в группу"}
          className={cn(
            "p-1.5 rounded transition-colors",
            isInGroup 
              ? "text-red-400 hover:bg-red-500/20" 
              : "text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          )}
        >
          {isInGroup ? <UserMinus className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
        </button>
      </div>

      {/* Accordion content - shared chats */}
      {isExpanded && (
        <div className="bg-[var(--bg-tertiary)] border-t border-[var(--border-secondary)]">
          {isLoadingChats ? (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />
            </div>
          ) : chatCount === 0 ? (
            <div className="px-4 py-3 text-xs text-[var(--text-tertiary)] text-center">
              Нет общих чатов
            </div>
          ) : (
            sharedChats!.map(chat => (
              <button
                key={chat.id}
                onClick={() => onSelectChat(chat.id)}
                className="w-full flex items-center gap-2 px-3 py-2 pl-12 hover:bg-[var(--bg-secondary)] transition-colors text-left"
              >
                <MessageSquare className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                <span className="flex-1 text-xs text-[var(--text-secondary)] truncate">
                  {chat.title || `Чат #${chat.id}`}
                </span>
                <span className="text-[9px] text-[var(--text-tertiary)] tabular-nums">
                  {chat.messages_count} сообщ.
                </span>
                <span className="text-[9px] text-[var(--text-tertiary)]">
                  {chat.last_message_at 
                    ? new Date(chat.last_message_at).toLocaleDateString()
                    : new Date(chat.updated_at).toLocaleDateString()
                  }
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default AccordionContactItem;
