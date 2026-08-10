/**
 * useResizeHandlers — Panel resize logic extracted from AIChatPanel.tsx
 * ADR-119: Handles vertical, horizontal, and sidebar resize via mouse/touch.
 */

import { useCallback } from 'react';
import type { PanelMode, PanelTab } from '../types';

interface UseResizeHandlersParams {
  panelHeight: number | 'auto';
  panelWidth: number;
  sidebarWidth: number;
  panelMode: PanelMode;
  setPanelHeight: (v: number | 'auto' | ((prev: number | 'auto') => number | 'auto')) => void;
  setPanelMode: (v: PanelMode | ((prev: PanelMode) => PanelMode)) => void;
  setIsResizing: (v: boolean) => void;
  setPanelWidth: (v: number | ((prev: number) => number)) => void;
  setIsResizingWidth: (v: boolean) => void;
  setSidebarWidth: (v: number | ((prev: number) => number)) => void;
  setIsResizingSidebar: (v: boolean) => void;
  activePanel: PanelTab;
  setActivePanel: (v: PanelTab) => void;
}

export function useResizeHandlers(params: UseResizeHandlersParams) {
  const {
    panelHeight,
    panelWidth,
    sidebarWidth,
    panelMode,
    setPanelHeight,
    setPanelMode,
    setIsResizing,
    setPanelWidth,
    setIsResizingWidth,
    setSidebarWidth,
    setIsResizingSidebar,
    activePanel,
    setActivePanel,
  } = params;

  // Vertical resize handler (mouse) - with snap to modes
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startY = e.clientY;
    const container = (e.target as HTMLElement).closest('[data-panel-container]');
    const containerHeight = container?.parentElement?.clientHeight || 600;
    const startHeight = typeof panelHeight === 'number' ? panelHeight : containerHeight;
    const minHeight = 400;
    const maxHeight = containerHeight - 400;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientY - startY;
      const newHeight = startHeight + delta;
      if (newHeight <= minHeight) {
        setPanelHeight(minHeight);
        setPanelMode('collapsed');
      } else if (newHeight >= maxHeight) {
        setPanelHeight(maxHeight);
        setPanelMode('default');
      } else {
        setPanelHeight(newHeight);
        setPanelMode('expanded');
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [panelHeight, setPanelHeight, setPanelMode, setIsResizing]);

  // Touch resize handler for mobile
  const handleTouchResizeStart = useCallback((e: React.TouchEvent) => {
    setIsResizing(true);
    const startY = e.touches[0].clientY;
    const container = (e.target as HTMLElement).closest('[data-panel-container]');
    const containerHeight = container?.parentElement?.clientHeight || 600;
    const startHeight = typeof panelHeight === 'number' ? panelHeight : containerHeight;
    const minHeight = 400;
    const maxHeight = containerHeight - 400;

    const handleTouchMove = (e: TouchEvent) => {
      const delta = e.touches[0].clientY - startY;
      const newHeight = startHeight + delta;
      if (newHeight <= minHeight) {
        setPanelHeight(minHeight);
        setPanelMode('collapsed');
      } else if (newHeight >= maxHeight) {
        setPanelHeight(maxHeight);
        setPanelMode('default');
      } else {
        setPanelHeight(newHeight);
        setPanelMode('expanded');
      }
    };

    const handleTouchEnd = () => {
      setIsResizing(false);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
  }, [panelHeight, setPanelHeight, setPanelMode, setIsResizing]);

  // Horizontal resize handler (for expanding chat left)
  const handleWidthResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingWidth(true);
    const startX = e.clientX;
    const startWidth = panelWidth;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startX - e.clientX;
      const newWidth = Math.max(320, Math.min(1170, startWidth + delta));
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingWidth(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [panelWidth, setPanelWidth, setIsResizingWidth]);

  // Sidebar resize handler (between chat and sidebar)
  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startX - e.clientX;
      const newWidth = Math.max(300, Math.min(500, startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [sidebarWidth, setSidebarWidth, setIsResizingSidebar]);

  // Panel mode toggle - cycles through 4 modes
  const togglePanelMode = useCallback(() => {
    setPanelMode(prev => {
      if (prev === 'collapsed') return 'expanded';
      if (prev === 'expanded') return 'default';
      if (prev === 'default') return 'fullscreen';
      return 'collapsed';
    });
    setPanelHeight('auto');
  }, [setPanelMode, setPanelHeight]);

  // Toggle panel — reset panelMode when closing
  const togglePanel = useCallback((panel: PanelTab) => {
    if (activePanel === panel) {
      setActivePanel('none');
      if (panelMode === 'fullscreen' || panelMode === 'expanded') {
        setPanelMode('collapsed');
      }
    } else {
      setActivePanel(panel);
    }
  }, [activePanel, panelMode, setActivePanel, setPanelMode]);

  return {
    handleResizeStart,
    handleTouchResizeStart,
    handleWidthResizeStart,
    handleSidebarResizeStart,
    togglePanelMode,
    togglePanel,
  };
}
