import { createContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';

const IDLE_MS = 60_000;
const POLL_MS = 15_000;
interface PresenceResponse {
  success: boolean;
  data: { users: { user_id: number; last_activity_at: string }[]; server_time: string };
}
interface Presence {
  conversationId: number | null;
  onlineUserIds: ReadonlySet<number>;
  known: boolean;
}
export const HumanChatPresenceContext = createContext<Presence>({
  conversationId: null, onlineUserIds: new Set(), known: false,
});

/** One publisher per visible chat, never one heartbeat per message bubble. */
export function useHumanChatPresence(conversationId: number | null, enabled: boolean): Presence {
  const [now, setNow] = useState(Date.now);
  const query = useQuery({
    queryKey: ['human-chat-presence', conversationId],
    enabled: enabled && conversationId !== null,
    queryFn: async () => {
      const response = await apiClient.get<PresenceResponse>(`/chat/conversations/${conversationId}/presence`);
      if (!response.success) throw new Error('Presence unavailable');
      const receivedAt = Date.now();
      const serverTime = Date.parse(response.data.server_time);
      if (!Number.isFinite(serverTime)) throw new Error('Invalid presence time');
      return {
        receivedAt,
        users: response.data.users.map(user => ({
          id: user.user_id,
          expiresAt: receivedAt + IDLE_MS - Math.max(0, serverTime - Date.parse(user.last_activity_at)),
        })),
      };
    },
    refetchInterval: POLL_MS,
    retry: false,
    staleTime: 0,
  });

  useEffect(() => {
    if (!enabled || conversationId === null) return;
    const clientId = crypto.randomUUID();
    const path = `/chat/conversations/${conversationId}/presence`;
    let lastActivity = Date.now();
    let lastSent = 0;
    let idleTimer: ReturnType<typeof setTimeout>;
    let trailingTimer: ReturnType<typeof setTimeout> | undefined;
    let pending = Promise.resolve();
    const visible = () => document.visibilityState === 'visible' && document.hasFocus();
    const publish = (active: boolean) => {
      lastSent = Date.now();
      // Serialize leave after activity, so a late request cannot resurrect a closed tab.
      pending = pending.then(() => {
        const idleMs = Math.min(IDLE_MS, Date.now() - lastActivity);
        return apiClient.post(path, { data: { client_id: clientId, active: active && idleMs < IDLE_MS, idle_ms: idleMs } }, { keepalive: true });
      }).then(() => {}, () => {});
    };
    const leave = () => {
      clearTimeout(idleTimer);
      clearTimeout(trailingTimer);
      trailingTimer = undefined;
      publish(false);
    };
    const activity = () => {
      if (!visible()) return;
      lastActivity = Date.now();
      clearTimeout(idleTimer);
      idleTimer = setTimeout(leave, IDLE_MS);
      if (Date.now() - lastSent >= POLL_MS) publish(true);
      else if (!trailingTimer) trailingTimer = setTimeout(() => {
        trailingTimer = undefined;
        if (visible()) publish(Date.now() - lastActivity < IDLE_MS);
      }, POLL_MS - (Date.now() - lastSent));
    };
    const onActivity = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(`[data-chat-presence="${conversationId}"]`)) activity();
    };
    const onVisibility = () => { if (visible()) activity(); else leave(); };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'];
    events.forEach(event => document.addEventListener(event, onActivity, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', leave);
    window.addEventListener('focus', onVisibility);
    window.addEventListener('pagehide', leave);
    activity();
    return () => {
      events.forEach(event => document.removeEventListener(event, onActivity, true));
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', leave);
      window.removeEventListener('focus', onVisibility);
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [conversationId, enabled]);

  // Expire dots locally even if polling stalls; account for client/server clock skew.
  const clock = Math.max(now, Date.now());
  const freshUntil = (query.data?.receivedAt ?? 0) + POLL_MS * 2;
  const known = enabled && !query.isError && !!query.data && clock < freshUntil;
  const ids = known ? query.data!.users.filter(user => user.expiresAt > clock).map(user => user.id).sort((a, b) => a - b).join(',') : '';
  useEffect(() => {
    if (!known) return;
    const nextExpiry = Math.min(freshUntil, ...query.data!.users.filter(user => user.expiresAt > clock).map(user => user.expiresAt));
    const timer = setTimeout(() => setNow(Date.now()), Math.max(1, nextExpiry - Date.now()));
    return () => clearTimeout(timer);
  }, [query.data, known, clock, freshUntil]);
  return useMemo(() => ({
    conversationId, known, onlineUserIds: new Set(ids ? ids.split(',').map(Number) : []),
  }), [conversationId, known, ids]);
}
