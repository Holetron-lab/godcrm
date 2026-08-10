/**
 * ChatListView Component
 * ADR-024: Telegram-like Chat List
 * 
 * Displays list of conversations in Telegram style:
 * - Avatar, name, last message preview, time
 * - Search bar at top
 * - New chat FAB button
 */

import { useState, useMemo } from 'react';
import { 
  Search,
  Plus,
  Bot,
  User,
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
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenuChatId, setContextMenuChatId] = useState<number | null>(null);

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
      return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Вчера';
    } else if (days < 7) {
      return date.toLocaleDateString('ru-RU', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    }
  };

  // Truncate last message
  const truncateMessage = (text: string, maxLength: number = 40) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  // Get chat avatar
  const renderAvatar = (chat: ChatPreview) => {
    if (chat.avatar) {
      return (
        <img 
          src={chat.avatar} 
          alt={chat.title}
          className="w-full h-full rounded-full object-cover"
        />
      );
    }
    
    // Default avatars based on type
    const bgColors: Record<string, string> = {
      agent: 'bg-gradient-to-br from-purple-500 to-purple-600',
      direct: 'bg-gradient-to-br from-blue-500 to-blue-600',
      group: 'bg-gradient-to-br from-green-500 to-green-600',
      task: 'bg-gradient-to-br from-orange-500 to-orange-600'
    };
    
    return (
      <div className={cn(
        'w-full h-full rounded-full flex items-center justify-center text-white',
        bgColors[chat.type] || bgColors.direct
      )}>
        {chat.icon ? (
          <span className="text-xl">{chat.icon}</span>
        ) : chat.type === 'agent' ? (
          <Bot className="w-6 h-6" />
        ) : chat.type === 'group' ? (
          <MessageSquare className="w-6 h-6" />
        ) : chat.type === 'task' ? (
          <Link2 className="w-6 h-6" />
        ) : (
          <User className="w-6 h-6" />
        )}
      </div>
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
            placeholder="Поиск..."
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
              {searchQuery ? 'Чаты не найдены' : 'Нет чатов'}
            </p>
            <button
              onClick={onCreateChat}
              className="mt-3 text-sm text-[var(--color-primary-500)] hover:underline"
            >
              Создать новый чат
            </button>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-secondary)]">
            {sortedChats.map(chat => (
              <div
                key={chat.id}
                className={cn(
                  'relative flex items-center gap-3 px-3 py-3 cursor-pointer transition-colors',
                  'hover:bg-[var(--bg-tertiary)]',
                  selectedChatId === chat.id && 'bg-[var(--color-primary-50)] dark:bg-[var(--color-primary-900)]/20'
                )}
                onClick={() => onSelectChat(chat.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenuChatId(contextMenuChatId === chat.id ? null : chat.id);
                }}
              >
                {/* Avatar */}
                <div className="relative flex-shrink-0 w-12 h-12">
                  {renderAvatar(chat)}
                  {/* Online indicator for direct chats */}
                  {chat.type === 'direct' && (
                    <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 border-2 border-[var(--bg-primary)] rounded-full" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {/* Top row: Name + Time */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
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
                    </div>
                    <span className={cn(
                      'text-xs flex-shrink-0',
                      chat.unreadCount ? 'text-[var(--color-primary-500)] font-medium' : 'text-[var(--text-tertiary)]'
                    )}>
                      {formatTime(chat.lastMessage?.time)}
                    </span>
                  </div>

                  {/* Bottom row: Last message + Unread badge */}
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <div className="flex items-center gap-1 min-w-0 text-sm text-[var(--text-secondary)]">
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
                            {chat.lastMessage.isOwn && <span className="text-[var(--text-tertiary)]">Вы: </span>}
                            {truncateMessage(chat.lastMessage.content)}
                          </>
                        ) : (
                          <span className="text-[var(--text-tertiary)] italic">Нет сообщений</span>
                        )}
                      </span>
                    </div>
                    
                    {/* Unread badge OR muted icon */}
                    <div className="flex items-center gap-1 flex-shrink-0">
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
                    </div>
                  </div>

                  {/* Bindings indicator */}
                  {chat.bindings && chat.bindings.length > 0 && (
                    <div className="flex items-center gap-1 mt-1">
                      <Link2 className="w-3 h-3 text-[var(--text-tertiary)]" />
                      <span className="text-xs text-[var(--text-tertiary)] truncate">
                        {chat.bindings.map(b => b.rowTitle).join(', ')}
                      </span>
                    </div>
                  )}
                </div>

                {/* Context Menu */}
                {contextMenuChatId === chat.id && (
                  <div 
                    className="absolute right-2 top-2 z-10 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg py-1 min-w-[160px]"
                    onClick={e => e.stopPropagation()}
                  >
                    {onPinChat && (
                      <button
                        onClick={() => {
                          onPinChat(chat.id);
                          setContextMenuChatId(null);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                      >
                        <Pin className="w-4 h-4" />
                        {chat.isPinned ? 'Открепить' : 'Закрепить'}
                      </button>
                    )}
                    {onMuteChat && (
                      <button
                        onClick={() => {
                          onMuteChat(chat.id);
                          setContextMenuChatId(null);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                      >
                        {chat.isMuted ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                        {chat.isMuted ? 'Включить уведомления' : 'Отключить'}
                      </button>
                    )}
                    {onDeleteChat && (
                      <button
                        onClick={() => {
                          onDeleteChat(chat.id);
                          setContextMenuChatId(null);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-[var(--bg-tertiary)]"
                      >
                        <Trash2 className="w-4 h-4" />
                        Удалить
                      </button>
                    )}
                  </div>
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
        title="Новый чат"
      >
        <Edit3 className="w-6 h-6" />
      </button>
    </div>
  );
}
