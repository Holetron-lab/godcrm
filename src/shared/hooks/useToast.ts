import { useState, useCallback, useEffect } from 'react';

// ADR-0064 WP-B: extended with a `chat` variant for chat notification toasts.
// Existing `info|success|error` toasts keep their 3s auto-dismiss; chat toasts
// auto-dismiss after 6s and may carry richer metadata (avatar, conversation_id,
// click target).

export interface ChatToastMeta {
  conversationId: number;
  senderName: string;
  senderAvatarUrl?: string | null;
  /** Agent emoji icon shown in the chip when no avatar URL is available. */
  agentIcon?: string | null;
  /** CSS color (any valid value) used for the left accent stripe + initial chip tint. */
  accentColor?: string | null;
  /** Set when the toast is a catch-up summary (>5 msgs in <10s for same conv). */
  collapsedCount?: number;
  /** Optional click handler — defaults to the global `chatToastClickHandler`. */
  onClick?: () => void;
}

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'chat';
  chat?: ChatToastMeta;
}

const TOAST_TTL_BY_TYPE: Record<Toast['type'], number> = {
  success: 3000,
  error: 3000,
  info: 3000,
  chat: 6000,
};

const MAX_VISIBLE_TOASTS = 3;
// Catch-up suppression: >5 messages in <10s for the same conversation collapse
// into a single summary toast (ADR-0064 §Decision §Toasts).
const CATCHUP_WINDOW_MS = 10_000;
const CATCHUP_THRESHOLD = 5;

let toastCounter = 0;
const toastListeners: Set<(toast: Toast) => void> = new Set();

// Per-conversation timestamp ring for catch-up detection. Module-level so it
// survives across showToast calls but resets on page reload.
const conversationStamps = new Map<number, number[]>();

let chatToastClickHandler: ((meta: ChatToastMeta) => void) | null = null;

/**
 * Register a global click handler invoked when a `chat` toast is clicked
 * (used by App-level mount to open the chat panel + mark-read).
 */
export const setChatToastClickHandler = (
  handler: ((meta: ChatToastMeta) => void) | null,
): void => {
  chatToastClickHandler = handler;
};

export const showToast = (
  message: string,
  type: 'success' | 'error' | 'info' = 'info',
) => {
  const toast: Toast = {
    id: `toast-${++toastCounter}`,
    message,
    type,
  };
  toastListeners.forEach((listener) => listener(toast));
};

/**
 * Show a chat-message toast. Applies catch-up suppression: if the same
 * conversation produced more than CATCHUP_THRESHOLD toasts in the last
 * CATCHUP_WINDOW_MS, returns a collapsed summary toast instead.
 */
export const showChatToast = (message: string, meta: ChatToastMeta): void => {
  const now = Date.now();
  const stamps = conversationStamps.get(meta.conversationId) ?? [];
  const recent = stamps.filter((t) => now - t < CATCHUP_WINDOW_MS);
  recent.push(now);
  conversationStamps.set(meta.conversationId, recent);

  let finalMeta = meta;
  let finalMessage = message;
  if (recent.length > CATCHUP_THRESHOLD) {
    finalMeta = { ...meta, collapsedCount: recent.length };
    finalMessage = `${recent.length} new messages in this chat`;
  }

  const toast: Toast = {
    id: `toast-${++toastCounter}`,
    message: finalMessage,
    type: 'chat',
    chat: finalMeta,
  };
  toastListeners.forEach((listener) => listener(toast));
};

export const useToast = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Toast) => {
    setToasts((prev) => {
      const next = [...prev, toast];
      // Stack cap — drop the oldest non-active toasts (ADR-0064 §Toasts).
      return next.length > MAX_VISIBLE_TOASTS
        ? next.slice(next.length - MAX_VISIBLE_TOASTS)
        : next;
    });
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, TOAST_TTL_BY_TYPE[toast.type]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleChatToastClick = useCallback((toast: Toast) => {
    if (toast.type !== 'chat' || !toast.chat) return;
    if (toast.chat.onClick) {
      toast.chat.onClick();
    } else if (chatToastClickHandler) {
      chatToastClickHandler(toast.chat);
    }
    setToasts((prev) => prev.filter((t) => t.id !== toast.id));
  }, []);

  useEffect(() => {
    toastListeners.add(addToast);
    return () => {
      toastListeners.delete(addToast);
    };
  }, [addToast]);

  return { toasts, removeToast, handleChatToastClick };
};
