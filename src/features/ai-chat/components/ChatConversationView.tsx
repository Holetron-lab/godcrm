/**
 * ChatConversationView Component
 * ADR-024: Telegram-like Conversation View
 *
 * Refactored: message list rendering extracted to ChatMessageList.tsx
 * This file handles: header, input area, attachments, reply preview, forward strip.
 */

import { useState, useRef, FormEvent } from 'react';
import {
  ArrowLeft,
  MoreVertical,
  Bot,
  User,
  Paperclip,
  Send,
  X,
  Image as ImageIcon,
  FileText,
  File,
  Loader2,
  Forward,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { MentionInput, MentionUser } from './MentionInput';
import { useAuthStore } from '@/features/auth/store/authStore';
import { validateAndWrapCommands } from '../utils/invocationTokens';
import { ChatMessageList } from './ChatMessageList';
import { PinnedBanner } from './PinnedBanner';
import { ValidSlugsProvider } from '../context/ValidSlugsContext';
import type { MessageContentType } from '../types';

// ADR-0068 WP-E: widen to match the union in `types.ts:MessageContentType` so
// TelegramChatLayout's pass-through (msg.contentType: MessageContentType) no
// longer drifts vs the narrower one previously declared here.
export type ChatMessageItemContentType = MessageContentType;

export interface ChatMessageItem {
  id: number | string;
  content: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  sender?: {
    id: number;
    name: string;
    avatar?: string;
    type: 'user' | 'agent';
  };
  timestamp: Date;
  isRead?: boolean;
  attachments?: Array<{
    id: string;
    name: string;
    type: string;
    url?: string;
    size?: number;
  }>;
  // ADR-0068 WP-C — partial-text quote (fragment+range optional, message_id canonical).
  replyTo?: {
    message_id: number;
    content: string;
    sender: string;
    fragment?: string;
    range?: [number, number];
  };
  isEdited?: boolean;
  contentType?: ChatMessageItemContentType;
  toolResults?: Array<{ tool: string; args?: Record<string, unknown>; result?: unknown }>;
  iterations?: number;
  agentName?: string;
  is_deleted?: boolean;
  // ADR-0068 WP-E — `null` = not pinned; ISO string = pinned at that time.
  pinned_at?: string | null;
}

export interface ChatInfo {
  id: number;
  title: string;
  type: 'agent' | 'direct' | 'group' | 'task';
  avatar?: string;
  icon?: string;
  status?: 'online' | 'typing' | 'offline' | 'last_seen';
  lastSeen?: Date;
  participantsCount?: number;
  agentModel?: string;
}

export interface ChatConversationViewProps {
  chat: ChatInfo | null;
  messages: ChatMessageItem[];
  isLoading?: boolean;
  isTyping?: boolean;
  typingAgentName?: string | null;
  onSendMessage: (
    content: string,
    attachments?: File[],
    mentions?: MentionUser[],
    replyTo?: { message_id: number; fragment?: string; range?: [number, number] }
  ) => Promise<void>;
  onBack?: () => void;
  onOpenSettings?: () => void;
  onDeleteMessage?: (messageId: number | string) => void;
  onEditMessage?: (messageId: number | string, newContent: string) => void;
  mentionUsers?: MentionUser[];
  mentionAgents?: MentionUser[];
  className?: string;
  currentUserId?: number;
  hasMoreMessages?: boolean;
  onLoadMoreMessages?: () => Promise<void>;
  isLoadingMore?: boolean;
  currentConversationId?: number | string;
  // ADR-0068 WP-E — pin handlers + cap state. Wired by the host (e.g.
  // TelegramChatLayout) via usePinMessage. Undefined → ⋮-menu hides Pin/Unpin
  // and the PinnedBanner suppresses its cap notice.
  onPinMessage?: (messageId: number | string) => void;
  onUnpinMessage?: (messageId: number | string) => void;
  pinCapReached?: boolean;
  onClearPinCapNotice?: () => void;
}

export function ChatConversationView({
  chat,
  messages,
  isLoading = false,
  isTyping = false,
  typingAgentName,
  onSendMessage,
  onBack,
  onOpenSettings,
  onDeleteMessage,
  onEditMessage,
  mentionUsers = [],
  mentionAgents = [],
  className,
  currentUserId,
  hasMoreMessages = false,
  onLoadMoreMessages,
  isLoadingMore = false,
  currentConversationId,
  onPinMessage,
  onUnpinMessage,
  pinCapReached,
  onClearPinCapNotice,
}: ChatConversationViewProps) {
  const [inputValue, setInputValue] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [mentionedUsers, setMentionedUsers] = useState<MentionUser[]>([]);
  const [isSending, setIsSending] = useState(false);
  const isSendingRef = useRef(false);
  const [replyTo, setReplyTo] = useState<ChatMessageItem | null>(null);
  const [pendingForwards, setPendingForwards] = useState<ChatMessageItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const authUser = useAuthStore((s) => s.user);

  const formatTime = (date: Date) => date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();

    let trimmedInput = inputValue.trim();
    trimmedInput = validateAndWrapCommands(trimmedInput, mentionAgents);

    const hasForwards = pendingForwards.length > 0;
    if (!trimmedInput && attachments.length === 0 && !hasForwards) return;
    if (isSendingRef.current) return;
    isSendingRef.current = true;

    // Build message with forwarded blocks
    let finalContent = trimmedInput;
    if (hasForwards) {
      const forwardBlocks = pendingForwards.map(fw => {
        const senderName = fw.sender?.name || (fw.role === 'user' ? 'User' : 'Agent');
        const time = fw.timestamp ? formatTime(fw.timestamp) : '';
        const dateStr = fw.timestamp
          ? fw.timestamp.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
          : '';
        const cleanContent = fw.content
          .replace(/<<@([a-z0-9_-]+)>>/gi, '@$1')
          .replace(/<<\/([a-z0-9_-]+)>>/gi, '/$1');
        return `> **${senderName}** (${dateStr}, ${time})\n> ${cleanContent.replace(/\n/g, '\n> ')}\n> _чат #${chat?.id || '?'}, сообщение #${fw.id}_`;
      }).join('\n\n');

      finalContent = finalContent
        ? `${finalContent}\n\n${forwardBlocks}`
        : forwardBlocks;
    }

    const mentionsToSend = [...mentionedUsers];
    setIsSending(true);
    try {
      // ADR-0068 WP-C: reply_to only carries server-side ids; skip when target
      // is still an optimistic message (string id) — server cannot resolve it.
      const replyToPayload = replyTo && typeof replyTo.id === 'number'
        ? { message_id: replyTo.id }
        : undefined;

      await onSendMessage(
        finalContent,
        attachments.length > 0 ? attachments : undefined,
        mentionsToSend.length > 0 ? mentionsToSend : undefined,
        replyToPayload
      );
      setInputValue('');
      setAttachments([]);
      setMentionedUsers([]);
      setReplyTo(null);
      setPendingForwards([]);
    } finally {
      setIsSending(false);
      isSendingRef.current = false;
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setAttachments(prev => [...prev, ...files]);
    e.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return <ImageIcon className="w-4 h-4" />;
    if (type.includes('pdf') || type.includes('document')) return <FileText className="w-4 h-4" />;
    return <File className="w-4 h-4" />;
  };

  const handleForward = (message: ChatMessageItem) => {
    setPendingForwards(prev => {
      if (prev.some(m => m.id === message.id)) return prev;
      return [...prev, message];
    });
  };

  const renderStatus = () => {
    if (!chat) return null;
    if (isTyping) {
      return <span className="text-[var(--color-primary-500)]">{typingAgentName ? `${typingAgentName} думает...` : 'печатает...'}</span>;
    }
    if (chat.type === 'agent') {
      return <span className="text-[var(--text-tertiary)]">{chat.agentModel || 'AI Agent'}</span>;
    }
    if (chat.type === 'group' && chat.participantsCount) {
      return <span className="text-[var(--text-tertiary)]">{chat.participantsCount} участников</span>;
    }
    if (chat.status === 'online') {
      return <span className="text-green-500">онлайн</span>;
    }
    if (chat.lastSeen) {
      return <span className="text-[var(--text-tertiary)]">был(а) {formatTime(chat.lastSeen)}</span>;
    }
    return null;
  };

  // Empty state
  if (!chat) {
    return (
      <div className={cn('flex flex-col h-full items-center justify-center bg-[var(--bg-secondary)]', className)}>
        <div className="text-center px-8">
          <div className="w-20 h-20 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center mx-auto mb-4">
            <Bot className="w-10 h-10 text-[var(--text-tertiary)]" />
          </div>
          <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">Выберите чат</h3>
          <p className="text-sm text-[var(--text-tertiary)]">Выберите чат из списка слева или создайте новый</p>
        </div>
      </div>
    );
  }

  return (
    <ValidSlugsProvider mentionUsers={mentionUsers} slashAgents={mentionAgents}>
    <div className={cn('flex flex-col h-full bg-[var(--bg-secondary)]', className)}>
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 bg-[var(--bg-primary)] border-b border-[var(--border-primary)]">
        {onBack && (
          <button
            onClick={onBack}
            className="p-1.5 -ml-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors lg:hidden"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}

        <div className="relative flex-shrink-0 w-10 h-10 cursor-pointer" onClick={onOpenSettings}>
          {chat.avatar ? (
            <img src={chat.avatar} alt={chat.title} className="w-full h-full rounded-full object-cover" />
          ) : (
            <div className={cn(
              'w-full h-full rounded-full flex items-center justify-center text-white',
              chat.type === 'agent' ? 'bg-gradient-to-br from-purple-500 to-purple-600' :
              chat.type === 'group' ? 'bg-gradient-to-br from-green-500 to-green-600' :
              'bg-gradient-to-br from-blue-500 to-blue-600'
            )}>
              {chat.icon ? <span className="text-lg">{chat.icon}</span> :
               chat.type === 'agent' ? <Bot className="w-5 h-5" /> : <User className="w-5 h-5" />}
            </div>
          )}
          {chat.status === 'online' && (
            <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-[var(--bg-primary)] rounded-full" />
          )}
        </div>

        <div className="flex-1 min-w-0 cursor-pointer" onClick={onOpenSettings}>
          <div className="flex items-center gap-2">
            <span className="font-medium text-[var(--text-primary)] truncate">{chat.title}</span>
            {chat.type === 'agent' && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">AI</span>
            )}
          </div>
          <div className="text-xs">{renderStatus()}</div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            title="Настройки чата"
          >
            <MoreVertical className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ADR-0068 WP-E (variant B) — PinnedBanner sits between header and the
          scrollable message list. Filtering + rev-chrono sort happen inside the
          banner; we just hand it the full message list. Jump dispatches the
          existing `navigate-to-chat-message` event that ChatMessageList listens
          for (same primitive used by WP-D forward chips). */}
      <PinnedBanner
        messages={messages}
        onJump={(messageId) => {
          window.dispatchEvent(
            new CustomEvent('navigate-to-chat-message', {
              detail: { chatId: currentConversationId || chat.id, messageId },
            }),
          );
        }}
        onUnpin={onUnpinMessage}
        capReached={pinCapReached}
        onClearCapNotice={onClearPinCapNotice}
      />

      {/* Message List (extracted component) */}
      <ChatMessageList
        chat={chat}
        messages={messages}
        isLoading={isLoading}
        isTyping={isTyping}
        typingAgentName={typingAgentName}
        currentUserId={currentUserId}
        hasMoreMessages={hasMoreMessages}
        onLoadMoreMessages={onLoadMoreMessages}
        isLoadingMore={isLoadingMore}
        onDeleteMessage={onDeleteMessage}
        onEditMessage={onEditMessage}
        onReply={setReplyTo}
        onForward={handleForward}
        onPin={onPinMessage}
        onUnpin={onUnpinMessage}
        setInputValue={setInputValue}
        authUser={authUser ? { name: authUser.name, id: Number(authUser.id) } : null}
        currentConversationId={currentConversationId || chat.id}
      />

      {/* Reply preview */}
      {replyTo && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-[var(--bg-tertiary)] border-t border-[var(--border-secondary)]">
          <div className="flex-1 min-w-0 border-l-2 border-[var(--color-primary-500)] pl-2">
            <div className="text-xs font-medium text-[var(--color-primary-500)]">
              {replyTo.sender?.name || (replyTo.role === 'user' ? 'Вы' : chat.title)}
            </div>
            <div className="text-xs text-[var(--text-secondary)] truncate">{replyTo.content}</div>
          </div>
          <button onClick={() => setReplyTo(null)} className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Pending forwards strip */}
      {pendingForwards.length > 0 && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-[var(--bg-tertiary)] border-t border-[var(--border-secondary)] overflow-x-auto">
          <Forward className="w-4 h-4 text-orange-400 flex-shrink-0" />
          <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto">
            {pendingForwards.length <= 4 ? (
              pendingForwards.map((fw) => (
                <div
                  key={fw.id}
                  className="flex items-center gap-1 px-2 py-1 bg-orange-500/15 text-orange-300 rounded-full text-xs flex-shrink-0"
                >
                  <span className="font-medium">{fw.sender?.name || 'User'}</span>
                  <span className="text-orange-300/60 max-w-[60px] truncate">{fw.content.slice(0, 10)}</span>
                  <span className="text-orange-300/40 text-[10px]">{formatTime(fw.timestamp)}</span>
                  <button
                    onClick={() => setPendingForwards(prev => prev.filter(m => m.id !== fw.id))}
                    className="ml-0.5 hover:text-red-400"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))
            ) : (
              <div className="flex items-center gap-1 text-xs text-orange-300">
                {pendingForwards.slice(0, 3).map(fw => (
                  <span key={fw.id} className="font-medium">{fw.sender?.name || 'User'}</span>
                ))}
                <span className="text-orange-300/60">+{pendingForwards.length - 3} ({pendingForwards.length} сообщ.)</span>
              </div>
            )}
          </div>
          <button
            onClick={() => setPendingForwards([])}
            className="p-1 rounded text-[var(--text-tertiary)] hover:text-red-400 flex-shrink-0"
            title="Убрать все"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="flex-shrink-0 flex gap-2 px-4 py-2 bg-[var(--bg-tertiary)] border-t border-[var(--border-secondary)] overflow-x-auto">
          {attachments.map((file, index) => (
            <div key={index} className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-primary)] rounded-lg flex-shrink-0">
              {getFileIcon(file.type)}
              <span className="text-xs text-[var(--text-primary)] max-w-[100px] truncate">{file.name}</span>
              <button onClick={() => removeAttachment(index)} className="p-0.5 rounded text-[var(--text-tertiary)] hover:text-red-500">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div
        className="flex-shrink-0 px-4 py-3 bg-[var(--bg-primary)] border-t border-[var(--border-primary)]"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
      >
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect}
            accept="image/*,.pdf,.txt,.md,.json,.csv,.doc,.docx,.xls,.xlsx,.stl" />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors flex-shrink-0"
            title="Прикрепить файл"
          >
            <Paperclip className="w-5 h-5" />
          </button>

          <div className="flex-1 min-w-0">
            <MentionInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              onMention={(user) => {
                setMentionedUsers(prev => {
                  if (prev.some(u => u.id === user.id && u.type === user.type)) return prev;
                  return [...prev, user];
                });
              }}
              availableUsers={mentionUsers}
              availableAgents={mentionAgents}
              placeholder="Сообщение... (@ или / для вызова агента)"
              disabled={isSending}
              className="bg-[var(--bg-tertiary)] rounded-2xl px-4 py-2"
            />
          </div>

          <button
            type="submit"
            disabled={isSending || (!inputValue.trim() && attachments.length === 0 && pendingForwards.length === 0)}
            className={cn(
              'p-2 rounded-full transition-colors flex-shrink-0',
              inputValue.trim() || attachments.length > 0 || pendingForwards.length > 0
                ? 'bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)]'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]'
            )}
            title="Отправить"
          >
            {isSending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </form>
      </div>
    </div>
    </ValidSlugsProvider>
  );
}
