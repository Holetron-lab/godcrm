/**
 * Unified chat configuration
 * ADR-024: Bubble-based pagination
 * ADR-078: Unified polling config for all chat types
 */
export const CHAT_CONFIG = {
  /** Number of visual bubbles per page */
  BUBBLE_PAGE_SIZE: 50,
  /** Backend hard max for messages per request — raised from 200 → 2000 to support long AI convos */
  MAX_PAGE_SIZE: 2000,
  /** Raw message limit per API request (reduced for lazy loading — only text/plan messages) */
  RAW_PAGE_SIZE: 50,
  /** Page size for useConversationMessages hook — must match RAW_PAGE_SIZE */
  MESSAGE_PAGE_SIZE: 50,
  /** Scroll threshold for auto-scroll (px from bottom).
   *  If user scrolled up more than this — do NOT auto-scroll on new messages.
   *  300px: once the user lifts even a few messages off the bottom to read, new
   *  messages (incl. agent polling) stop yanking the viewport down. */
  AUTO_SCROLL_THRESHOLD: 300,
  /** Distance from bottom (px) at which scroll-to-bottom button appears.
   *  Kept equal to AUTO_SCROLL_THRESHOLD so the "new messages ↓" button shows
   *  exactly when auto-scroll disengages — no silent dead zone. */
  SCROLL_BUTTON_THRESHOLD: 300,
  /** Pre-trigger distance for infinite scroll (px from top) */
  PREFETCH_THRESHOLD: 800,
} as const;
