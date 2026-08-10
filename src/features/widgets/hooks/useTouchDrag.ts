import { useState, useCallback, useRef, useEffect } from 'react';
import { logger } from '@/shared/utils/logger';

interface TouchDragState {
  isDragging: boolean;
  itemId: string | null;
  fromColumn: string | null;
  currentX: number;
  currentY: number;
  startX: number;
  startY: number;
}

interface UseTouchDragOptions {
  onMoveCard?: (cardId: string, toColumn: string) => void;
  columnSelector?: string; // CSS selector for columns
  cardSelector?: string; // CSS selector for cards
}

interface UseTouchDragReturn {
  dragState: TouchDragState;
  touchHandlers: {
    onTouchStart: (e: React.TouchEvent, itemId: string, fromColumn: string) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
  };
  getDropTargetColumn: () => string | null;
}

/**
 * Hook for touch-based drag and drop support
 * Used for kanban boards on touch devices
 */
export function useTouchDrag({ 
  onMoveCard,
  columnSelector = '[data-kanban-column]',
  cardSelector = '[data-kanban-card]'
}: UseTouchDragOptions): UseTouchDragReturn {
  const [dragState, setDragState] = useState<TouchDragState>({
    isDragging: false,
    itemId: null,
    fromColumn: null,
    currentX: 0,
    currentY: 0,
    startX: 0,
    startY: 0
  });
  
  const dragElementRef = useRef<HTMLElement | null>(null);
  const dropTargetRef = useRef<string | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent, itemId: string, fromColumn: string) => {
    // Only start drag if touch is on a card
    const touch = e.touches[0];
    const element = e.currentTarget as HTMLElement;
    
    // Store reference to the dragged element
    dragElementRef.current = element;
    
    // Get initial position
    const rect = element.getBoundingClientRect();
    
    setDragState({
      isDragging: true,
      itemId,
      fromColumn,
      currentX: touch.clientX,
      currentY: touch.clientY,
      startX: touch.clientX - rect.left,
      startY: touch.clientY - rect.top
    });
    
    // Add visual feedback
    element.style.opacity = '0.7';
    element.style.transform = 'scale(1.02)';
    element.style.zIndex = '1000';
    element.style.position = 'relative';
    
    logger.debug('[useTouchDrag] Touch start:', { itemId, fromColumn });
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragState.isDragging) return;
    
    const touch = e.touches[0];
    
    // Update position
    setDragState(prev => ({
      ...prev,
      currentX: touch.clientX,
      currentY: touch.clientY
    }));
    
    // Find column under touch point
    const elementsUnderTouch = document.elementsFromPoint(touch.clientX, touch.clientY);
    const column = elementsUnderTouch.find(el => el.matches(columnSelector));
    
    if (column) {
      const columnValue = column.getAttribute('data-column-value');
      if (columnValue && columnValue !== dropTargetRef.current) {
        // Remove highlight from previous column
        if (dropTargetRef.current) {
          const prevColumn = document.querySelector(`[data-column-value="${dropTargetRef.current}"]`);
          if (prevColumn) {
            prevColumn.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-50/10');
          }
        }
        
        // Add highlight to new column
        dropTargetRef.current = columnValue;
        column.classList.add('ring-2', 'ring-blue-500', 'bg-blue-50/10');
      }
    }
    
    // Prevent scrolling while dragging
    e.preventDefault();
  }, [dragState.isDragging, columnSelector]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!dragState.isDragging || !dragState.itemId) return;
    
    // Get final drop target
    const touch = e.changedTouches[0];
    const elementsUnderTouch = document.elementsFromPoint(touch.clientX, touch.clientY);
    const column = elementsUnderTouch.find(el => el.matches(columnSelector));
    const toColumn = column?.getAttribute('data-column-value');
    
    // Reset visual feedback
    if (dragElementRef.current) {
      dragElementRef.current.style.opacity = '';
      dragElementRef.current.style.transform = '';
      dragElementRef.current.style.zIndex = '';
      dragElementRef.current.style.position = '';
    }
    
    // Remove highlight from drop target
    if (dropTargetRef.current) {
      const prevColumn = document.querySelector(`[data-column-value="${dropTargetRef.current}"]`);
      if (prevColumn) {
        prevColumn.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-50/10');
      }
    }
    
    // Move card if dropped on different column
    if (toColumn && toColumn !== dragState.fromColumn && onMoveCard) {
      logger.debug('[useTouchDrag] Moving card:', { 
        itemId: dragState.itemId, 
        from: dragState.fromColumn, 
        to: toColumn 
      });
      onMoveCard(dragState.itemId, toColumn);
    }
    
    // Reset state
    setDragState({
      isDragging: false,
      itemId: null,
      fromColumn: null,
      currentX: 0,
      currentY: 0,
      startX: 0,
      startY: 0
    });
    
    dragElementRef.current = null;
    dropTargetRef.current = null;
  }, [dragState, onMoveCard, columnSelector]);

  const getDropTargetColumn = useCallback(() => {
    return dropTargetRef.current;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (dropTargetRef.current) {
        const column = document.querySelector(`[data-column-value="${dropTargetRef.current}"]`);
        if (column) {
          column.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-50/10');
        }
      }
    };
  }, []);

  return {
    dragState,
    touchHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd
    },
    getDropTargetColumn
  };
}
