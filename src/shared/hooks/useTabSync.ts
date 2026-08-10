/**
 * Hook for syncing tabs with navigation
 * Automatically opens/updates tabs when navigating to new pages
 * Only active in desktop app
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTabsStore, getTabTypeFromPath } from '@/shared/stores/tabsStore';
import { isDesktopApp } from '@/shared/types/electron.types';

interface TabInfo {
  title: string;
  icon?: string;
}

/**
 * Hook to sync current route with tabs
 * Call this in Layout or App component to automatically create tabs
 */
export const useTabSync = (tabInfo?: TabInfo) => {
  const location = useLocation();
  const { openTab, getTabByPath, updateTabTitle, activeTabId, tabs } = useTabsStore();

  useEffect(() => {
    // Only in desktop app
    if (!isDesktopApp()) return;

    // Skip certain paths that shouldn't create tabs
    const skipPaths = ['/login', '/auth', '/callback'];
    if (skipPaths.some(p => location.pathname.startsWith(p))) return;

    const path = location.pathname;
    const existingTab = getTabByPath(path);

    if (existingTab) {
      // Tab exists - update if we have new info
      if (tabInfo?.title && tabInfo.title !== existingTab.title) {
        updateTabTitle(existingTab.id, tabInfo.title, tabInfo.icon);
      }
    } else {
      // Create new tab
      const type = getTabTypeFromPath(path);
      const defaultTitle = getDefaultTitle(path);
      
      openTab({
        path,
        title: tabInfo?.title || defaultTitle,
        icon: tabInfo?.icon,
        type,
      });
    }
  }, [location.pathname]);

  // Update tab title when tabInfo changes
  useEffect(() => {
    if (!isDesktopApp() || !tabInfo?.title) return;
    
    const tab = getTabByPath(location.pathname);
    if (tab && tab.title !== tabInfo.title) {
      updateTabTitle(tab.id, tabInfo.title, tabInfo.icon);
    }
  }, [tabInfo?.title, tabInfo?.icon]);
};

/**
 * Get default title from path
 */
function getDefaultTitle(path: string): string {
  // Extract meaningful parts from path
  const parts = path.split('/').filter(Boolean);
  
  if (parts.length === 0) return 'Главная';
  
  // Known routes
  if (path === '/settings') return 'Настройки';
  if (path === '/help') return 'Помощь';
  if (path.includes('/dashboard')) return 'Дашборд';
  if (path.includes('/schema')) return 'Схема';
  
  // Use last meaningful part
  const lastPart = parts[parts.length - 1];
  
  // If it's an ID (numeric), use previous part
  if (/^\d+$/.test(lastPart) && parts.length > 1) {
    return parts[parts.length - 2];
  }
  
  return lastPart;
}

/**
 * Hook to mark current tab as dirty (has unsaved changes)
 */
export const useTabDirty = (isDirty: boolean) => {
  const location = useLocation();
  const { getTabByPath, setTabDirty } = useTabsStore();

  useEffect(() => {
    if (!isDesktopApp()) return;
    
    const tab = getTabByPath(location.pathname);
    if (tab) {
      setTabDirty(tab.id, isDirty);
    }
  }, [isDirty, location.pathname]);
};
