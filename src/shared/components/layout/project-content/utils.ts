import type { WidgetOrganization } from './types';

// Local storage key for widget organization
export const getStorageKey = (projectId: number) => `widget-org-${projectId}`;

// Load organization from localStorage
export const loadOrganization = (projectId: number): WidgetOrganization | null => {
  try {
    const stored = localStorage.getItem(getStorageKey(projectId));
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
};

// Save organization to localStorage
export const saveOrganization = (projectId: number, org: WidgetOrganization) => {
  localStorage.setItem(getStorageKey(projectId), JSON.stringify(org));
};

// Folder Emoji Presets (8x4 = 32 icons)
export const FOLDER_EMOJIS = [
  '📁', '📂', '🗂️', '💼', '📦', '🎯', '⭐', '💡',
  '🔥', '💎', '🚀', '✨', '📊', '📈', '📋', '🔑',
  '🏆', '🎨', '💰', '🔧', '⚡', '🌟', '📱', '💻',
  '🎮', '🎵', '📸', '🛒', '🏠', '✈️', '🎁', '❤️',
];
