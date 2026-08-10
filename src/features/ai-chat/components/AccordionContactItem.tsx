/**
 * AccordionContactItem - TASK-043
 *
 * Contact item with expandable accordion showing shared chats.
 * Two-row layout: avatar (tall, spans both rows) + Row 1 = Name (id), Row 2 = type pill + email + toolbar.
 */

import { useState } from 'react';
import {
  ChevronDown,
  MessageSquare,
  MessageSquarePlus,
  Star,
  UserPlus,
  UserMinus,
  Loader2,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { cn } from '@/shared/utils/cn';
import { Avatar } from '@/shared/components/ui/Avatar';

export interface SharedChat {
  id: number;
  title: string | null;
  type: string;
  messages_count: number;
  last_message_at: string | null;
  updated_at: string;
  agent_id?: number | null;
  agent_name?: string | null;
  agent_icon?: string | null;
  bound_table_id?: number | null;
  bound_row_id?: number | null;
  bound_table_name?: string | null;
  bound_table_icon?: string | null;
  bound_row_title?: string | null;
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
  managed_by_agent_row_id?: number | null;
  user_type?: string;
}

interface AccordionContactItemProps {
  user: ContactUser;
  isCurrentPartner: boolean;
  isInGroup: boolean;
  isFavorite: boolean;
  agentColor?: string | null;
  agentIcon?: string | null;
  onSelect: (user: ContactUser) => void;
  onSelectChat: (chat: SharedChat) => void;
  onToggleFavorite: (userId: number) => void;
  onAddToGroup: (user: ContactUser) => void;
  onCreateNewChat: (user: ContactUser) => void;
}

export function AccordionContactItem({
  user,
  isCurrentPartner,
  isInGroup,
  isFavorite,
  agentColor,
  agentIcon,
  onSelect,
  onSelectChat,
  onToggleFavorite,
  onAddToGroup,
  onCreateNewChat,
}: AccordionContactItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isAgent = user.managed_by_agent_table_id != null || user.user_type === 'agent';
  const isService = user.user_type === 'service';

  const { data: sharedChats, isLoading: isLoadingChats } = useQuery<SharedChat[]>({
    queryKey: ['shared-chats', user.id],
    queryFn: async () => {
      const response = await apiClient.get<{ success: boolean; data: SharedChat[] }>(`/chat/conversations/with/${user.id}`);
      return response.data || [];
    },
    enabled: isExpanded,
    staleTime: 30000,
  });

  const chatCount = sharedChats?.length || 0;

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  const typeLabel = isAgent ? 'Агент' : isService ? 'Сервис' : 'Человек';
  const typeColorClass = isAgent
    ? 'bg-purple-500/20 text-purple-400'
    : isService
      ? 'bg-orange-500/20 text-orange-400'
      : 'bg-blue-500/20 text-blue-400';

  return (
    <div className="border-b border-[var(--border-secondary)] last:border-b-0">
      <div
        className={cn(
          'group px-3 py-2 transition-colors',
          isCurrentPartner
            ? 'bg-[var(--color-primary-500)]/15'
            : isInGroup
              ? 'bg-[var(--color-primary-500)]/5 hover:bg-[var(--color-primary-500)]/10'
              : 'hover:bg-[var(--bg-tertiary)]'
        )}
        style={agentColor ? { boxShadow: `inset 3px 0 0 0 ${agentColor}` } : undefined}
      >
        <div className="flex items-center gap-2">
          {/* Avatar — spans both rows */}
          <button
            type="button"
            onClick={() => onCreateNewChat(user)}
            className="relative flex-shrink-0"
            title="Новый чат"
          >
            <Avatar
              url={user.avatar_url}
              emoji={agentIcon || (isService ? '🔧' : null)}
              name={user.name}
              size={40}
              color={isAgent ? (agentColor || '#a855f7') : isService ? '#fb923c' : '#3b82f6'}
            />
            <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-gray-400 border border-[var(--bg-secondary)]" />
          </button>

          {/* Content: 2 rows */}
          <div className="flex-1 min-w-0">
            {/* Row 1: Name + (id) + status badges.
                Uses a div (not <button>) so the name/id text stays selectable & copyable —
                browsers block text selection inside <button>. Click still opens a new chat. */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => onCreateNewChat(user)}
              onKeyDown={(e) => { if (e.key === 'Enter') onCreateNewChat(user); }}
              className="w-full flex items-center gap-1.5 text-left cursor-pointer"
            >
              <span className="text-sm font-medium text-[var(--text-primary)] truncate select-text cursor-text">{user.name}</span>
              <span className="text-[10px] font-normal text-[var(--text-tertiary)] flex-shrink-0 select-text cursor-text">(#{user.id})</span>
              {isCurrentPartner && (
                <span className="text-[8px] px-1 py-0.5 rounded bg-[var(--color-primary-500)]/30 text-[var(--color-primary-400)] flex-shrink-0">текущий</span>
              )}
              {isInGroup && !isCurrentPartner && (
                <span className="text-[8px] px-1 py-0.5 rounded bg-green-500/20 text-green-400 flex-shrink-0">в группе</span>
              )}
            </div>

            {/* Row 2: type pill + email + toolbar */}
            <div className="mt-0.5 flex items-center gap-1 min-w-0">
              <span
                className={cn(
                  'text-[9px] px-1.5 py-0.5 rounded font-medium flex-shrink-0',
                  typeColorClass,
                )}
              >
                {typeLabel}
              </span>
              {user.email && (
                <span className="text-[10px] text-[var(--text-tertiary)] truncate flex-1 min-w-0 select-text cursor-text">
                  {user.email}
                </span>
              )}
              {!user.email && <span className="flex-1" />}

              <div className="flex items-center gap-px flex-shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
                <RowToolbarBtn
                  icon={<MessageSquarePlus className="w-3 h-3" />}
                  title="Новый чат"
                  onClick={() => onCreateNewChat(user)}
                />
                <button
                  type="button"
                  onClick={handleExpandClick}
                  className={cn(
                    'inline-flex items-center justify-center gap-0.5 h-5 px-1 rounded text-[var(--text-secondary)] hover:text-[var(--color-primary-400)] hover:bg-[var(--bg-secondary)] transition-colors',
                    isExpanded && 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]'
                  )}
                  title={isExpanded ? 'Свернуть чаты' : 'Показать чаты'}
                >
                  {isLoadingChats ? <Loader2 className="w-3 h-3 animate-spin" /> : (
                    <>
                      {chatCount > 0 && <span className="text-[9px] font-medium">{chatCount}</span>}
                      <ChevronDown className={cn('w-3 h-3 transition-transform', isExpanded && 'rotate-180')} />
                    </>
                  )}
                </button>
                <RowToolbarBtn
                  icon={<Star className={cn('w-3 h-3', isFavorite && 'fill-current')} />}
                  title={isFavorite ? 'Убрать из избранного' : 'В избранное'}
                  onClick={() => onToggleFavorite(user.id)}
                  active={isFavorite}
                  activeClass="text-yellow-400"
                />
                <RowToolbarBtn
                  icon={isInGroup ? <UserMinus className="w-3 h-3" /> : <UserPlus className="w-3 h-3" />}
                  title={isInGroup ? 'Убрать из группы' : 'Добавить в группу'}
                  onClick={() => onAddToGroup(user)}
                  active={isInGroup}
                  activeClass="text-red-400 hover:bg-red-500/20"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Accordion: shared chats */}
      {isExpanded && (
        <div className="bg-[var(--bg-tertiary)] border-t border-[var(--border-secondary)]">
          {isLoadingChats ? (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />
            </div>
          ) : chatCount === 0 ? (
            <div className="px-4 py-3 text-xs text-[var(--text-tertiary)] text-center">Нет общих чатов</div>
          ) : (
            sharedChats!.map(chat => (
              <button key={chat.id} onClick={() => onSelectChat(chat)}
                className="w-full flex items-center gap-2 px-3 py-2 pl-14 hover:bg-[var(--bg-secondary)] transition-colors text-left">
                <MessageSquare className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                <span className="flex-1 text-xs text-[var(--text-secondary)] truncate">{chat.title || `Чат #${chat.id}`}</span>
                <span className="text-[9px] text-[var(--text-tertiary)] tabular-nums">{chat.messages_count} сообщ.</span>
                <span className="text-[9px] text-[var(--text-tertiary)]">
                  {chat.last_message_at ? new Date(chat.last_message_at).toLocaleDateString() : new Date(chat.updated_at).toLocaleDateString()}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function RowToolbarBtn({
  icon, title, onClick, active, activeClass,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
  activeClass?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      className={cn(
        'inline-flex items-center justify-center w-5 h-5 rounded transition-colors',
        active && activeClass
          ? activeClass
          : 'text-[var(--text-secondary)] hover:text-[var(--color-primary-400)] hover:bg-[var(--bg-secondary)]'
      )}
    >
      {icon}
    </button>
  );
}

export default AccordionContactItem;
