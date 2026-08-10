/**
 * ChatConversationView Component
 * ADR-024: Telegram-like Conversation View
 * 
 * Active chat conversation panel:
 * - Header with chat info and actions
 * - Messages list with bubbles
 * - Input area with attachments
 */

import { useState, useRef, useEffect, useCallback, useMemo, FormEvent, KeyboardEvent } from 'react';
import {
  ArrowLeft,
  MoreVertical,
  Phone,
  Video,
  Search,
  Paperclip,
  Smile,
  Send,
  Mic,
  Bot,
  User,
  Check,
  CheckCheck,
  Image as ImageIcon,
  FileText,
  File,
  X,
  Link2,
  Settings,
  Trash2,
  Edit3,
  Copy,
  Reply,
  Forward,
  Pin,
  Loader2,
  ArrowDown
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { MarkdownPreview, type CheckboxClickInfo } from '@/shared/components/MarkdownPreview';
import { MentionInput, MentionUser } from './MentionInput';
import { useAuthStore } from '@/features/auth/store/authStore';
import { groupChatMessageItems, type ChatMessageItemTurn } from '../utils/groupChatMessageItems';
import { AgentTurnBubble } from './AgentTurnBubble';
import { ChatAttachmentRenderer } from './AIChatPanel/components/ChatMessages/ChatAttachmentRenderer';
import { HighlightedText } from './HighlightedText';
// ADR-116: Structured Invocation Token validation on submit
import { validateAndWrapMentions, validateAndWrapCommands } from '../utils/invocationTokens';
import { apiClient } from '@/shared/utils/apiClient';
import { toggleCheckboxByIndex, normalizeCheckboxes, denormalizeCheckboxes, getCheckboxContext } from '@/shared/utils/markdownCheckbox';
import { CHAT_CONFIG } from '../constants/chatConfig';

export type ChatMessageItemContentType = 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'tool_approval' | 'plan';

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
  replyTo?: {
    id: number;
    content: string;
    sender: string;
  };
  isEdited?: boolean;
  /** Agent step support — contentType for thinking/tool_call/tool_result grouping */
  contentType?: ChatMessageItemContentType;
  /** Legacy tool results array (from single-message agent responses) */
  toolResults?: Array<{ tool: string; args?: Record<string, unknown>; result?: unknown }>;
  /** Number of iterations the agent performed */
  iterations?: number;
  /** Agent display name (for multi-agent group chats) */
  agentName?: string;
  /** Whether message is deleted */
  is_deleted?: boolean;
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
  /** Name of the agent currently processing — displayed as "{name} думает..." */
  typingAgentName?: string | null;
  onSendMessage: (content: string, attachments?: File[], mentions?: MentionUser[]) => Promise<void>;
  onBack?: () => void;
  onOpenSettings?: () => void;
  onDeleteMessage?: (messageId: number | string) => void;
  onEditMessage?: (messageId: number | string, newContent: string) => void;
  mentionUsers?: MentionUser[];
  /** ADR-069: Agents available for /command invocation */
  mentionAgents?: MentionUser[];
  className?: string;
  currentUserId?: number; // For human-to-human chats to determine own messages
  /** Whether there are older messages to load (pagination) */
  hasMoreMessages?: boolean;
  /** Callback to load older messages */
  onLoadMoreMessages?: () => Promise<void>;
  /** Whether older messages are currently loading */
  isLoadingMore?: boolean;
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
  isLoadingMore = false
}: ChatConversationViewProps) {
  const [inputValue, setInputValue] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [mentionedUsers, setMentionedUsers] = useState<MentionUser[]>([]);
  const [isSending, setIsSending] = useState(false);
  const isSendingRef = useRef(false); // ref-based guard for rapid clicks (sync, no batching delay)
  const [selectedMessageId, setSelectedMessageId] = useState<number | string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessageItem | null>(null);

  const authUser = useAuthStore((s) => s.user);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isLoadingMoreRef = useRef(false);
  const prevMessageCountRef = useRef(0);
  const prevHumanVisibleCountRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const isFirstLoadRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [agentWorking, setAgentWorking] = useState(false);

  // Keep ref in sync with prop
  isLoadingMoreRef.current = isLoadingMore;

  // Reset scroll state when conversation changes
  useEffect(() => {
    isFirstLoadRef.current = true;
    isNearBottomRef.current = true;
    prevMessageCountRef.current = 0;
    prevHumanVisibleCountRef.current = 0;
    setNewMessageCount(0);
    setAgentWorking(false);
    setShowScrollToBottom(false);
  }, [chat?.id]);

  // Track scroll position — show/hide scroll-to-bottom arrow
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      const wasNearBottom = isNearBottomRef.current;
      isNearBottomRef.current = distanceFromBottom <= CHAT_CONFIG.AUTO_SCROLL_THRESHOLD;
      // Show arrow when user is scrolled up beyond threshold
      setShowScrollToBottom(distanceFromBottom > CHAT_CONFIG.SCROLL_BUTTON_THRESHOLD);
      // Reset new message counter when user scrolls back to bottom
      if (!wasNearBottom && isNearBottomRef.current) {
        setNewMessageCount(0);
      }
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Helper: count only human-visible messages (user messages + final agent text responses)
  // Ticket #74080: tool_approval is user-actionable and should be counted as visible
  const countHumanVisible = useCallback((msgs: typeof messages) => {
    return msgs.filter(m => {
      // User messages are always visible
      if (m.role === 'user') return true;
      // Agent final text responses are visible
      if (m.role === 'assistant' && (!m.contentType || m.contentType === 'text')) return true;
      // Tool approval messages require user action — count as visible
      if (m.contentType === 'tool_approval') return true;
      // System messages are visible
      if (m.role === 'system') return true;
      // tool_call, tool_result, thinking — NOT counted for badge
      return false;
    }).length;
  }, []);

  // Scroll to bottom on new messages (only if user is near bottom)
  useEffect(() => {
    if (messages.length === 0) return;

    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;

    // First load — scroll instantly to bottom
    if (isFirstLoadRef.current) {
      isFirstLoadRef.current = false;
      prevHumanVisibleCountRef.current = countHumanVisible(messages);
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
        isNearBottomRef.current = true;
      }, 50);
      return;
    }

    const totalNewCount = messages.length - prevCount;
    if (totalNewCount <= 0) return;

    // Count only human-visible new messages for the badge
    const currentHumanVisible = countHumanVisible(messages);
    const newHumanVisible = currentHumanVisible - prevHumanVisibleCountRef.current;
    prevHumanVisibleCountRef.current = currentHumanVisible;

    // Detect if agent is actively working (new messages are tool_call/thinking, not final text)
    const hasAgentInternalMessages = totalNewCount > 0 && newHumanVisible === 0;
    setAgentWorking(hasAgentInternalMessages);

    // Bug fix: Double-check scroll position from DOM directly (not just ref).
    // The ref might be stale if scroll events haven't fired yet after DOM update.
    // This prevents auto-scroll from pulling user back to bottom when reading old messages.
    const container = messagesContainerRef.current;
    if (container) {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distanceFromBottom > CHAT_CONFIG.AUTO_SCROLL_THRESHOLD) {
        isNearBottomRef.current = false;
      }
    }

    if (!isNearBottomRef.current) {
      // User is scrolled up — don't auto-scroll, only count human-visible messages
      if (newHumanVisible > 0) {
        setNewMessageCount(prev => prev + newHumanVisible);
      }
      return;
    }

    // User is near the bottom — smooth scroll only on human-visible new messages
    // Don't scroll for tool_call/tool_result/thinking to avoid jumping during agent processing
    if (newHumanVisible > 0) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' as ScrollBehavior });
      }, 50);
    }
  }, [messages, countHumanVisible]);

  // Infinite scroll: IntersectionObserver on sentinel for loading older messages
  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const container = messagesContainerRef.current;
    if (!sentinel || !container || !onLoadMoreMessages) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && !isLoadingMoreRef.current && hasMoreMessages) {
          // Save scroll position before prepending messages
          const prevScrollHeight = container.scrollHeight;
          const prevScrollTop = container.scrollTop;

          Promise.resolve(onLoadMoreMessages()).finally(() => {
            // Restore scroll position after older messages are prepended
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                const newScrollHeight = container.scrollHeight;
                const addedHeight = newScrollHeight - prevScrollHeight;
                container.scrollTop = prevScrollTop + addedHeight;
              });
            });
          });
        }
      },
      {
        root: container,
        rootMargin: '600px 0px 0px 0px', // Pre-trigger 600px before reaching top
        threshold: 0,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreMessages, onLoadMoreMessages, messages.length > 0]);

  // Handle checkbox toggle in markdown message:
  // 1. Update the message content in DB (PATCH)
  // 2. Send a system message notifying about the change
  const handleCheckboxToggleInMessage = useCallback(async (
    messageId: number | string,
    originalContent: string,
    checkboxIndex: number
  ) => {
    // Toggle checkbox in content
    const normalized = normalizeCheckboxes(originalContent);
    const toggled = toggleCheckboxByIndex(normalized, checkboxIndex);
    const newContent = denormalizeCheckboxes(toggled, originalContent);
    const context = getCheckboxContext(normalized, checkboxIndex);

    // Determine new state (after toggle)
    const lines = normalized.split('\n');
    let currentIdx = 0;
    let wasChecked = false;
    for (const line of lines) {
      const match = line.match(/^\s*[-*+]\s+\[([ xX])\]/);
      if (match) {
        if (currentIdx === checkboxIndex) {
          wasChecked = match[1] !== ' ';
          break;
        }
        currentIdx++;
      }
    }
    const isNowChecked = !wasChecked;

    // 1. Update message content in DB
    try {
      await apiClient.patch(`/chat/messages/${messageId}/content`, { content: newContent });
    } catch (e) {
      console.error('Failed to update message content for checkbox toggle:', e);
      return; // Don't send system message if PATCH failed
    }

    // 2. Send system message about the checkbox change
    const prefix = context.heading ? `[${context.heading}] ` : '';
    const status = isNowChecked ? '✅' : '⬜';
    const userName = authUser?.name || 'User';
    const systemText = `${status} ${prefix}${isNowChecked ? 'Checked' : 'Unchecked'}: "${context.lineText}" — ${userName}`;

    try {
      await onSendMessage(systemText);
    } catch (e) {
      console.error('Failed to send checkbox system message:', e);
    }
  }, [authUser?.name, onSendMessage]);

  // Legacy: handle checkbox click info (append to input) — fallback
  const handleCheckboxClick = useCallback((info: CheckboxClickInfo) => {
    const prefix = info.heading ? `[${info.heading}] ` : '';
    const status = info.checked ? '[x]' : '[ ]';
    const userTag = info.user ? ` — ${info.user.name} (${info.user.id})` : '';
    const text = `${prefix}${status} ${info.lineText}${userTag}`;
    setInputValue(prev => prev ? `${prev}\n${text}` : text);
  }, []);

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();

    // ADR-116: Validate and wrap bare @mentions and /commands into structured tokens before sending
    let trimmedInput = inputValue.trim();
    trimmedInput = validateAndWrapMentions(trimmedInput, mentionUsers);
    trimmedInput = validateAndWrapCommands(trimmedInput, mentionAgents);
    if (!trimmedInput && attachments.length === 0) return;

    // Guard: prevent rapid double/triple-click sending (ref is synchronous, no React batching delay)
    if (isSendingRef.current) return;
    isSendingRef.current = true;

    const mentionsToSend = [...mentionedUsers];
    setIsSending(true);
    try {
      await onSendMessage(
        trimmedInput,
        attachments.length > 0 ? attachments : undefined,
        mentionsToSend.length > 0 ? mentionsToSend : undefined
      );
      setInputValue('');
      setAttachments([]);
      setMentionedUsers([]);
      setReplyTo(null);
    } finally {
      setIsSending(false);
      isSendingRef.current = false;
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
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

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (date: Date) => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.toDateString() === today.toDateString()) {
      return 'Сегодня';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Вчера';
    }
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return <ImageIcon className="w-4 h-4" />;
    if (type.includes('pdf') || type.includes('document')) return <FileText className="w-4 h-4" />;
    return <File className="w-4 h-4" />;
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Helper: render avatar based on sender info
  const renderSenderAvatar = (sender: ChatMessageItem['sender'] | undefined, fallbackIcon?: string) => {
    // 1. Sender has avatar image
    if (sender?.avatar) {
      return <img src={sender.avatar} className="w-full h-full rounded-full object-cover" alt={sender.name} />;
    }
    // 2. Agent sender — show agent icon/emoji or Bot icon
    if (sender?.type === 'agent') {
      return fallbackIcon
        ? <span className="text-sm">{fallbackIcon}</span>
        : <Bot className="w-4 h-4" />;
    }
    // 3. Human sender — show first letter of name or User icon
    if (sender?.name) {
      const initial = sender.name.charAt(0).toUpperCase();
      return <span className="text-xs font-semibold">{initial}</span>;
    }
    // 4. Fallback
    return fallbackIcon
      ? <span className="text-sm">{fallbackIcon}</span>
      : <User className="w-4 h-4" />;
  };

  // Helper: avatar background color based on sender type
  const getAvatarBg = (sender: ChatMessageItem['sender'] | undefined) => {
    if (sender?.type === 'agent') return 'bg-gradient-to-br from-purple-500 to-purple-600 text-white';
    return 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]';
  };

  // --- ADR-092: Group messages into turns, then by date ---
  const turns = useMemo(() => {
    return groupChatMessageItems(messages, {
      chatType: chat?.type ?? 'agent',
      currentUserId,
      isAgentProcessing: isTyping,
    });
  }, [messages, chat?.type, currentUserId, isTyping]);

  // Group turns by date for date separators
  const groupedTurns = useMemo(() => {
    const groups: Record<string, ChatMessageItemTurn[]> = {};
    for (const turn of turns) {
      const timestamp = turn.messages[0]?.timestamp;
      const dateKey = timestamp ? timestamp.toDateString() : new Date().toDateString();
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(turn);
    }
    return groups;
  }, [turns]);

  // Render chat status
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

  // Empty state when no chat selected
  if (!chat) {
    return (
      <div className={cn('flex flex-col h-full items-center justify-center bg-[var(--bg-secondary)]', className)}>
        <div className="text-center px-8">
          <div className="w-20 h-20 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center mx-auto mb-4">
            <Bot className="w-10 h-10 text-[var(--text-tertiary)]" />
          </div>
          <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">
            Выберите чат
          </h3>
          <p className="text-sm text-[var(--text-tertiary)]">
            Выберите чат из списка слева или создайте новый
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full bg-[var(--bg-secondary)]', className)}>
      {/* Header - Telegram style */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 bg-[var(--bg-primary)] border-b border-[var(--border-primary)]">
        {/* Back button (mobile) */}
        {onBack && (
          <button
            onClick={onBack}
            className="p-1.5 -ml-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors lg:hidden"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}

        {/* Avatar */}
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
              {chat.icon ? (
                <span className="text-lg">{chat.icon}</span>
              ) : chat.type === 'agent' ? (
                <Bot className="w-5 h-5" />
              ) : (
                <User className="w-5 h-5" />
              )}
            </div>
          )}
          {chat.status === 'online' && (
            <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-[var(--bg-primary)] rounded-full" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onOpenSettings}>
          <div className="flex items-center gap-2">
            <span className="font-medium text-[var(--text-primary)] truncate">{chat.title}</span>
            {chat.type === 'agent' && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
                AI
              </span>
            )}
          </div>
          <div className="text-xs">
            {renderStatus()}
          </div>
        </div>

        {/* Actions */}
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

      {/* Messages Area */}
      <div className="relative flex-1 min-h-0">
      <div ref={messagesContainerRef} className="absolute inset-0 overflow-y-auto px-4 py-2 space-y-1 overscroll-contain" style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--text-tertiary)]" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-sm text-[var(--text-tertiary)]">
              Начните диалог
            </p>
          </div>
        ) : (
          <>
          {/* Pagination sentinel — loads older messages when scrolled near top */}
          <div
            ref={loadMoreSentinelRef}
            className="flex justify-center"
            style={{ minHeight: hasMoreMessages ? 40 : 1 }}
          >
            {hasMoreMessages && isLoadingMore ? (
              <div className="inline-flex items-center gap-2 px-4 py-2 text-xs text-[var(--text-tertiary)]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Loading older messages...</span>
              </div>
            ) : hasMoreMessages ? (
              <div className="py-2 text-xs text-[var(--text-quaternary)]">
                ↑ Scroll up for older messages
              </div>
            ) : null}
          </div>

          {Object.entries(groupedTurns).map(([dateKey, dayTurns]) => (
            <div key={dateKey}>
              {/* Date separator */}
              <div className="flex justify-center my-4">
                <span className="px-3 py-1 text-xs text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] rounded-full">
                  {formatDate(new Date(dateKey))}
                </span>
              </div>

              {/* Turns */}
              {dayTurns.map((turn, turnIdx) => {
                const isOwn = turn.isOwn;
                const prevTurn = dayTurns[turnIdx - 1];
                const showAvatar = !isOwn && (turnIdx === 0 || prevTurn?.isOwn);

                // --- Agent turn with steps → render as unified AgentTurnBubble ---
                if (turn.turnType === 'agent' && turn.messages.length > 0) {
                  const hasSteps = turn.messages.some(m =>
                    m.contentType === 'thinking' ||
                    m.contentType === 'tool_call' ||
                    m.contentType === 'tool_result' ||
                    (m.toolResults && m.toolResults.length > 0)
                  );

                  if (hasSteps) {
                    // Multi-message agent turn → grouped bubble with reasoning chains
                    const lastMsg = turn.messages[turn.messages.length - 1];

                    return (
                      <div
                        key={turn.id}
                        className="flex gap-2 mb-1 flex-row"
                      >
                        {/* Avatar */}
                        <div className="flex-shrink-0 w-8 self-end">
                          {showAvatar && (
                            <div className={cn(
                              'w-8 h-8 rounded-full flex items-center justify-center',
                              getAvatarBg(turn.sender)
                            )}>
                              {renderSenderAvatar(turn.sender, chat.icon)}
                            </div>
                          )}
                        </div>

                        {/* Agent turn bubble */}
                        <div className="flex flex-col gap-0.5 max-w-[85%]">
                          {/* Agent sender name */}
                          {showAvatar && turn.sender?.name && (
                            <span className="text-[11px] font-medium text-purple-400 ml-1">
                              {turn.sender.name}
                            </span>
                          )}
                          <AgentTurnBubble
                            messages={turn.messages}
                            isProcessing={turn.isProcessing}
                            onCheckboxToggle={handleCheckboxToggleInMessage}
                            currentUser={authUser ? { name: authUser.name, id: Number(authUser.id) } : undefined}
                          />
                          {/* Timestamp */}
                          <span className="text-[10px] text-[var(--text-tertiary)] ml-1">
                            {formatTime(lastMsg.timestamp)}
                          </span>
                        </div>
                      </div>
                    );
                  }
                }

                // --- Simple messages: merge consecutive same-sender into ONE bubble ---
                {
                  const lastMessage = turn.messages[turn.messages.length - 1];
                  const hasEdited = turn.messages.some(m => m.isEdited);
                  const lastRead = turn.messages[turn.messages.length - 1]?.isRead;

                  return (
                    <div
                      key={turn.id}
                      className={cn(
                        'flex gap-2 mb-1',
                        isOwn ? 'flex-row-reverse' : 'flex-row'
                      )}
                    >
                      {/* Avatar — one per merged bubble, aligned to bottom */}
                      {!isOwn && (
                        <div className="flex-shrink-0 w-8 self-end">
                          {showAvatar && (
                            <div className={cn(
                              'w-8 h-8 rounded-full flex items-center justify-center',
                              getAvatarBg(turn.sender)
                            )}>
                              {renderSenderAvatar(turn.sender, turn.sender?.type === 'agent' ? chat.icon : undefined)}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Merged bubble — all messages inside one visual container */}
                      <div className="flex flex-col gap-0.5 max-w-[75%]">
                        {/* Sender name above bubble for non-own messages */}
                        {!isOwn && showAvatar && turn.sender?.name && (
                          <span className={cn(
                            'text-[11px] font-medium ml-1',
                            turn.sender.type === 'agent' ? 'text-purple-400' : 'text-[var(--text-secondary)]'
                          )}>
                            {turn.sender.name}
                          </span>
                        )}
                      <div
                        className={cn(
                          'relative px-3 py-2 rounded-2xl',
                          isOwn
                            ? 'bg-[var(--color-primary-500)] text-white rounded-br-md'
                            : 'bg-[var(--bg-primary)] text-[var(--text-primary)] rounded-bl-md shadow-sm'
                        )}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          // Find which message was right-clicked by traversing to the closest [data-msg-id]
                          const target = (e.target as HTMLElement).closest<HTMLElement>('[data-msg-id]');
                          const msgId = target?.dataset.msgId;
                          if (msgId) {
                            const numId = Number(msgId);
                            setSelectedMessageId(selectedMessageId === numId ? null : numId);
                          } else {
                            // Fallback: toggle last message context menu
                            setSelectedMessageId(selectedMessageId === lastMessage.id ? null : lastMessage.id);
                          }
                        }}
                      >
                        {/* Render each message content inside the merged bubble */}
                        <div className="space-y-1">
                          {turn.messages.map((message, msgIdx) => (
                            <div key={message.id} data-msg-id={message.id}>
                              {/* Reply indicator (only shown if message has a reply) */}
                              {message.replyTo && (
                                <div className={cn(
                                  'text-xs mb-1 pb-1 border-l-2 pl-2',
                                  isOwn
                                    ? 'border-white/50 text-white/70'
                                    : 'border-[var(--color-primary-500)] text-[var(--text-secondary)]'
                                )}>
                                  <span className="font-medium">{message.replyTo.sender}</span>
                                  <p className="truncate">{message.replyTo.content}</p>
                                </div>
                              )}

                              {/* Message content */}
                              <div className={cn(
                                'text-sm whitespace-pre-wrap break-words',
                                isOwn ? '' : 'prose prose-sm dark:prose-invert max-w-none'
                              )}>
                                {isOwn ? (
                                  <HighlightedText
                                    text={message.content}
                                    onMentionClick={(token) => setInputValue(prev => prev ? `${prev} ${token} ` : `${token} `)}
                                  />
                                ) : (
                                  <MarkdownPreview
                                    content={message.content}
                                    onCheckboxClick={(info) => {
                                      // Auto-send: toggle checkbox in message + send system notification
                                      handleCheckboxToggleInMessage(message.id, message.content, info.index);
                                    }}
                                    currentUser={authUser ? { name: authUser.name, id: Number(authUser.id) } : undefined}
                                  />
                                )}
                              </div>

                              {/* Attachments — rich preview with FilePreviewModal */}
                              {message.attachments && message.attachments.length > 0 && (
                                <ChatAttachmentRenderer
                                  attachments={message.attachments.map(att => ({
                                    id: att.id,
                                    name: att.name,
                                    type: att.type,
                                    size: att.size ?? 0,
                                    url: att.url,
                                  }))}
                                  className="mt-1"
                                />
                              )}

                              {/* Per-message context menu */}
                              {selectedMessageId === message.id && (
                                <div
                                  className={cn(
                                    'absolute z-10 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg py-1 min-w-[140px]',
                                    isOwn ? 'right-0 top-full mt-1' : 'left-0 top-full mt-1'
                                  )}
                                  onClick={e => e.stopPropagation()}
                                >
                                  <button
                                    onClick={() => {
                                      setReplyTo(message);
                                      setSelectedMessageId(null);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                                  >
                                    <Reply className="w-4 h-4" />
                                    Ответить
                                  </button>
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(message.content);
                                      setSelectedMessageId(null);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                                  >
                                    <Copy className="w-4 h-4" />
                                    Копировать
                                  </button>
                                  {isOwn && onEditMessage && (
                                    <button
                                      onClick={() => {
                                        setSelectedMessageId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                                    >
                                      <Edit3 className="w-4 h-4" />
                                      Изменить
                                    </button>
                                  )}
                                  {onDeleteMessage && (
                                    <button
                                      onClick={() => {
                                        onDeleteMessage(message.id);
                                        setSelectedMessageId(null);
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

                        {/* Single timestamp + status at bottom of merged bubble */}
                        <div className={cn(
                          'flex items-center justify-end gap-1 mt-1',
                          isOwn ? 'text-white/60' : 'text-[var(--text-tertiary)]'
                        )}>
                          {hasEdited && (
                            <span className="text-[10px]">изменено</span>
                          )}
                          <span className="text-[10px]">{formatTime(lastMessage.timestamp)}</span>
                          {isOwn && (
                            lastRead ? (
                              <CheckCheck className="w-3.5 h-3.5" />
                            ) : (
                              <Check className="w-3.5 h-3.5" />
                            )
                          )}
                        </div>
                      </div>
                      </div>{/* Close sender name wrapper */}
                    </div>
                  );
                }
              })}
            </div>
          ))}
          </>
        )}

        {/* Typing indicator */}
        {isTyping && (
          <div className="flex gap-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center text-white">
              {chat.icon || <Bot className="w-4 h-4" />}
            </div>
            <div className="flex flex-col gap-0.5">
              {typingAgentName && (
                <span className="text-[11px] font-medium text-purple-400 ml-1">
                  {typingAgentName}
                </span>
              )}
              <div className="px-4 py-3 bg-[var(--bg-primary)] rounded-2xl rounded-bl-md shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-[var(--text-tertiary)] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-[var(--text-tertiary)] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-[var(--text-tertiary)] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-xs text-[var(--text-tertiary)]">
                    {typingAgentName ? `${typingAgentName} думает...` : 'AI думает...'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Scroll-to-bottom arrow with new message count + agent working indicator */}
      {showScrollToBottom && (
        <div className="absolute bottom-4 right-4 z-20 flex flex-col items-end gap-1.5">
          {/* Agent working indicator — shown when agent is processing (tool calls/thinking) */}
          {agentWorking && newMessageCount === 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--bg-primary)] border border-[var(--border-primary)] shadow-lg text-[var(--text-secondary)] text-[11px]">
              <Loader2 className="w-3 h-3 animate-spin text-[var(--color-primary-500)]" />
              <span>Agent working…</span>
            </div>
          )}
          <button
            onClick={() => {
              messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
              setShowScrollToBottom(false);
              setNewMessageCount(0);
              setAgentWorking(false);
            }}
            className="w-9 h-9 rounded-full bg-[var(--bg-primary)] border border-[var(--border-primary)] shadow-lg flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-all"
            title={newMessageCount > 0 ? `${newMessageCount} new message${newMessageCount > 1 ? 's' : ''}` : 'Scroll to bottom'}
          >
            <ArrowDown className="w-4 h-4" />
            {newMessageCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--color-primary-500)] text-white text-[10px] font-bold flex items-center justify-center leading-none">
                {newMessageCount > 99 ? '99+' : newMessageCount}
              </span>
            )}
          </button>
        </div>
      )}
      </div>

      {/* Reply preview */}
      {replyTo && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-[var(--bg-tertiary)] border-t border-[var(--border-secondary)]">
          <Reply className="w-4 h-4 text-[var(--color-primary-500)]" />
          <div className="flex-1 min-w-0 border-l-2 border-[var(--color-primary-500)] pl-2">
            <div className="text-xs font-medium text-[var(--color-primary-500)]">
              {replyTo.sender?.name || (replyTo.role === 'user' ? 'Вы' : chat.title)}
            </div>
            <div className="text-xs text-[var(--text-secondary)] truncate">
              {replyTo.content}
            </div>
          </div>
          <button
            onClick={() => setReplyTo(null)}
            className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="flex-shrink-0 flex gap-2 px-4 py-2 bg-[var(--bg-tertiary)] border-t border-[var(--border-secondary)] overflow-x-auto">
          {attachments.map((file, index) => (
            <div
              key={index}
              className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-primary)] rounded-lg flex-shrink-0"
            >
              {getFileIcon(file.type)}
              <span className="text-xs text-[var(--text-primary)] max-w-[100px] truncate">
                {file.name}
              </span>
              <button
                onClick={() => removeAttachment(index)}
                className="p-0.5 rounded text-[var(--text-tertiary)] hover:text-red-500"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input Area - Telegram style */}
      <div
        className="flex-shrink-0 px-4 py-3 bg-[var(--bg-primary)] border-t border-[var(--border-primary)]"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
      >
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          {/* Attach button */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
            accept="image/*,.pdf,.txt,.md,.json,.csv,.doc,.docx,.xls,.xlsx"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors flex-shrink-0"
            title="Прикрепить файл"
          >
            <Paperclip className="w-5 h-5" />
          </button>

          {/* Input */}
          <div className="flex-1 min-w-0">
            <MentionInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              onMention={(user) => {
                // ADR-024: Collect mentioned users for subagent invocation
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

          {/* Send button */}
          <button
            type="submit"
            disabled={isSending || (!inputValue.trim() && attachments.length === 0)}
            className={cn(
              'p-2 rounded-full transition-colors flex-shrink-0',
              inputValue.trim() || attachments.length > 0
                ? 'bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)]'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]'
            )}
            title="Отправить"
          >
            {isSending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
