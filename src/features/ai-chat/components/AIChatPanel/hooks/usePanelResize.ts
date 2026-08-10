/**
 * usePanelResize Hook
 * Handles panel resizing logic extracted from AIChatPanel
 */

import { useState, useCallback, useEffect } from 'react';

interface UsePanelResizeOptions {
  initialPanelWidth?: number;
  initialSidebarWidth?: number;
  initialPanelHeight?: number | 'auto';
  minPanelWidth?: number;
  maxPanelWidth?: number;
  minSidebarWidth?: number;
  maxSidebarWidth?: number;
}

export function usePanelResize({
  initialPanelWidth = 420,
  initialSidebarWidth = 256,
  initialPanelHeight = 'auto',
  minPanelWidth = 320,
  maxPanelWidth = 1170,
  minSidebarWidth = 180,
  maxSidebarWidth = 400
}: UsePanelResizeOptions = {}) {
  const [panelWidth, setPanelWidthState] = useState(initialPanelWidth);
  const [sidebarWidth, setSidebarWidthState] = useState(initialSidebarWidth);
  const [panelHeight, setPanelHeight] = useState<number | 'auto'>(initialPanelHeight);
  const [isResizing, setIsResizing] = useState(false);
  const [isResizingWidth, setIsResizingWidth] = useState(false);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  // Constrain panel width within limits
  const setPanelWidth = useCallback((width: number) => {
    const constrainedWidth = Math.max(minPanelWidth, Math.min(maxPanelWidth, width));
    setPanelWidthState(constrainedWidth);
  }, [minPanelWidth, maxPanelWidth]);

  // Constrain sidebar width within limits
  const setSidebarWidth = useCallback((width: number) => {
    const constrainedWidth = Math.max(minSidebarWidth, Math.min(maxSidebarWidth, width));
    setSidebarWidthState(constrainedWidth);
  }, [minSidebarWidth, maxSidebarWidth]);

  // Start resizing panel width
  const startResizingWidth = useCallback(() => {
    setIsResizingWidth(true);
    
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX;
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingWidth(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [setPanelWidth]);

  // Start resizing sidebar width
  const startResizingSidebar = useCallback(() => {
    setIsResizingSidebar(true);
    
    const handleMouseMove = (e: MouseEvent) => {
      const rect = e.currentTarget as Element;
      const newWidth = (rect as HTMLElement)?.offsetWidth - (e.clientX - (rect as HTMLElement)?.offsetLeft) || sidebarWidth;
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [setSidebarWidth, sidebarWidth]);

  // Start resizing panel height
  const startResizing = useCallback(() => {
    setIsResizing(true);
    
    const handleMouseMove = (e: MouseEvent) => {
      const newHeight = window.innerHeight - e.clientY;
      setPanelHeight(Math.max(200, Math.min(window.innerHeight - 100, newHeight)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, []);

  // Cleanup event listeners on unmount
  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', () => {});
      window.removeEventListener('mouseup', () => {});
    };
  }, []);

  return {
    panelWidth,
    sidebarWidth,
    panelHeight,
    isResizing,
    isResizingWidth,
    isResizingSidebar,
    setPanelWidth,
    setSidebarWidth,
    setPanelHeight,
    startResizing,
    startResizingWidth,
    startResizingSidebar
  };
}