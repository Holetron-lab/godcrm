import React, { useCallback, useState } from 'react';
import {
  Bot,
  User,
  MoreVertical,
  Copy,
  Forward,
  Trash2,
  Ban,
  Key,
  ExternalLink,
  Wrench,
  Zap,
  Plus,
  Link2,
  ArrowRightLeft
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { MarkdownPreview, type CheckboxClickInfo, type CheckboxUser } from '@/shared/components/MarkdownPreview';
import type { ChatMessage } from '../../types';
import { ChatAttachmentRenderer } from './ChatAttachmentRenderer';
import { HighlightedText } from '../../../HighlightedText';

interface MessageReaction {
  emoji: string;
  users: { user_id: number; user_name: string }[];
  hasMyReaction: boolean;
}

interface MessageBubbleProps {
  message: ChatMessage;
  currentUserId?: number;
  markdownEnabled?: boolean;
  chatType?: 'ai' | 'user';
  reactions?: Record<string, { user_id: number; user_name: string }[]>;
  quickEmojis?: string[];
  onReact?: (messageId: number, emoji: string) => void;
  onCopy?: (message: ChatMessage) => void;
  onForward?: (message: ChatMessage) => void;
  /** ADR-0031 WP-24: open move-message modal for this message. Visible only when isChatOwner is true. */
  onMove?: (message: ChatMessage) => void;
  /** ADR-0031 WP-24: gate for «Перенести» — show only when current user owns the conversation */
  isChatOwner?: boolean;
  onDelete?: (messageId: number) => void;
  /** Opens the RowBindingV2 panel for this specific message (ADR-090) */
  onAttachLink?: (message: ChatMessage) => void;
  /** Fired when a checkbox in markdown message is clicked. Used to copy context to chat input. */
  onCheckboxClick?: (info: CheckboxClickInfo) => void;
  /** Current user info — attached to checkbox click events */
  currentUser?: CheckboxUser;
  /** Callback when a @mention or /command is clicked in message text */
  onMentionClick?: (token: string) => void;
}

const MessageBubbleImpl: React.FC<MessageBubbleProps> = ({
  message,
  currentUserId,
  markdownEnabled = true,
  chatType = 'ai',
  reactions = {},
  quickEmojis = ['👍', '❤️', '😂', '😮', '😢', '🙏'],
  onReact,
  onCopy,
  onForward,
  onMove,
  isChatOwner,
  onDelete,
  onAttachLink,
  onCheckboxClick,
  currentUser,
  onMentionClick
}) => {
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);

  // Stabilize the checkbox handler so the memoized MarkdownPreview below
  // does not re-parse on every parent render. Identity changes only when
  // captured deps change.
  const handleCheckboxClick = useCallback((info: CheckboxClickInfo) => {
    onCheckboxClick?.(info);
    onForward?.(message);
  }, [onCheckboxClick, onForward, message]);

  // For user chats: check sender_id vs current user
  // For AI chats: use role (user = sent by me, assistant = AI response)
  const isFromMe = message.sender_id !== undefined && message.sender_id !== null
    ? Number(message.sender_id) === Number(currentUserId)
    : message.role === 'user';
  
  // Own messages aligned right with icon on right, others on left
  const alignRight = isFromMe;
  
  const isAI = message.role === 'assistant';
  
  // Process reactions
  const reactionList: MessageReaction[] = Object.entries(reactions).map(([emoji, users]) => ({
    emoji,
    users,
    hasMyReaction: users.some(u => u.user_id === currentUserId)
  }));
  
  // Format timestamp
  const formatTime = (timestamp: Date | string | undefined) => {
    if (!timestamp) return '';
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const isThisYear = date.getFullYear() === now.getFullYear();
    
    const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    
    if (isToday) {
      return time;
    } else if (isThisYear) {
      return `${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} ${time}`;
    } else {
      return `${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })} ${time}`;
    }
  };
  
  // Get timestamp from message (can be timestamp, created_at, or undefined)
  const messageTime = (message as unknown as { created_at?: string }).created_at || message.timestamp;
  
  const handleReact = (emoji: string) => {
    if (onReact && message.id) {
      onReact(Number(message.id), emoji);
    }
    setShowReactionPicker(false);
  };
  
  return (
    <div 
      className={cn('flex gap-3 items-start group relative', alignRight && 'justify-end')}
      onMouseLeave={() => { setShowReactionPicker(false); setShowContextMenu(false); }}
    >
      {/* Avatar - only show for received messages (not from me) */}
      {!isFromMe && (
        <div className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
          isAI 
            ? 'bg-purple-500/20 text-purple-400'
            : 'bg-green-500/20 text-green-400'
        )}>
          {isAI ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
        </div>
      )}
      <div className={cn('flex flex-col gap-1 min-w-0 overflow-hidden', isFromMe ? 'items-end' : 'items-start', 'max-w-[80%]')}>
        {/* Message bubble */}
        <div className="relative min-w-0 max-w-full">
          {/* Context Menu Button (three dots) */}
          <button
            onClick={() => setShowContextMenu(!showContextMenu)}
            className={cn(
              'absolute top-1 z-10 w-6 h-6 rounded-full flex items-center justify-center',
              'bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
              'opacity-0 group-hover:opacity-100 transition-opacity shadow-sm',
              alignRight ? 'left-0 -translate-x-8' : 'right-0 translate-x-8'
            )}
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
          
          {/* Context Menu Dropdown */}
          {showContextMenu && (
            <div 
              className={cn(
                'absolute top-0 z-50 min-w-[140px] py-1 rounded-lg bg-[var(--bg-secondary)] shadow-lg border border-[var(--border-primary)]',
                alignRight ? 'left-0 -translate-x-[150px]' : 'right-0 translate-x-[40px]'
              )}
            >
              <button
                onClick={() => {
                  onCopy?.(message);
                  setShowContextMenu(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <Copy className="w-4 h-4" />
                Копировать
              </button>
              {/* ADR-0031 WP-24: «Перенести» — owner-only, hidden (not disabled) for non-owners */}
              {isChatOwner && onMove && (
                <button
                  onClick={() => {
                    onMove(message);
                    setShowContextMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                  <ArrowRightLeft className="w-4 h-4" />
                  Перенести
                </button>
              )}
              <button
                onClick={() => {
                  onForward?.(message);
                  setShowContextMenu(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <Forward className="w-4 h-4" />
                Переслать
              </button>
              {onAttachLink && (
                <button
                  onClick={() => {
                    onAttachLink(message);
                    setShowContextMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                  <Link2 className="w-4 h-4" />
                  Прикрепить ссылку
                </button>
              )}
              {isFromMe && onDelete && message.id && (
                <button
                  onClick={() => {
                    onDelete(Number(message.id));
                    setShowContextMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Удалить
                </button>
              )}
            </div>
          )}
          
          {/* Deleted message placeholder */}
          {message.is_deleted ? (
            <div className={cn(
              'rounded-2xl px-4 py-2 italic',
              isFromMe 
                ? 'bg-[var(--color-primary-500)]/30 text-white/60 rounded-br-md' 
                : 'bg-[var(--bg-tertiary)]/50 text-[var(--text-tertiary)] rounded-bl-md'
            )}>
              <div className="flex items-center gap-2 text-sm">
                <Ban className="w-4 h-4" />
                <span>Сообщение удалено</span>
              </div>
            </div>
          ) : (
          <div className={cn(
            'rounded-2xl px-4 py-2 overflow-hidden break-words',
            isFromMe 
              ? 'bg-[var(--color-primary-500)] text-white rounded-br-md' 
              : 'bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded-bl-md'
          )}>
          {message.content ? (
            // Check for API key error
            message.content.includes('No API key configured') ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-red-400">
                  <Key className="w-4 h-4" />
                  <span className="text-sm">API ключ не настроен</span>
                </div>
                <a
                  href="/tables/232"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 rounded-lg text-xs font-medium transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  Открыть таблицу API Keys
                </a>
              </div>
            ) : (
              markdownEnabled ? (
                <MarkdownPreview content={message.content} className="text-sm" onCheckboxClick={onCheckboxClick ? handleCheckboxClick : undefined} currentUser={currentUser} />
              ) : (
                <div className="text-sm whitespace-pre-wrap">
                <HighlightedText text={message.content} onMentionClick={onMentionClick} />
              </div>
              )
            )
          ) : (message.isStreaming || isAI) ? (
            // Streaming placeholder or empty AI message - show typing indicator
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          ) : (
            // Empty human message fallback
            <span className="text-sm opacity-50">—</span>
          )}
          {message.attachments && message.attachments.length > 0 && (
            <ChatAttachmentRenderer attachments={message.attachments} />
          )}
          
          {/* Tool Results for Agent Mode */}
          {message.toolResults && message.toolResults.length > 0 && (
            <div className="mt-2 pt-2 border-t border-[var(--border-primary)]">
              <div className="flex items-center gap-1 text-xs text-[var(--text-tertiary)] mb-1">
                <Wrench className="w-3 h-3" />
                <span>Использовано {message.toolResults.length} инструментов</span>
                {message.iterations && <span className="ml-1">({message.iterations} итераций)</span>}
              </div>
              <div className="space-y-1">
                {message.toolResults.map((tr: { tool: string; args?: unknown; result?: unknown }, idx: number) => (
                  <details key={idx} className="text-xs">
                    <summary className="cursor-pointer hover:text-[var(--color-primary-500)] flex items-center gap-1">
                      <Zap className="w-3 h-3 text-orange-500" />
                      <span className="font-medium">{tr.tool}</span>
                    </summary>
                    <div className="ml-4 mt-1 p-2 bg-[var(--bg-primary)] rounded text-[var(--text-tertiary)] overflow-x-auto">
                      <pre className="text-[10px] whitespace-pre-wrap break-all">{JSON.stringify(tr.result, null, 2).substring(0, 500)}</pre>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}
          </div>
          )}
        </div>
        
        {/* Timestamp row with inline reactions */}
        <div className={cn(
          'flex items-center gap-2 px-1 text-[10px] text-[var(--text-tertiary)]',
          alignRight ? 'flex-row-reverse' : 'flex-row'
        )}>
          {/* Timestamp */}
          <span>{formatTime(messageTime)}</span>
          
          {/* Reaction button with hover picker */}
          {onReact && message.id && (
            <div 
              className="relative flex items-center gap-1"
              onMouseEnter={() => setShowReactionPicker(true)}
              onMouseLeave={() => setShowReactionPicker(false)}
            >
              {/* Plus button for mobile - toggles picker on click */}
              <button
                onClick={() => setShowReactionPicker(!showReactionPicker)}
                className="md:hidden w-5 h-5 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                title="Добавить реакцию"
              >
                <Plus className="w-3 h-3" />
              </button>
              
              {/* Heart reaction button */}
              <button
                onClick={() => handleReact('❤️')}
                className={cn(
                  'flex items-center gap-0.5 transition-colors',
                  reactionList.some(r => r.emoji === '❤️' && r.hasMyReaction)
                    ? 'text-red-500'
                    : 'text-[var(--text-tertiary)] hover:text-red-400'
                )}
                title={reactionList.find(r => r.emoji === '❤️')?.users.map(u => u.user_name).join(', ') || 'Нравится'}
              >
                {reactionList.some(r => r.emoji === '❤️') ? '❤️' : '🤍'}
                {reactionList.find(r => r.emoji === '❤️')?.users.length ? (
                  <span className="text-[10px]">{reactionList.find(r => r.emoji === '❤️')?.users.length}</span>
                ) : null}
              </button>
              
              {/* Other reactions count */}
              {reactionList.filter(r => r.emoji !== '❤️').length > 0 && (
                <div className="flex items-center gap-0.5 ml-1">
                  {reactionList.filter(r => r.emoji !== '❤️').slice(0, 3).map(({ emoji, users, hasMyReaction }) => (
                    <button
                      key={emoji}
                      onClick={() => handleReact(emoji)}
                      className={cn(
                        'flex items-center transition-colors',
                        hasMyReaction ? 'opacity-100' : 'opacity-70 hover:opacity-100'
                      )}
                      title={users.map(u => u.user_name).join(', ')}
                    >
                      <span className="text-xs">{emoji}</span>
                      <span className="text-[10px] text-[var(--text-tertiary)]">{users.length}</span>
                    </button>
                  ))}
                </div>
              )}
              
              {/* Hover picker (desktop) / Click picker (mobile) */}
              {showReactionPicker && (
                <div 
                  className={cn(
                    'absolute top-1/2 -translate-y-1/2 z-50 flex gap-0.5 p-1 rounded-full bg-[var(--bg-secondary)] shadow-lg',
                    alignRight ? 'right-full mr-1' : 'left-full ml-1'
                  )}
                >
                  {quickEmojis.filter(e => e !== '❤️').map(emoji => (
                    <button
                      key={emoji}
                      onClick={() => handleReact(emoji)}
                      className={cn(
                        'w-6 h-6 rounded-full flex items-center justify-center text-sm transition-transform hover:scale-125',
                        reactionList.some(r => r.emoji === emoji && r.hasMyReaction) && 'bg-[var(--bg-tertiary)]'
                      )}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const MessageBubble = React.memo(MessageBubbleImpl);