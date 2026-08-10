/**
 * AIChatPanel — Barrel re-export (ADR-119).
 *
 * The original 5100-line monolithic component has been refactored into
 * focused modules under ./AIChatPanel/. This file preserves the import
 * path for all existing consumers.
 */
export { AIChatPanel } from './AIChatPanel/AIChatPanel';
export type { AIChatPanelProps } from './AIChatPanel.types';
