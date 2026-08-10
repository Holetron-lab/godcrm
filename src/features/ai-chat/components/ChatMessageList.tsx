/**
 * ChatMessageList Component
 * Extracted from ChatConversationView (ADR-024)
 *
 * Renders the scrollable message list with:
 * - Date separators
 * - Agent turn bubbles (with reasoning chains)
 * - User/simple message bubbles
 * - Forwarded message rendering
 * - Typing indicator
 * - Scroll-to-bottom button
 * - Infinite scroll pagination
 */

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import {
  Bot,
  User,
  Check,
  CheckCheck,
  Loader2,
  ArrowDown,
  CornerDownLeft,
  Pin,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import { HighlightedText } from './HighlightedText';
import { groupChatMessageItems, type ChatMessageItemTurn } from '../utils/groupChatMessageItems';
import { AgentTurnBubble } from './AgentTurnBubble';
import { ChatAttachmentRenderer } from './AIChatPanel/components/ChatMessages/ChatAttachmentRenderer';
import { parseForwardedMessages } from '../utils/parseForwardedMessage';
import { CHAT_CONFIG } from '../constants/chatConfig';
import { ForwardedMessageBlock } from './ChatForwardedBlock';
import { useQuoteMode } from '../hooks/useQuoteMode';
import { ChatMessageContextMenu, ChatQuoteConfirmStrip } from './ChatMessageActions';
import type { ChatMessageItem, ChatInfo } from './ChatConversationView';

export interface ChatMessageListProps {
  chat: ChatInfo;
  messages: ChatMessageItem[];
  isLoading: boolean;
  isTyping: boolean;
  typingAgentName?: string | null;
  currentUserId?: number;
  hasMoreMessages: boolean;
  onLoadMoreMessages?: () => Promise<void>;
  isLoadingMore: boolean;
  onDeleteMessage?: (messageId: number | string) => void;
  onEditMessage?: (messageId: number | string, newContent: string) => void;
  onReply: (message: ChatMessageItem, quote?: { fragment: string; range?: [number, number] }) => void;
  onForward?: (message: ChatMessageItem) => void;
  // ADR-0068 WP-E — supplied by the host layout (TelegramChatLayout / AIChatPanel)
  // after applying the visibility gate (group/agent participant OR DM owner).
  // When omitted, the ⋮-menu silently drops Pin/Unpin.
  onPin?: (messageId: number | string) => void;
  onUnpin?: (messageId: number | string) => void;
  setInputValue: (fn: (prev: string) => string) => void;
  authUser?: { name: string; id: number } | null;
  currentConversationId?: number | string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(date: Date) {
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(date: Date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Сегодня';
  if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function renderSenderAvatar(sender: ChatMessageItem['sender'] | undefined, fallbackIcon?: string) {
  if (sender?.avatar) {
    return <img src={sender.avatar} className="w-full h-full rounded-full object-cover" alt={sender.name} />;
  }
  if (sender?.type === 'agent') {
    return fallbackIcon ? <span className="text-sm">{fallbackIcon}</span> : <Bot className="w-4 h-4" />;
  }
  if (sender?.name) {
    return <span className="text-xs font-semibold">{sender.name.charAt(0).toUpperCase()}</span>;
  }
  return fallbackIcon ? <span className="text-sm">{fallbackIcon}</span> : <User className="w-4 h-4" />;
}

function getAvatarBg(sender: ChatMessageItem['sender'] | undefined) {
  if (sender?.type === 'agent') return 'bg-gradient-to-br from-purple-500 to-purple-600 text-white';
  return 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]';
}

// ── Main Component ───────────────────────────────────────────────────────────

export function ChatMessageList({
  chat,
  messages,
  isLoading,
  isTyping,
  typingAgentName,
  currentUserId,
  hasMoreMessages,
  onLoadMoreMessages,
  isLoadingMore,
  onDeleteMessage,
  onEditMessage,
  onReply,
  onForward,
  onPin,
  onUnpin,
  setInputValue,
  authUser,
  currentConversationId,
}: ChatMessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const isLoadingMoreRef = useRef(false);
  const prevMessageCountRef = useRef(0);
  const prevHumanVisibleCountRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const isFirstLoadRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [agentWorking, setAgentWorking] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState<number | string | null>(null);
  const [returnAnchor, setReturnAnchor] = useState<number | null>(null);
  // Window during which scroll events are treated as programmatic; one-shot bool misses smooth-scroll's tail events.
  const programmaticUntilRef = useRef(0);
  const quoteMode = useQuoteMode({ onReply, resetKey: chat.id });

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
    setReturnAnchor(null);
  }, [chat.id]);

  // Paginates up to 5 pages upward if the target isn't yet in the DOM, then flashes and captures the return anchor.
  const scrollToMessage = useCallback(async (messageId: number | string, opts: { highlight?: boolean; behavior?: ScrollBehavior } = {}) => {
    const { highlight = true, behavior = 'smooth' } = opts;
    const container = messagesContainerRef.current;
    if (!container) return;
    const findEl = () => container.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(String(messageId))}"]`);
    let el = findEl();
    if (!el && onLoadMoreMessages) {
      for (let i = 0; i < 5; i++) {
        if (!hasMoreMessages) break;
        const prevScrollHeight = container.scrollHeight;
        const prevScrollTop = container.scrollTop;
        await Promise.resolve(onLoadMoreMessages());
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        container.scrollTop = prevScrollTop + (container.scrollHeight - prevScrollHeight);
        el = findEl();
        if (el) break;
      }
    }
    if (!el) return;
    const prevScrollTop = container.scrollTop;
    // Predict post-scroll position from layout (smooth-scroll is async) so we can decide whether to offer Return.
    const containerRect = container.getBoundingClientRect();
    const elTopWithinContainer = el.getBoundingClientRect().top - containerRect.top + container.scrollTop;
    const targetScrollTop = Math.max(0, Math.min(container.scrollHeight - container.clientHeight, elTopWithinContainer - (container.clientHeight - el.clientHeight) / 2));
    programmaticUntilRef.current = Date.now() + 800;
    el.scrollIntoView({ block: 'center', behavior });
    if (Math.abs(prevScrollTop - targetScrollTop) > container.clientHeight * 0.5) setReturnAnchor(prevScrollTop);
    if (highlight) {
      el.setAttribute('data-flash', '1');
      window.setTimeout(() => { el?.removeAttribute('data-flash'); }, 1500);
    }
  }, [hasMoreMessages, onLoadMoreMessages]);

  const handleReturnToAnchor = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container || returnAnchor === null) return;
    programmaticUntilRef.current = Date.now() + 800;
    container.scrollTo({ top: returnAnchor, behavior: 'smooth' });
    setReturnAnchor(null);
  }, [returnAnchor]);

  // Same-chat navigate-to-chat-message → rich in-list scroll. Cross-chat hops stay with the host layout handler.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.chatId || !detail?.messageId) return;
      const sameChat = currentConversationId && String(detail.chatId) === String(currentConversationId);
      if (!sameChat) return;
      scrollToMessage(detail.messageId, { highlight: true });
    };
    window.addEventListener('navigate-to-chat-message', handler);
    return () => window.removeEventListener('navigate-to-chat-message', handler);
  }, [currentConversationId, scrollToMessage]);

  // Track scroll position
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      const wasNearBottom = isNearBottomRef.current;
      isNearBottomRef.current = distanceFromBottom <= CHAT_CONFIG.AUTO_SCROLL_THRESHOLD;
      setShowScrollToBottom(distanceFromBottom > CHAT_CONFIG.SCROLL_BUTTON_THRESHOLD);
      if (!wasNearBottom && isNearBottomRef.current) {
        setNewMessageCount(0);
      }
      // User-initiated scroll cancels the Return anchor.
      // Programmatic scrolls (within the ~800ms window) must NOT clear it.
      if (Date.now() >= programmaticUntilRef.current && returnAnchor !== null) {
        setReturnAnchor(null);
      }
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [returnAnchor]);

  const countHumanVisible = useCallback((msgs: typeof messages) => {
    return msgs.filter(m => {
      if (m.role === 'user') return true;
      if (m.role === 'assistant' && (!m.contentType || m.contentType === 'text')) return true;
      if (m.contentType === 'tool_approval') return true;
      if (m.role === 'system') return true;
      return false;
    }).length;
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length === 0) return;
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;

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

    const currentHumanVisible = countHumanVisible(messages);
    const newHumanVisible = currentHumanVisible - prevHumanVisibleCountRef.current;
    prevHumanVisibleCountRef.current = currentHumanVisible;

    const hasAgentInternalMessages = totalNewCount > 0 && newHumanVisible === 0;
    setAgentWorking(hasAgentInternalMessages);

    const container = messagesContainerRef.current;
    if (container) {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distanceFromBottom > CHAT_CONFIG.AUTO_SCROLL_THRESHOLD) {
        isNearBottomRef.current = false;
      }
    }

    if (!isNearBottomRef.current) {
      if (newHumanVisible > 0) {
        setNewMessageCount(prev => prev + newHumanVisible);
      }
      return;
    }

    if (newHumanVisible > 0) {
      setTimeout(() => {
        programmaticUntilRef.current = Date.now() + 800;
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' as ScrollBehavior });
      }, 50);
      setReturnAnchor(null);
    }
  }, [messages, countHumanVisible]);

  // Infinite scroll sentinel
  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const container = messagesContainerRef.current;
    if (!sentinel || !container || !onLoadMoreMessages) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && !isLoadingMoreRef.current && hasMoreMessages) {
          const prevScrollHeight = container.scrollHeight;
          const prevScrollTop = container.scrollTop;
          Promise.resolve(onLoadMoreMessages()).finally(() => {
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
      { root: container, rootMargin: '600px 0px 0px 0px', threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreMessages, onLoadMoreMessages, messages.length > 0]);

  // Checkbox toggle in message
  const handleCheckboxToggleInMessage = useCallback(async (
    messageId: number | string,
    originalContent: string,
    checkboxIndex: number
  ) => {
    const { normalizeCheckboxes, toggleCheckboxByIndex, denormalizeCheckboxes, getCheckboxContext } = await import('@/shared/utils/markdownCheckbox');
    const { apiClient } = await import('@/shared/utils/apiClient');

    const normalized = normalizeCheckboxes(originalContent);
    const toggled = toggleCheckboxByIndex(normalized, checkboxIndex);
    const newContent = denormalizeCheckboxes(toggled, originalContent);
    const context = getCheckboxContext(normalized, checkboxIndex);

    const lines = normalized.split('\n');
    let currentIdx = 0;
    let wasChecked = false;
    for (const line of lines) {
      const match = line.match(/^\s*[-*+]\s+\[([ xX])\]/);
      if (match) {
        if (currentIdx === checkboxIndex) { wasChecked = match[1] !== ' '; break; }
        currentIdx++;
      }
    }

    try {
      await apiClient.patch(`/chat/messages/${messageId}/content`, { content: newContent });
    } catch (e) {
      console.error('Failed to update message content for checkbox toggle:', e);
    }
  }, []);

  // Group messages into turns
  const turns = useMemo(() => {
    return groupChatMessageItems(messages, {
      chatType: chat.type,
      currentUserId,
      isAgentProcessing: isTyping,
    });
  }, [messages, chat.type, currentUserId, isTyping]);

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

  // ── Render message content (with forwarded message detection) ──────────────
  const renderMessageContent = (message: ChatMessageItem, isOwn: boolean) => {
    // Parse forwarded messages (both blockquote and legacy formats)
    const forwarded = parseForwardedMessages(message.content);

    if (forwarded.length > 0) {
      // Extract remaining user text after the forwarded blocks
      // The forwarded blocks are at the start (blockquote lines), user text follows
      const lines = message.content.split('\n');
      let lastQuoteLine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('>') || lines[i].trim() === '') {
          lastQuoteLine = i;
        } else if (lastQuoteLine >= 0) break;
      }
      const userText = lastQuoteLine >= 0 ? lines.slice(lastQuoteLine + 1).join('\n').trim() : '';

      return (
        <div className="space-y-1">
          {forwarded.map((fw, i) => (
            <ForwardedMessageBlock
              key={i}
              senderName={fw.senderName}
              timestamp={fw.timestamp}
              content={fw.content}
              chatId={fw.conversationId || undefined}
              messageId={fw.messageId || undefined}
              agentColor={fw.agentColor || undefined}
              currentConversationId={currentConversationId}
              onJumpInSameChat={scrollToMessage}
            />
          ))}
          {userText && (
            <div className={cn(
              'text-sm whitespace-pre-wrap break-words mt-2',
              isOwn ? '' : 'prose prose-sm dark:prose-invert max-w-none'
            )}>
              {isOwn ? (
                <HighlightedText
                  text={userText}
                  onMentionClick={(token) => setInputValue(prev => prev ? `${prev} ${token} ` : `${token} `)}
                />
              ) : (
                <MarkdownPreview content={userText} />
              )}
            </div>
          )}
        </div>
      );
    }

    // Regular message rendering
    return (
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
              handleCheckboxToggleInMessage(message.id, message.content, info.index);
            }}
            currentUser={authUser ? { name: authUser.name, id: authUser.id } : undefined}
          />
        )}
      </div>
    );
  };

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={messagesContainerRef}
        className="absolute inset-0 overflow-y-auto px-4 py-2 space-y-1 overscroll-contain"
        style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--text-tertiary)]" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-sm text-[var(--text-tertiary)]">Начните диалог</p>
          </div>
        ) : (
          <>
            {/* Pagination sentinel */}
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
                <div className="py-2 text-xs text-[var(--text-quaternary)]">↑ Scroll up for older messages</div>
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

                  // --- Agent turn with steps ---
                  if (turn.turnType === 'agent' && turn.messages.length > 0) {
                    const hasSteps = turn.messages.some(m =>
                      m.contentType === 'thinking' ||
                      m.contentType === 'tool_call' ||
                      m.contentType === 'tool_result' ||
                      (m.toolResults && m.toolResults.length > 0)
                    );

                    if (hasSteps) {
                      const lastMsg = turn.messages[turn.messages.length - 1];
                      return (
                        <div key={turn.id} className="flex gap-2 mb-1 flex-row">
                          <div className="flex-shrink-0 w-8 self-end">
                            {showAvatar && (
                              <div className={cn('w-8 h-8 rounded-full flex items-center justify-center', getAvatarBg(turn.sender))}>
                                {renderSenderAvatar(turn.sender, chat.icon)}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col gap-0.5 max-w-[85%]">
                            {showAvatar && turn.sender?.name && (
                              <span className="text-[11px] font-medium text-purple-400 ml-1">{turn.sender.name}</span>
                            )}
                            <AgentTurnBubble
                              messages={turn.messages}
                              isProcessing={turn.isProcessing}
                              onCheckboxToggle={handleCheckboxToggleInMessage}
                              currentUser={authUser ? { name: authUser.name, id: authUser.id } : undefined}
                            />
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
                        className={cn('flex gap-2 mb-1', isOwn ? 'flex-row-reverse' : 'flex-row')}
                      >
                        {!isOwn && (
                          <div className="flex-shrink-0 w-8 self-end">
                            {showAvatar && (
                              <div className={cn('w-8 h-8 rounded-full flex items-center justify-center', getAvatarBg(turn.sender))}>
                                {renderSenderAvatar(turn.sender, turn.sender?.type === 'agent' ? chat.icon : undefined)}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="flex flex-col gap-0.5 max-w-[75%]">
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
                              const target = (e.target as HTMLElement).closest<HTMLElement>('[data-msg-id]');
                              const msgId = target?.dataset.msgId;
                              if (msgId) {
                                const numId = Number(msgId);
                                setSelectedMessageId(selectedMessageId === numId ? null : numId);
                              } else {
                                setSelectedMessageId(selectedMessageId === lastMessage.id ? null : lastMessage.id);
                              }
                            }}
                          >
                            <div className="space-y-1">
                              {turn.messages.map((message, msgIdx) => (
                                <div
                                  key={message.id}
                                  data-msg-id={message.id}
                                  className={cn(
                                    message.pinned_at && 'pl-1.5 border-l-2',
                                    message.pinned_at && (isOwn ? 'border-white/40' : 'border-[var(--color-primary-500)]'),
                                  )}
                                >
                                  {message.pinned_at && (
                                    <div
                                      className={cn(
                                        'inline-flex items-center gap-1 text-[10px] mb-0.5 opacity-80',
                                        isOwn ? 'text-white/80' : 'text-[var(--color-primary-500)]',
                                      )}
                                    >
                                      <Pin className="w-3 h-3" /> Закреплено
                                    </div>
                                  )}
                                  {message.replyTo && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (message.replyTo) scrollToMessage(message.replyTo.message_id, { highlight: true });
                                      }}
                                      className={cn(
                                        'block w-full text-left text-xs mb-1 pb-1 border-l-2 pl-2 cursor-pointer transition-opacity hover:opacity-80',
                                        isOwn ? 'border-white/50 text-white/70' : 'border-[var(--color-primary-500)] text-[var(--text-secondary)]'
                                      )}
                                    >
                                      <span className="font-medium">{message.replyTo.sender}</span>
                                      <p className="truncate">
                                        {message.replyTo.fragment ? `«${message.replyTo.fragment}»` : message.replyTo.content}
                                      </p>
                                    </button>
                                  )}

                                  {/* Message content (with forwarded detection) */}
                                  {renderMessageContent(message, isOwn)}

                                  {quoteMode.quoteFor?.id === message.id && (
                                    <ChatQuoteConfirmStrip
                                      isOwn={isOwn}
                                      fragment={quoteMode.quoteFragment}
                                      onConfirm={quoteMode.handleQuoteConfirm}
                                      onCancel={() => quoteMode.setQuoteFor(null)}
                                    />
                                  )}

                                  {/* Attachments */}
                                  {message.attachments && message.attachments.length > 0 && (
                                    <ChatAttachmentRenderer
                                      attachments={message.attachments.map(att => ({
                                        id: att.id, name: att.name, type: att.type,
                                        size: att.size ?? 0, url: att.url,
                                      }))}
                                      className="mt-1"
                                    />
                                  )}

                                  {/* Divider between merged user messages */}
                                  {msgIdx < turn.messages.length - 1 && isOwn && (
                                    <div className="group relative flex justify-end my-0.5">
                                      <div className="w-1/3 h-px bg-white/10 group-hover:bg-white/20 transition-colors" />
                                      <span className="absolute -bottom-3 right-0 text-[9px] text-white/0 group-hover:text-white/40 transition-colors pointer-events-none">
                                        {formatTime(message.timestamp)}
                                      </span>
                                    </div>
                                  )}

                                  {selectedMessageId === message.id && (
                                    <ChatMessageContextMenu
                                      message={message}
                                      turn={turn}
                                      isOwn={isOwn}
                                      onReply={(m) => onReply(m)}
                                      onQuote={(m) => quoteMode.setQuoteFor(m)}
                                      onForward={onForward}
                                      onEdit={onEditMessage}
                                      onDelete={onDeleteMessage}
                                      onPin={onPin}
                                      onUnpin={onUnpin}
                                      onClose={() => setSelectedMessageId(null)}
                                    />
                                  )}
                                </div>
                              ))}
                            </div>

                            {/* Timestamp + status */}
                            <div className={cn(
                              'flex items-center justify-end gap-1 mt-1',
                              isOwn ? 'text-white/60' : 'text-[var(--text-tertiary)]'
                            )}>
                              {hasEdited && <span className="text-[10px]">изменено</span>}
                              <span className="text-[10px]">{formatTime(lastMessage.timestamp)}</span>
                              {isOwn && (
                                lastRead ? <CheckCheck className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />
                              )}
                            </div>
                          </div>
                        </div>
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
                <span className="text-[11px] font-medium text-purple-400 ml-1">{typingAgentName}</span>
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

      {returnAnchor !== null && (
        <button type="button" onClick={handleReturnToAnchor} title="Вернуться обратно" className="absolute top-3 right-3 z-20 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-[var(--bg-primary)] border border-[var(--border-primary)] shadow-lg text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-all">
          <CornerDownLeft className="w-3.5 h-3.5" /><span>Вернуться</span>
        </button>
      )}

      {(showScrollToBottom || returnAnchor !== null) && (
        <div className="absolute bottom-4 right-4 z-20 flex flex-col items-end gap-1.5">
          {agentWorking && newMessageCount === 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--bg-primary)] border border-[var(--border-primary)] shadow-lg text-[var(--text-secondary)] text-[11px]">
              <Loader2 className="w-3 h-3 animate-spin text-[var(--color-primary-500)]" />
              <span>Agent working…</span>
            </div>
          )}
          {returnAnchor !== null && (
            <button
              type="button"
              onClick={handleReturnToAnchor}
              className="w-9 h-9 rounded-full bg-[var(--bg-primary)] border border-[var(--border-primary)] shadow-lg flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-all"
              title="Return ↩"
              aria-label="Return to previous position"
            >
              <CornerDownLeft className="w-4 h-4" />
            </button>
          )}
          {showScrollToBottom && (
            <button
              type="button"
              onClick={() => {
                programmaticUntilRef.current = Date.now() + 800;
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                setShowScrollToBottom(false);
                setNewMessageCount(0);
                setAgentWorking(false);
                setReturnAnchor(null);
              }}
              className="relative w-9 h-9 rounded-full bg-[var(--bg-primary)] border border-[var(--border-primary)] shadow-lg flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-all"
              title={newMessageCount > 0 ? `${newMessageCount} new message${newMessageCount > 1 ? 's' : ''}` : 'Scroll to bottom'}
            >
              <ArrowDown className="w-4 h-4" />
              {newMessageCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--color-primary-500)] text-white text-[10px] font-bold flex items-center justify-center leading-none">
                  {newMessageCount > 99 ? '99+' : newMessageCount}
                </span>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
