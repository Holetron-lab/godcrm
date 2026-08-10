/**
 * Desktop Tabs Store
 * Manages browser-like tabs for the desktop application
 * Tabs are shown in the header between breadcrumbs and action buttons
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isDesktopApp } from '@/shared/types/electron.types';

export interface Tab {
  id: string;
  path: string;
  title: string;
  icon?: string;
  /** Tab type for grouping and styling */
  type: 'space' | 'project' | 'table' | 'widget' | 'settings' | 'other';
  /** Whether the tab has unsaved changes */
  isDirty?: boolean;
  /** Timestamp when tab was last accessed */
  lastAccessed: number;
}

interface TabsState {
  tabs: Tab[];
  activeTabId: string | null;
  maxTabs: number;
  
  // Actions
  openTab: (tab: Omit<Tab, 'id' | 'lastAccessed'>) => string;
  closeTab: (tabId: string) => void;
  closeOtherTabs: (tabId: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (tabId: string) => void;
  updateTabTitle: (tabId: string, title: string, icon?: string) => void;
  setTabDirty: (tabId: string, isDirty: boolean) => void;
  getTabByPath: (path: string) => Tab | undefined;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
}

// Generate unique tab ID
const generateTabId = () => `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Normalize path for comparison (remove trailing slash, query params)
const normalizePath = (path: string): string => {
  return path.split('?')[0].replace(/\/$/, '') || '/';
};

export const useTabsStore = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,
      maxTabs: 20,

      openTab: (tabData) => {
        const normalizedPath = normalizePath(tabData.path);
        const existingTab = get().tabs.find(t => normalizePath(t.path) === normalizedPath);
        
        if (existingTab) {
          // Tab already exists - activate it and update lastAccessed
          set(state => ({
            activeTabId: existingTab.id,
            tabs: state.tabs.map(t => 
              t.id === existingTab.id 
                ? { ...t, lastAccessed: Date.now(), title: tabData.title, icon: tabData.icon }
                : t
            )
          }));
          return existingTab.id;
        }

        // Create new tab
        const newTab: Tab = {
          ...tabData,
          id: generateTabId(),
          path: normalizedPath,
          lastAccessed: Date.now(),
        };

        set(state => {
          let newTabs = [...state.tabs, newTab];
          
          // If exceeding max tabs, close oldest non-dirty tab
          if (newTabs.length > state.maxTabs) {
            const oldestNonDirty = newTabs
              .filter(t => !t.isDirty && t.id !== newTab.id)
              .sort((a, b) => a.lastAccessed - b.lastAccessed)[0];
            
            if (oldestNonDirty) {
              newTabs = newTabs.filter(t => t.id !== oldestNonDirty.id);
            }
          }

          return {
            tabs: newTabs,
            activeTabId: newTab.id,
          };
        });

        return newTab.id;
      },

      closeTab: (tabId) => {
        set(state => {
          const tabIndex = state.tabs.findIndex(t => t.id === tabId);
          if (tabIndex === -1) return state;

          const newTabs = state.tabs.filter(t => t.id !== tabId);
          
          // If closing active tab, switch to adjacent tab
          let newActiveTabId = state.activeTabId;
          if (state.activeTabId === tabId && newTabs.length > 0) {
            // Prefer tab to the left, then to the right
            const newIndex = Math.min(tabIndex, newTabs.length - 1);
            newActiveTabId = newTabs[newIndex]?.id || null;
          } else if (newTabs.length === 0) {
            newActiveTabId = null;
          }

          return {
            tabs: newTabs,
            activeTabId: newActiveTabId,
          };
        });
      },

      closeOtherTabs: (tabId) => {
        set(state => ({
          tabs: state.tabs.filter(t => t.id === tabId || t.isDirty),
          activeTabId: tabId,
        }));
      },

      closeAllTabs: () => {
        set(state => ({
          tabs: state.tabs.filter(t => t.isDirty),
          activeTabId: state.tabs.find(t => t.isDirty)?.id || null,
        }));
      },

      setActiveTab: (tabId) => {
        set(state => ({
          activeTabId: tabId,
          tabs: state.tabs.map(t => 
            t.id === tabId ? { ...t, lastAccessed: Date.now() } : t
          ),
        }));
      },

      updateTabTitle: (tabId, title, icon) => {
        set(state => ({
          tabs: state.tabs.map(t => 
            t.id === tabId ? { ...t, title, icon: icon ?? t.icon } : t
          ),
        }));
      },

      setTabDirty: (tabId, isDirty) => {
        set(state => ({
          tabs: state.tabs.map(t => 
            t.id === tabId ? { ...t, isDirty } : t
          ),
        }));
      },

      getTabByPath: (path) => {
        const normalizedPath = normalizePath(path);
        return get().tabs.find(t => normalizePath(t.path) === normalizedPath);
      },

      reorderTabs: (fromIndex, toIndex) => {
        set(state => {
          const newTabs = [...state.tabs];
          const [movedTab] = newTabs.splice(fromIndex, 1);
          newTabs.splice(toIndex, 0, movedTab);
          return { tabs: newTabs };
        });
      },
    }),
    {
      name: 'god-crm-tabs',
      // Only persist in desktop app
      skipHydration: !isDesktopApp(),
      partialize: (state) => ({
        tabs: state.tabs.map(t => ({ ...t, isDirty: false })), // Don't persist dirty state
        activeTabId: state.activeTabId,
      }),
    }
  )
);

// Helper hook to determine tab type from path
export const getTabTypeFromPath = (path: string): Tab['type'] => {
  if (path.startsWith('/settings')) return 'settings';
  if (path.includes('/widgets/')) return 'widget';
  if (path.includes('/tables/')) return 'table';
  if (path.includes('/projects/')) return 'project';
  if (path.includes('/spaces/')) return 'space';
  return 'other';
};
