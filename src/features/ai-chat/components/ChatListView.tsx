import { useLanguage } from '@/shared/i18n/LanguageContext';
/**
 * ChatListView Component
 * ADR-024: Telegram-like Chat List
 * 
 * Displays list of conversations in Telegram style:
 * - Avatar, name, last message preview, time
 * - Search bar at top
 * - New chat FAB button
 */

import { useState, useMemo, type KeyboardEvent } from 'react';
import { Avatar } from '@/shared/components/ui/Avatar';
import {
  Search,
  MessageSquare,
  Check,
  CheckCheck,
  Link2,
  MoreVertical,
  Trash2,
  Edit3,
  Pin,
  Volume2,
  VolumeX
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';

export interface ChatPreview {
  id: number;
  title: string;
  type: 'agent' | 'direct' | 'group' | 'task';
  avatar?: string;
  icon?: string;
  lastMessage?: {
    content: string;
    sender: string;
    time: Date;
    isRead: boolean;
    isOwn: boolean;
  };
  unreadCount?: number;
  isPinned?: boolean;
  isMuted?: boolean;
  // Linked rows
  bindings?: Array<{
    tableId: number;
    tableName: string;
    rowId: number;
    rowTitle: string;
  }>;
  // Participants count for groups
  participantsCount?: number;
}

export interface ChatListViewProps {
  chats: ChatPreview[];
  selectedChatId?: number | null;
  onSelectChat: (chatId: number) => void;
  onCreateChat: () => void;
  onDeleteChat?: (chatId: number) => void;
  onPinChat?: (chatId: number) => void;
  onMuteChat?: (chatId: number) => void;
  isLoading?: boolean;
  className?: string;
}

export function ChatListView({
  chats,
  selectedChatId,
  onSelectChat,
  onCreateChat,
  onDeleteChat,
  onPinChat,
  onMuteChat,
  isLoading = false,
  className
}: ChatListViewProps) {
  const { t, language } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    const menu = event.currentTarget.closest('details');
    if (!menu) return;
    event.preventDefault();
    menu.open = false;
    menu.querySelector('summary')?.focus();
  };

  // Filter chats by search
  const filteredChats = useMemo(() => {
    if (!searchQuery.trim()) return chats;
    const query = searchQuery.toLowerCase();
    return chats.filter(chat => 
      chat.title.toLowerCase().includes(query) ||
      chat.lastMessage?.content.toLowerCase().includes(query)
    );
  }, [chats, searchQuery]);

  // Sort: pinned first, then by last message time
  const sortedChats = useMemo(() => {
    return [...filteredChats].sort((a, b) => {
      // Pinned first
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      // Then by time
      const timeA = a.lastMessage?.time?.getTime() || 0;
      const timeB = b.lastMessage?.time?.getTime() || 0;
      return timeB - timeA;
    });
  }, [filteredChats]);

  // Format time for display
  const formatTime = (date?: Date) => {
    if (!date) return '';
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) {
      return date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return t('aiChat.ui.yesterday');
    } else if (days < 7) {
      return date.toLocaleDateString(language, { weekday: 'short' });
    } else {
      return date.toLocaleDateString(language, { day: '2-digit', month: '2-digit' });
    }
  };

  // Truncate last message
  const truncateMessage = (text: string, maxLength: number = 40) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  // Get chat avatar
  const renderAvatar = (chat: ChatPreview) => {
    const typeColor: Record<string, string> = {
      agent: '#a855f7',
      direct: '#3b82f6',
      group: '#22c55e',
      task: '#fb923c',
    };
    const typeEmoji: Record<string, string> = {
      agent: '🤖',
      direct: '👤',
      group: '👥',
      task: '🔗',
    };
    return (
      <Avatar
        url={chat.avatar}
        emoji={chat.icon || typeEmoji[chat.type]}
        name={chat.title}
        size={48}
        color={typeColor[chat.type] || typeColor.direct}
      />
    );
  };

  return (
    <div className={cn('flex flex-col h-full bg-[var(--bg-primary)]', className)}>
      {/* Search Header - Telegram style */}
      <div className="flex-shrink-0 px-3 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border-primary)]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('aiChat.ui.search')}
            className="w-full pl-10 pr-4 py-2 text-sm rounded-full bg-[var(--bg-tertiary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30"
          />
        </div>
      </div>

      {/* Chat List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-[var(--color-primary-500)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : sortedChats.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <MessageSquare className="w-12 h-12 text-[var(--text-tertiary)] mb-3" />
            <p className="text-sm text-[var(--text-tertiary)]">
              {searchQuery ? t('aiChat.ui.noChatsFound') : t('aiChat.ui.noChats')}
            </p>
            <button
              onClick={onCreateChat}
              className="mt-3 text-sm text-[var(--color-primary-500)] hover:underline"
            >
              {t('aiChat.ui.createANewChat')}</button>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-secondary)]">
            {sortedChats.map(chat => (
              <div key={chat.id} className="relative flex items-center">
                <button
                  type="button"
                  aria-label={chat.title}
                  aria-current={selectedChatId === chat.id ? 'true' : undefined}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-3 px-3 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-primary-500)]',
                    (onPinChat || onMuteChat || onDeleteChat) && 'pr-12',
                    'hover:bg-[var(--bg-tertiary)]',
                    selectedChatId === chat.id && 'bg-[var(--color-primary-50)] dark:bg-[var(--color-primary-900)]/20'
                  )}
                  onClick={() => onSelectChat(chat.id)}
                  onContextMenu={(event) => {
                    const menu = event.currentTarget.parentElement?.querySelector('details');
                    if (!menu) return;
                    event.preventDefault();
                    menu.open = true;
                    menu.querySelector('summary')?.focus();
                  }}
                >
                  {/* Avatar */}
                  <span className="relative block flex-shrink-0 w-12 h-12">
                    {renderAvatar(chat)}
                    {/* Online indicator for direct chats */}
                    {chat.type === 'direct' && (
                      <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 border-2 border-[var(--bg-primary)] rounded-full" />
                    )}
                  </span>

                  {/* Content */}
                  <span className="block flex-1 min-w-0">
                    {/* Top row: Name + Time */}
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 min-w-0">
                        {chat.isPinned && (
                          <Pin className="w-3 h-3 text-[var(--text-tertiary)] flex-shrink-0" />
                        )}
                        <span className="font-medium text-[var(--text-primary)] truncate">
                          {chat.title}
                        </span>
                        {chat.type === 'agent' && (
                          <span className="flex-shrink-0 px-1 py-0.5 text-[9px] font-medium rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
                            AI
                          </span>
                        )}
                      </span>
                      <span className={cn(
                        'text-xs flex-shrink-0',
                        chat.unreadCount ? 'text-[var(--color-primary-500)] font-medium' : 'text-[var(--text-tertiary)]'
                      )}>
                        {formatTime(chat.lastMessage?.time)}
                      </span>
                    </span>

                    {/* Bottom row: Last message + Unread badge */}
                    <span className="flex items-center justify-between gap-2 mt-0.5">
                      <span className="flex items-center gap-1 min-w-0 text-sm text-[var(--text-secondary)]">
                        {/* Read status for own messages */}
                        {chat.lastMessage?.isOwn && (
                          chat.lastMessage.isRead ? (
                            <CheckCheck className="w-4 h-4 text-[var(--color-primary-500)] flex-shrink-0" />
                          ) : (
                            <Check className="w-4 h-4 text-[var(--text-tertiary)] flex-shrink-0" />
                          )
                        )}
                        <span className="truncate">
                          {chat.lastMessage ? (
                            <>
                              {chat.lastMessage.isOwn && <span className="text-[var(--text-tertiary)]">{t('aiChat.ui.youLabel')}</span>}
                              {truncateMessage(chat.lastMessage.content)}
                            </>
                          ) : (
                            <span className="text-[var(--text-secondary)] italic">{t('aiChat.ui.noMessages')}</span>
                          )}
                        </span>
                      </span>
                    
                      {/* Unread badge OR muted icon */}
                      <span className="flex items-center gap-1 flex-shrink-0">
                        {chat.isMuted && (
                          <VolumeX className="w-4 h-4 text-[var(--text-tertiary)]" />
                        )}
                        {(chat.unreadCount ?? 0) > 0 && (
                          <span className={cn(
                            'min-w-[20px] h-5 px-1.5 flex items-center justify-center text-xs font-medium rounded-full text-white',
                            chat.isMuted ? 'bg-gray-400' : 'bg-[var(--color-primary-500)]'
                          )}>
                            {(chat.unreadCount ?? 0) > 99 ? '99+' : chat.unreadCount}
                          </span>
                        )}
                      </span>
                    </span>

                    {/* Bindings indicator */}
                    {chat.bindings && chat.bindings.length > 0 && (
                      <span className="flex items-center gap-1 mt-1">
                        <Link2 className="w-3 h-3 text-[var(--text-tertiary)]" />
                        <span className="text-xs text-[var(--text-tertiary)] truncate">
                          {chat.bindings.map(b => b.rowTitle).join(', ')}
                        </span>
                      </span>
                    )}
                  </span>

                </button>

                {/* Native disclosure keeps actions separate from chat selection. */}
                {(onPinChat || onMuteChat || onDeleteChat) && (
                  <details
                    className="absolute right-2 top-3 z-10 open:z-20"
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
                    }}
                  >
                    <summary
                      onKeyDown={handleMenuKeyDown}
                      aria-label={`${t('aiChat.ui.more')}: ${chat.title}`}
                      className="list-none cursor-pointer rounded p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary-500)] [&::-webkit-details-marker]:hidden"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </summary>
                    <div className="absolute right-0 top-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg py-1 min-w-[160px]">
                      {[
                        { action: onPinChat, label: chat.isPinned ? t('aiChat.ui.unpin') : t('aiChat.ui.pin'), icon: <Pin className="w-4 h-4" /> },
                        { action: onMuteChat, label: chat.isMuted ? t('aiChat.ui.enableNotifications') : t('settings.2fa.disable'), icon: chat.isMuted ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" /> },
                        { action: onDeleteChat, label: t('aiChat.ui.delete'), icon: <Trash2 className="w-4 h-4" />, danger: true },
                      ].map(({ action, label, icon, danger }, index) => action && (
                        <button
                          key={index}
                          type="button"
                          onKeyDown={handleMenuKeyDown}
                          onClick={(event) => {
                            const menu = event.currentTarget.closest('details');
                            if (menu) {
                              menu.open = false;
                              menu.querySelector('summary')?.focus();
                            }
                            action(chat.id);
                          }}
                          className={cn('w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--bg-tertiary)] focus-visible:bg-[var(--bg-tertiary)]', danger ? 'text-red-600 dark:text-red-400' : 'text-[var(--text-primary)]')}
                        >
                          {icon}{label}
                        </button>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Chat FAB - Telegram style */}
      <button
        onClick={onCreateChat}
        className="absolute bottom-4 right-4 w-14 h-14 rounded-full bg-[var(--color-primary-500)] text-white shadow-lg hover:bg-[var(--color-primary-600)] transition-colors flex items-center justify-center"
        title={t('aiChat.ui.newChat')}
      >
        <Edit3 className="w-6 h-6" />
      </button>
    </div>
  );
}
