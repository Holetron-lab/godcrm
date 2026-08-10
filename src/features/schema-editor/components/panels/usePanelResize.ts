/**
 * usePanelResize - Resizable panel state (drag-to-resize horizontal width)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_WIDTH, MAX_WIDTH, MIN_WIDTH } from './navTreeTypes';

export const usePanelResize = () => {
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !panelRef.current) return;
      const rect = panelRef.current.getBoundingClientRect();
      const newWidth = e.clientX - rect.left;
      setPanelWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  return {
    panelRef,
    panelWidth,
    isResizing,
    handleMouseDown,
  };
};
