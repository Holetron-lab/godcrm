// chatNotificationOrchestrator.tsx — ADR-0064 WP-B.
//
// App-level invisible component that fans `/chat/unread-summary` deltas out
// to the sound + toast + badge surfaces. Mounted once next to FloatingChatButton.
//
// Detection model (the codebase uses polling, not sockets — see
// useConversationMessages.ts ADR-078):
//
//   1. Poll `/chat/unread-summary` every 8s while the user is logged in.
//   2. Maintain a ref of the previous per-conversation unread counts.
//   3. On each successful fetch, for every conversation where the count
//      went UP, fetch the corresponding number of newest messages and run
//      the fan-out (sound / toast / unread-badge-cache invalidation).
//   4. Skip fan-out for the currently-active conversation when the window
//      is focused — the user is already reading.
//
// Prefs are pulled from `/chat/notification-prefs/resolved?conversation_id=…`
// and cached in-memory for 60s (matches the backend cache TTL).

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAIChat } from '@/features/ai-chat';
import { apiClient } from '@/shared/utils/apiClient';
import { showChatToast, setChatToastClickHandler } from '@/shared/hooks/useToast';
import {
  playNotificationSound,
  type NotificationSoundKind,
} from '@/shared/services/notificationSoundService';
import {
  useChatUnreadSummary,
  CHAT_UNREAD_SUMMARY_QUERY_KEY,
} from '@/shared/hooks/useChatUnreadSummary';
import { logger } from '@/shared/utils/logger';

const ORCHESTRATOR_POLL_MS = 8_000;
const PREFS_TTL_MS = 60_000;
const MESSAGE_PREVIEW_MAX = 140;

// Non-final step messages — tool calls, thinking, status pings, plans, moved
// stubs, row-mutation events. The backend's unread counter already excludes
// these (conversationSummaryController.js L143), but `/messages?limit=N` does
// not, so we filter again on the client before sounding/popping. This keeps
// fan-out aligned with the "only final agent text triggers notifications"
// contract from ADR-0064.
const SUPPRESSED_CONTENT_TYPES = new Set([
  'thinking',
  'tool_call',
  'tool_result',
  'tool_approval',
  'agent_status',
  'plan',
  'moved',
  'row_mutation',
]);

interface ResolvedPrefs {
  enabled: boolean;
  sound_enabled: boolean;
  sound_volume: number;
  humans: { sound: boolean; popup: boolean; badge: boolean };
  agents: { sound: boolean; popup: boolean; badge: boolean };
}

// Backend `/chat/conversations/:id/messages` returns a mixed shape: camelCase
// for the `senderType` override but snake_case for `sender_name`/`sender_avatar`
// (messageController.js parsed-message mapper, ~L370). Agent identity for
// non-human senders lives in `metadata.agent_name|agent_color|agent_icon`
// (loop.js stepMetadata, L235). We accept all forms so the fallback chain in
// `fanout` can prefer real names over the "AI Agent" placeholder.
interface MessageDTO {
  id: number | string;
  conversationId?: number;
  content?: string;
  contentType?: string;
  senderType?: 'human' | 'agent' | 'system' | string;
  senderId?: number | null;
  sender_name?: string | null;
  // For agent messages, the backend `resolveAgentInfoForMessages` overwrites
  // this with the agent's emoji icon (e.g. "🎨") instead of a URL — see
  // chatAgentSubAgents.js:208. Use `looksLikeImageUrl` before passing to <img>.
  sender_avatar?: string | null;
  metadata?: {
    agent_name?: string | null;
    agent_color?: string | null;
    agent_icon?: string | null;
  } | null;
  createdAt?: string;
}

function looksLikeImageUrl(s: string | null | undefined): s is string {
  if (typeof s !== 'string' || s.length === 0) return false;
  return s.startsWith('/') || s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:');
}

interface ApiEnvelope<T> { data?: T; success?: boolean }

const prefsCache = new Map<string, { value: ResolvedPrefs; expiresAt: number }>();

function senderKindFromMessage(m: MessageDTO): NotificationSoundKind | null {
  if (m.senderType === 'human') return 'human';
  if (m.senderType === 'agent') return 'agent';
  return null; // system — silent per ADR §Decision
}

async function fetchPrefs(conversationId: number): Promise<ResolvedPrefs | null> {
  const cached = prefsCache.get(String(conversationId));
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const res = await apiClient.get<ApiEnvelope<{ prefs: ResolvedPrefs }>>(
      `/chat/notification-prefs/resolved?conversation_id=${conversationId}`,
    );
    const prefs = res?.data?.prefs;
    if (!prefs) return null;
    prefsCache.set(String(conversationId), {
      value: prefs,
      expiresAt: Date.now() + PREFS_TTL_MS,
    });
    return prefs;
  } catch (err) {
    logger.warn('[ChatNotifications] resolve prefs failed', err);
    return null;
  }
}

async function fetchNewMessages(
  conversationId: number,
  limit: number,
): Promise<MessageDTO[]> {
  // Fetch a wider window than the delta count: tool_call/thinking messages
  // can interleave between user-visible turns, so naive `slice(-N)` after a
  // tight fetch would miss the real text and grab a tool_call.
  const fetchLimit = Math.min(Math.max(limit * 4, 6), 20);
  try {
    const res = await apiClient.get<ApiEnvelope<{ messages: MessageDTO[] }>>(
      `/chat/conversations/${conversationId}/messages?limit=${fetchLimit}`,
    );
    return res?.data?.messages ?? [];
  } catch (err) {
    logger.warn('[ChatNotifications] fetch new messages failed', err);
    return [];
  }
}

interface FanoutCtx {
  isWindowFocused: () => boolean;
  activeConvId: number | null;
  isChatOpen: boolean;
  openConversation: (convId: number) => void;
}

function fanout(
  msg: MessageDTO,
  prefs: ResolvedPrefs,
  conversationId: number,
  ctx: FanoutCtx,
): void {
  if (!prefs.enabled) return;
  // Tool calls, thinking traces, agent_status pings, plans, moved stubs and
  // row_mutation events are not "real" messages — they only render inside
  // an open conversation. Never sound or popup on them.
  if (msg.contentType && SUPPRESSED_CONTENT_TYPES.has(msg.contentType)) return;
  const kind = senderKindFromMessage(msg);
  if (!kind) return; // system message — never sound/popup, badge already handled

  const block = kind === 'human' ? prefs.humans : prefs.agents;
  const isActive = ctx.isChatOpen && ctx.activeConvId === conversationId && ctx.isWindowFocused();

  if (!isActive) {
    const resolvedName =
      msg.sender_name ||
      msg.metadata?.agent_name ||
      (kind === 'agent' ? 'AI Agent' : 'User');
    if (prefs.sound_enabled && block.sound) {
      const senderSlug = `${msg.senderType ?? 'unknown'}:${msg.senderId ?? resolvedName}`;
      playNotificationSound(kind, {
        senderSlug,
        volume: prefs.sound_volume,
      });
    }
    if (block.popup) {
      const preview = (msg.content ?? '').slice(0, MESSAGE_PREVIEW_MAX);
      const avatarUrl = looksLikeImageUrl(msg.sender_avatar) ? msg.sender_avatar : null;
      showChatToast(preview || '(empty message)', {
        conversationId,
        senderName: resolvedName,
        senderAvatarUrl: avatarUrl,
        agentIcon: msg.metadata?.agent_icon ?? null,
        accentColor: msg.metadata?.agent_color ?? null,
        onClick: () => ctx.openConversation(conversationId),
      });
    }
  }
}

/**
 * Mount once at the app shell. Watches `/chat/unread-summary` for deltas and
 * fans new-message events out to sound/toast/badge surfaces.
 */
export function ChatNotificationOrchestrator() {
  const queryClient = useQueryClient();
  const { isOpen, currentConversationId, openChat, setCurrentConversationId } = useAIChat() as {
    isOpen: boolean;
    currentConversationId: number | null;
    openChat?: () => void;
    setCurrentConversationId?: (id: number | null) => void;
  };

  const { byConversation } = useChatUnreadSummary({
    refetchInterval: ORCHESTRATOR_POLL_MS,
  });

  const prevCountsRef = useRef<Map<number, number> | null>(null);
  const ctxRef = useRef<FanoutCtx>({
    isWindowFocused: () => typeof document !== 'undefined' && document.hasFocus(),
    activeConvId: null,
    isChatOpen: false,
    openConversation: () => undefined,
  });

  useEffect(() => {
    ctxRef.current.activeConvId = currentConversationId;
    ctxRef.current.isChatOpen = isOpen;
    ctxRef.current.openConversation = (convId: number) => {
      if (typeof setCurrentConversationId === 'function') {
        setCurrentConversationId(convId);
      }
      if (typeof openChat === 'function') openChat();
      // Invalidate the unread query so the badge updates after mark-read.
      queryClient.invalidateQueries({ queryKey: CHAT_UNREAD_SUMMARY_QUERY_KEY });
    };
  }, [currentConversationId, isOpen, openChat, setCurrentConversationId, queryClient]);

  useEffect(() => {
    setChatToastClickHandler((meta) => {
      ctxRef.current.openConversation(meta.conversationId);
    });
    return () => setChatToastClickHandler(null);
  }, []);

  useEffect(() => {
    if (!byConversation) return;

    const curr = new Map<number, number>();
    for (const r of byConversation) curr.set(r.conversation_id, r.unread_count);

    const prev = prevCountsRef.current;
    if (prev === null) {
      prevCountsRef.current = curr;
      return;
    }

    const deltas: Array<{ conversationId: number; count: number }> = [];
    for (const [convId, count] of curr.entries()) {
      const prevCount = prev.get(convId) ?? 0;
      const delta = count - prevCount;
      if (delta > 0) deltas.push({ conversationId: convId, count: delta });
    }
    prevCountsRef.current = curr;

    if (deltas.length === 0) return;

    deltas.forEach(async ({ conversationId, count }) => {
      const prefs = await fetchPrefs(conversationId);
      if (!prefs) return;
      const messages = await fetchNewMessages(conversationId, count);
      // Drop non-final step messages before slicing so we don't pop a
      // tool_call that arrived after the real text. The unread counter
      // already ignores these, so the delta is in user-visible messages.
      const visible = messages.filter(
        (m) => !m.contentType || !SUPPRESSED_CONTENT_TYPES.has(m.contentType),
      );
      // newest-last is the convention from useConversationMessages — last N are new
      const newest = visible.slice(-count);
      newest.forEach((m) => fanout(m, prefs, conversationId, ctxRef.current));
    });
  }, [byConversation]);

  return null;
}

/** Test-only helper. */
export function __resetPrefsCache(): void {
  prefsCache.clear();
}
