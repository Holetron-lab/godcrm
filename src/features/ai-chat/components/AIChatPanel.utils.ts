/**
 * AIChatPanel.utils.ts
 * Utility/helper functions extracted from AIChatPanel.tsx
 */

import type { TasksSourceConfig } from './AIChatPanel.types';

// Column name aliases for auto-detection
export const TITLE_ALIASES = ['title', 'what', 'name', 'subject', 'Название'];
export const _DESC_ALIASES = ['description', 'why', 'details', 'body', 'Описание'];
export const _STATUS_ALIASES = ['state', 'status', 'task_status', 'Статус'];
export const _PRIORITY_ALIASES = ['priority', 'urgency', 'Приоритет'];

/** Get task row title using configured column or fallback aliases */
export function getTaskRowTitle(
  row: { id: number; data: Record<string, unknown> },
  config?: TasksSourceConfig
): string {
  const d = row.data;
  // Try configured display column first
  if (config?.displayColumn && d[config.displayColumn]) {
    return String(d[config.displayColumn]);
  }
  // Try common aliases
  for (const alias of TITLE_ALIASES) {
    if (d[alias]) return String(d[alias]);
  }
  return `Запись #${row.id}`;
}

/** Get task row field value */
export function getTaskRowField(
  row: { id: number; data: Record<string, unknown> },
  column?: string
): unknown {
  if (!column) return undefined;
  return row.data[column];
}

// Helper: Get file extension from URL or filename
export const getFileExtension = (urlOrName: string): string => {
  const parts = urlOrName.split('/').pop()?.split('.') || [];
  return parts.length > 1 ? parts.pop()?.toLowerCase() || '' : '';
};

// Helper: Check if file is an image
export const isImageFile = (urlOrName: string): boolean => {
  const ext = getFileExtension(urlOrName);
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext);
};

// Helper: Check if file is a video
export const isVideoFile = (urlOrName: string): boolean => {
  const ext = getFileExtension(urlOrName);
  return ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'].includes(ext);
};

// Helper: Check if file is audio
export const isAudioFile = (urlOrName: string): boolean => {
  const ext = getFileExtension(urlOrName);
  return ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a'].includes(ext);
};

/**
 * ADR-069: Highlight @mentions and /commands in message content
 * NOTE: This is also available in ../utils/highlightMentions.tsx but is kept here
 * for backwards compatibility with the _MessageBubble legacy component.
 */
export { highlightMentions } from '../utils/highlightMentions';
