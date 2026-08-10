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
   *  If user scrolled up more than this — do NOT auto-scroll on new messages. */
  AUTO_SCROLL_THRESHOLD: 500,
  /** Distance from bottom (px) at which scroll-to-bottom button appears */
  SCROLL_BUTTON_THRESHOLD: 500,
  /** Pre-trigger distance for infinite scroll (px from top) */
  PREFETCH_THRESHOLD: 800,
} as const;
