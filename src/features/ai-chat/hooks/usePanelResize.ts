/**
 * ADR-097: Panel resize handlers
 * Extracted from AIChatPanel.tsx (lines 1903-2054)
 *
 * Provides vertical/horizontal/sidebar resize via mouse and touch,
 * plus panel mode toggling.
 */

import { useCallback } from 'react';

export type PanelMode = 'collapsed' | 'expanded' | 'default' | 'fullscreen';
export type PanelTab = 'none' | 'contacts' | 'ai-agents' | 'tasks' | 'documents' | 'settings' | 'inbox';

export interface UsePanelResizeParams {
  panelHeight: number | 'auto';
  panelWidth: number;
  sidebarWidth: number;
  panelMode: PanelMode;
  activePanel: PanelTab;
  setPanelHeight: (v: number | 'auto') => void;
  setPanelWidth: (v: number) => void;
  setSidebarWidth: (v: number) => void;
  setPanelMode: (v: PanelMode | ((prev: PanelMode) => PanelMode)) => void;
  setIsResizing: (v: boolean) => void;
  setIsResizingWidth: (v: boolean) => void;
  setIsResizingSidebar: (v: boolean) => void;
  setActivePanel: (v: PanelTab) => void;
}

export interface UsePanelResizeReturn {
  handleResizeStart: (e: React.MouseEvent) => void;
  handleTouchResizeStart: (e: React.TouchEvent) => void;
  handleWidthResizeStart: (e: React.MouseEvent) => void;
  handleSidebarResizeStart: (e: React.MouseEvent) => void;
  togglePanelMode: () => void;
  togglePanel: (panel: PanelTab) => void;
}

export function usePanelResize({
  panelHeight,
  panelWidth,
  sidebarWidth,
  panelMode,
  activePanel,
  setPanelHeight,
  setPanelWidth,
  setSidebarWidth,
  setPanelMode,
  setIsResizing,
  setIsResizingWidth,
  setIsResizingSidebar,
  setActivePanel,
}: UsePanelResizeParams): UsePanelResizeReturn {
  // Resize handler (mouse) - with snap to modes
  // Logic: min 400px panel, max containerHeight - 400px (leaves 400px for chat)
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startY = e.clientY;
    const container = (e.target as HTMLElement).closest('[data-panel-container]');
    const containerHeight = container?.parentElement?.clientHeight || 600;
    const startHeight = typeof panelHeight === 'number' ? panelHeight : containerHeight;
    const minHeight = 400;
    const maxHeight = containerHeight - 400; // Always leave 400px for chat

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientY - startY;
      const newHeight = startHeight + delta;

      // Snap logic:
      // - Below 400px -> snap to collapsed (400px fixed)
      // - Above maxHeight -> snap to max (leaves 400px for chat)
      // - Between -> free resize
      if (newHeight <= minHeight) {
        setPanelHeight(minHeight);
        setPanelMode('collapsed');
      } else if (newHeight >= maxHeight) {
        setPanelHeight(maxHeight);
        setPanelMode('default');
      } else {
        // Free resize zone - expanded mode with specific height
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

  // Touch resize handler for mobile - same logic
  // Note: Using touch-action: none on the element instead of preventDefault to avoid passive listener warnings
  const handleTouchResizeStart = useCallback((e: React.TouchEvent) => {
    setIsResizing(true);
    const startY = e.touches[0].clientY;
    const container = (e.target as HTMLElement).closest('[data-panel-container]');
    const containerHeight = container?.parentElement?.clientHeight || 600;
    const startHeight = typeof panelHeight === 'number' ? panelHeight : containerHeight;
    const minHeight = 400;
    const maxHeight = containerHeight - 400; // Always leave 400px for chat

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
      const delta = startX - e.clientX; // moving left increases width
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
      const delta = startX - e.clientX; // moving left increases sidebar width
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
  // collapsed -> expanded -> default -> fullscreen -> collapsed
  // collapsed = minimal bar, expanded = shows 400px chat, default = fills to input, fullscreen = covers everything
  const togglePanelMode = useCallback(() => {
    setPanelMode((prev: PanelMode) => {
      if (prev === 'collapsed') return 'expanded';
      if (prev === 'expanded') return 'default';
      if (prev === 'default') return 'fullscreen';
      return 'collapsed'; // fullscreen -> collapsed
    });
    setPanelHeight('auto');
  }, [setPanelMode, setPanelHeight]);

  // Toggle panel -- reset panelMode when closing to prevent stale fullscreen hiding input
  const togglePanel = (panel: PanelTab) => {
    if (activePanel === panel) {
      setActivePanel('none');
      // Bug fix: Reset panelMode when closing panel -- otherwise panelMode stays 'fullscreen'
      // and the input area remains hidden (line ~4402: panelMode !== 'fullscreen')
      if (panelMode === 'fullscreen' || panelMode === 'expanded') {
        setPanelMode('collapsed');
      }
    } else {
      setActivePanel(panel);
    }
  };

  return {
    handleResizeStart,
    handleTouchResizeStart,
    handleWidthResizeStart,
    handleSidebarResizeStart,
    togglePanelMode,
    togglePanel,
  };
}
