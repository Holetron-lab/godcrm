/**
 * useResizeHandlers — Panel resize logic extracted from AIChatPanel.tsx
 * ADR-119: Handles vertical, horizontal, and sidebar resize via mouse/touch.
 */

import { useCallback, useEffect } from 'react';
import type { PanelMode, PanelTab } from '../types';

interface UseResizeHandlersParams {
  panelHeight: number | 'auto';
  panelWidth: number;
  favoriteWidth: number;
  sidebarWidth: number;
  panelMode: PanelMode;
  isGlued: boolean;
  isOpen: boolean;
  setPanelHeight: (v: number | 'auto' | ((prev: number | 'auto') => number | 'auto')) => void;
  setPanelMode: (v: PanelMode | ((prev: PanelMode) => PanelMode)) => void;
  setIsResizing: (v: boolean) => void;
  setPanelWidth: (v: number | ((prev: number) => number)) => void;
  setFavoriteWidth: (v: number | ((prev: number) => number)) => void;
  setIsResizingWidth: (v: boolean) => void;
  setIsGlued: (v: boolean | ((prev: boolean) => boolean)) => void;
  setSidebarWidth: (v: number | ((prev: number) => number)) => void;
  setIsResizingSidebar: (v: boolean) => void;
  activePanel: PanelTab;
  setActivePanel: (v: PanelTab) => void;
}

export function useResizeHandlers(params: UseResizeHandlersParams) {
  const {
    panelHeight,
    panelWidth,
    favoriteWidth,
    sidebarWidth,
    panelMode,
    isGlued,
    isOpen,
    setPanelHeight,
    setPanelMode,
    setIsResizing,
    setPanelWidth,
    setFavoriteWidth,
    setIsResizingWidth,
    setIsGlued,
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

  // Horizontal resize handler (for expanding chat left) — mouse + touch.
  //
  // Two stable states: free (panel ≤ freeMax, main visible ≥ MIN_MAIN) and
  // glued (panel = available width, main hidden). Dragging past freeMax always
  // snaps to glued — no in-between rest position, since a narrow main with
  // overflow scrollbars is worse than no main at all. With autohide sidebar
  // (sidebarPx = 0), glued means the chat fills the entire viewport.
  const MIN_PANEL = 320;
  const MIN_MAIN = 420;

  const computeWidthBounds = useCallback(() => {
    if (typeof window === 'undefined') {
      return { freeMax: MIN_PANEL, gluedMax: MIN_PANEL };
    }
    const sidebar = document.querySelector('[data-app-sidebar]') as HTMLElement | null;
    let sidebarPx = 0;
    if (sidebar) {
      // Only locked/relative sidebars take layout space; absolute (autohide) overlays.
      const cs = window.getComputedStyle(sidebar);
      if (cs.position === 'relative') sidebarPx = sidebar.offsetWidth;
    }
    const available = Math.max(MIN_PANEL, window.innerWidth - sidebarPx);
    // Panel can grow until main shrinks to MIN_MAIN — past that, snap glued.
    const freeMax = Math.max(MIN_PANEL, available - MIN_MAIN);
    const gluedMax = available;
    return { freeMax, gluedMax };
  }, []);

  // Resolve a proposed width into { width, glued } — single source of truth
  // for the "should this drag snap to glued?" decision. Drag handlers use the
  // returned `glued` flag to update isGlued state alongside panelWidth, so
  // the user's intent persists across sidebar/viewport changes.
  const resolveWidthAndIntent = useCallback((proposed: number): { width: number; glued: boolean } => {
    const { freeMax, gluedMax } = computeWidthBounds();
    // Viewport too narrow for free mode at all — always glued.
    if (freeMax <= MIN_PANEL) return { width: gluedMax, glued: true };
    if (proposed > freeMax) return { width: gluedMax, glued: true };
    return { width: Math.max(MIN_PANEL, proposed), glued: false };
  }, [computeWidthBounds]);

  const applyDrag = useCallback((proposed: number) => {
    const { width, glued } = resolveWidthAndIntent(proposed);
    setPanelWidth(width);
    setIsGlued(glued);
  }, [resolveWidthAndIntent, setPanelWidth, setIsGlued]);

  // Commit a drag's final width as the new favorite, but only when the user
  // landed in free mode at a non-min position. Glued and min positions are
  // cycle endpoints — preserving those as "favorite" would collapse the
  // 3-stop cycle to 2 stops.
  const commitFavorite = useCallback((finalProposed: number) => {
    const { width, glued } = resolveWidthAndIntent(finalProposed);
    if (!glued && width > MIN_PANEL + 16) setFavoriteWidth(width);
  }, [resolveWidthAndIntent, setFavoriteWidth]);

  const handleWidthResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingWidth(true);
    const startX = e.clientX;
    const startWidth = panelWidth;
    let lastProposed = startWidth;

    const handleMouseMove = (e: MouseEvent) => {
      lastProposed = startWidth + (startX - e.clientX);
      applyDrag(lastProposed);
    };

    const handleMouseUp = () => {
      setIsResizingWidth(false);
      commitFavorite(lastProposed);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [panelWidth, setIsResizingWidth, applyDrag, commitFavorite]);

  const handleWidthTouchResizeStart = useCallback((e: React.TouchEvent) => {
    if (!e.touches[0]) return;
    setIsResizingWidth(true);
    const startX = e.touches[0].clientX;
    const startWidth = panelWidth;
    let lastProposed = startWidth;

    const handleTouchMove = (ev: TouchEvent) => {
      if (!ev.touches[0]) return;
      ev.preventDefault();
      lastProposed = startWidth + (startX - ev.touches[0].clientX);
      applyDrag(lastProposed);
    };

    const handleTouchEnd = () => {
      setIsResizingWidth(false);
      commitFavorite(lastProposed);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchEnd);
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchcancel', handleTouchEnd);
  }, [panelWidth, setIsResizingWidth, applyDrag, commitFavorite]);

  // Cycle panel width through three stops: max (glued) → favorite → min → max.
  // Favorite = last user-dragged free-mode width. If favorite is missing/clamped
  // below the gap threshold, the cycle still works — just collapses to max↔min.
  const cycleWidth = useCallback(() => {
    const { freeMax, gluedMax } = computeWidthBounds();
    const favTarget = Math.min(Math.max(MIN_PANEL, favoriteWidth), freeMax);
    const favIsDistinct = favTarget > MIN_PANEL + 16 && freeMax > MIN_PANEL;
    if (isGlued) {
      // max → favorite (or min if favorite is degenerate)
      if (favIsDistinct) {
        setIsGlued(false);
        setPanelWidth(favTarget);
      } else {
        setIsGlued(false);
        setPanelWidth(MIN_PANEL);
      }
    } else if (panelWidth <= MIN_PANEL + 8) {
      // min → max
      setIsGlued(true);
      setPanelWidth(gluedMax);
    } else {
      // favorite (or any intermediate) → min
      setPanelWidth(MIN_PANEL);
    }
  }, [isGlued, panelWidth, favoriteWidth, computeWidthBounds, setPanelWidth, setIsGlued]);

  // Re-sync panel width whenever the layout context changes (window resize,
  // sidebar lock/width change via 'app:layout-changed' event). If the user
  // previously dragged into glued mode, keep the panel pinned to the new
  // gluedMax — that's the only way to avoid a right-side gap when the sidebar
  // collapses or the window grows. Also marks `<body data-chat-glued>` so CSS
  // can hide <main> in glued mode (its overflow:auto scrollbars would
  // otherwise bleed through at 0 px width).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => {
      // Chat is closed — panel doesn't render, so main must always be visible.
      // Without this, persisted panelWidth would still trigger the glue branch
      // below and the lingering `data-chat-glued` would hide <main> behind the
      // bubble. (Reproduces in Chrome "Desktop site" mode at ~980px width:
      // freeMax = 980 − 256 sidebar − 420 panelWidth = 304 ≤ MIN_PANEL.)
      if (!isOpen) {
        delete document.body.dataset.chatGlued;
        return;
      }
      // Mobile (<768px) uses fixed-overlay chat — no push-aside, no glue.
      // Bailing out here is critical: with viewport < MIN_PANEL+MIN_MAIN
      // (320+420=740) the freeMax≤MIN_PANEL branch would set
      // `data-chat-glued`, hiding <main> via CSS even though the chat is
      // an overlay that doesn't need main hidden.
      if (window.innerWidth < 768) {
        delete document.body.dataset.chatGlued;
        return;
      }
      const { freeMax, gluedMax } = computeWidthBounds();
      if (isGlued || freeMax <= MIN_PANEL) {
        // Keep the panel pinned to the live viewport-derived gluedMax.
        if (panelWidth !== gluedMax) setPanelWidth(gluedMax);
        if (!isGlued) setIsGlued(true);
        document.body.dataset.chatGlued = '1';
      } else {
        // Free mode: clamp into [MIN_PANEL, freeMax].
        const clamped = Math.min(Math.max(MIN_PANEL, panelWidth), freeMax);
        if (clamped !== panelWidth) setPanelWidth(clamped);
        delete document.body.dataset.chatGlued;
      }
    };
    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('app:layout-changed', sync);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('app:layout-changed', sync);
      delete document.body.dataset.chatGlued;
    };
  }, [panelWidth, isGlued, isOpen, setPanelWidth, setIsGlued, computeWidthBounds]);

  // Sidebar resize handler (between chat and sidebar) — mouse + touch.
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

  const handleSidebarTouchResizeStart = useCallback((e: React.TouchEvent) => {
    if (!e.touches[0]) return;
    setIsResizingSidebar(true);
    const startX = e.touches[0].clientX;
    const startWidth = sidebarWidth;

    const handleTouchMove = (ev: TouchEvent) => {
      if (!ev.touches[0]) return;
      ev.preventDefault();
      const delta = startX - ev.touches[0].clientX;
      const newWidth = Math.max(300, Math.min(500, startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const handleTouchEnd = () => {
      setIsResizingSidebar(false);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchEnd);
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchcancel', handleTouchEnd);
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
    handleWidthTouchResizeStart,
    handleSidebarResizeStart,
    handleSidebarTouchResizeStart,
    togglePanelMode,
    togglePanel,
    cycleWidth,
  };
}
