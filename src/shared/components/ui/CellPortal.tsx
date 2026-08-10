/**
 * CellPortal — viewport-aware portal for table cell editor dropdowns.
 *
 * Renders an invisible trigger div (absolute inset-0) to measure the parent
 * cell position, then portals children into document.body with proper
 * viewport boundary detection (top, bottom, left, right).
 *
 * Dropdown stays within 5px of header/status bar and viewport edges.
 */

import { useState, useCallback, forwardRef, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

// Safe zones (pixels from viewport edges)
const HEADER_HEIGHT = 48;
const BOTTOM_SAFE = 37;
const EDGE_MARGIN = 5;

/**
 * Calculate viewport-aware position for a cell dropdown portal.
 * Prefers placing below the trigger; flips above if insufficient space.
 * Constrains horizontally within viewport bounds.
 */
export function calcCellPortalPosition(
  triggerRect: DOMRect,
  dropdownWidth: number,
  dropdownMaxHeight: number
): { top: number; left: number } {
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const safeTop = HEADER_HEIGHT + EDGE_MARGIN;
  const safeBottom = vh - BOTTOM_SAFE - EDGE_MARGIN;

  // Vertical: prefer below trigger (from bottom of row)
  let top = triggerRect.bottom;
  if (top + dropdownMaxHeight > safeBottom) {
    // Flip above: dropdown bottom edge aligns with bottom of row
    const aboveTop = triggerRect.bottom - dropdownMaxHeight;
    top = aboveTop >= safeTop ? aboveTop : safeTop;
  }

  // Horizontal: constrain to viewport
  let left = triggerRect.left;
  if (left + dropdownWidth > vw - EDGE_MARGIN) {
    left = vw - dropdownWidth - EDGE_MARGIN;
  }
  if (left < EDGE_MARGIN) left = EDGE_MARGIN;

  return {
    top: top + window.scrollY,
    left: left + window.scrollX,
  };
}

interface CellPortalProps {
  children: ReactNode;
  width?: number;
  maxHeight?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * @example
 * <CellPortal ref={containerRef} width={280} maxHeight={300}
 *   className="bg-[var(--bg-primary)] rounded-lg shadow-xl border border-[var(--border-primary)]">
 *   <DropdownContent />
 * </CellPortal>
 */
export const CellPortal = forwardRef<HTMLDivElement, CellPortalProps>(
  ({ children, width = 280, maxHeight = 300, className = '', style }, ref) => {
    const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

    const triggerRefCallback = useCallback(
      (node: HTMLDivElement | null) => {
        if (!node || position) return;
        const td = node.closest('td');
        const rect = td ? td.getBoundingClientRect() : node.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        setPosition(calcCellPortalPosition(rect, width, maxHeight));
      },
      [position, width, maxHeight]
    );

    const portalContent = position ? (
      <div
        ref={ref}
        className={`fixed z-[9999] ${className}`}
        style={{
          top: position.top,
          left: position.left,
          width: `${width}px`,
          maxHeight: `${maxHeight}px`,
          ...style,
        }}
      >
        {children}
      </div>
    ) : null;

    return (
      <>
        <div ref={triggerRefCallback} className="absolute inset-0 pointer-events-none" />
        {portalContent && createPortal(portalContent, document.body)}
      </>
    );
  }
);
CellPortal.displayName = 'CellPortal';
