/**
 * Desktop App Hook
 * Manages desktop-specific functionality:
 * - Context menu on right-click (with link support)
 * - Middle-click to open in new tab
 * - Settings modal
 * - Navigation events
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { isDesktopApp } from '@/shared/types/electron.types';
import { useTabsStore, getTabTypeFromPath } from '@/shared/stores/tabsStore';

/**
 * Find the closest link element from a target
 */
const findLinkElement = (target: HTMLElement): HTMLAnchorElement | null => {
  let el: HTMLElement | null = target;
  while (el) {
    if (el.tagName === 'A' && (el as HTMLAnchorElement).href) {
      return el as HTMLAnchorElement;
    }
    el = el.parentElement;
  }
  return null;
};

/**
 * Check if href is an internal link (same-origin or relative)
 */
const isInternalLink = (href: string): boolean => {
  try {
    const url = new URL(href, window.location.origin);
    return url.origin === window.location.origin;
  } catch {
    return true; // Relative paths are internal
  }
};

/**
 * Extract path from href
 */
const getPathFromHref = (href: string): string => {
  try {
    const url = new URL(href, window.location.origin);
    // For hash router, extract path from hash
    if (url.hash.startsWith('#/')) {
      return url.hash.slice(1); // Remove # prefix
    }
    return url.pathname + url.search;
  } catch {
    return href;
  }
};

export const useDesktopApp = () => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const isDesktop = isDesktopApp();
  const navigate = useNavigate();
  const { openTab } = useTabsStore();

  // Handle right-click context menu
  useEffect(() => {
    if (!isDesktop || !window.electronAPI) return;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      
      const target = e.target as HTMLElement;
      const selection = window.getSelection();
      const hasSelection = selection !== null && selection.toString().length > 0;
      const selectionText = hasSelection ? selection?.toString() : '';
      
      // Check if target is an editable element
      const isEditable = 
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.closest('[contenteditable="true"]') !== null;

      // Check if clicking on a link
      const linkElement = findLinkElement(target);
      const linkHref = linkElement?.href;
      const linkText = linkElement?.textContent || undefined;
      
      // Get current page URL (for "Copy page link" feature)
      const pageUrl = window.location.href;

      window.electronAPI?.showContextMenu({
        isEditable,
        hasSelection,
        selectionText,
        linkHref,
        linkText,
        pageUrl,
      });
    };

    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, [isDesktop]);

  // Handle middle-click to open in new tab
  useEffect(() => {
    if (!isDesktop) return;

    const handleMiddleClick = (e: MouseEvent) => {
      // Middle button is button 1
      if (e.button !== 1) return;
      
      const target = e.target as HTMLElement;
      const linkElement = findLinkElement(target);
      
      if (linkElement && linkElement.href) {
        const href = linkElement.href;
        
        if (isInternalLink(href)) {
          e.preventDefault();
          e.stopPropagation();
          
          const path = getPathFromHref(href);
          const title = linkElement.textContent || path;
          const type = getTabTypeFromPath(path);
          
          // Open in new tab without navigating
          openTab({
            path,
            title,
            type,
          });
        }
      }
    };

    document.addEventListener('auxclick', handleMiddleClick);
    return () => document.removeEventListener('auxclick', handleMiddleClick);
  }, [isDesktop, openTab]);

  // Listen for "open in new tab" event from context menu
  useEffect(() => {
    if (!isDesktop || !window.electronAPI) return;

    const unsubscribe = window.electronAPI.onOpenInNewTab((href: string) => {
      if (isInternalLink(href)) {
        const path = getPathFromHref(href);
        const type = getTabTypeFromPath(path);
        
        // Open in new tab and navigate to it
        openTab({
          path,
          title: path,
          type,
        });
        navigate(path);
      }
    });

    return unsubscribe;
  }, [isDesktop, openTab, navigate]);

  // Listen for settings open event from main process
  useEffect(() => {
    if (!isDesktop || !window.electronAPI) return;

    const unsubscribe = window.electronAPI.onOpenSettings(() => {
      setIsSettingsOpen(true);
    });

    return unsubscribe;
  }, [isDesktop]);

  const openSettings = useCallback(() => {
    setIsSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  return {
    isDesktop,
    isSettingsOpen,
    openSettings,
    closeSettings,
  };
};
