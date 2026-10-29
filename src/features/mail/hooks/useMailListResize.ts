import { useCallback, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';

// Resizable list-column bounds (px). Default matches the old fixed w-72 (288px)
// so nothing shifts on first paint.
const LIST_WIDTH_DEFAULT = 288;
const LIST_WIDTH_MIN = 220;
const LIST_WIDTH_MAX = 560;

/** Pointer and keyboard resizing share the same list-width state and bounds. */
export function useMailListResize() {
  // Width of the left message-list column, in px. The full-height divider drags
  // this; the reading pane's left edge follows it so the two stay aligned.
  const [listWidth, setListWidth] = useState(LIST_WIDTH_DEFAULT);
  const paneRef = useRef<HTMLDivElement>(null);

  // Drag the full-height divider to resize the list column.
  const onDividerDrag = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    const rect = paneRef.current?.getBoundingClientRect();
    if (!rect) return;
    const move = (ev: MouseEvent) => {
      const next = Math.min(LIST_WIDTH_MAX, Math.max(LIST_WIDTH_MIN, ev.clientX - rect.left));
      setListWidth(next);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.userSelect = '';
    };
    // Kill text selection while dragging.
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, []);

  return {
    listWidth, paneRef,
    dividerProps: {
      'aria-valuemin': LIST_WIDTH_MIN,
      'aria-valuemax': LIST_WIDTH_MAX,
      'aria-valuetext': `${listWidth} px`,
      onKeyDown: (e: KeyboardEvent) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const next = e.key === 'Home' ? LIST_WIDTH_MIN : e.key === 'End' ? LIST_WIDTH_MAX
          : listWidth + (e.key === 'ArrowRight' ? 20 : -20);
        setListWidth(Math.min(LIST_WIDTH_MAX, Math.max(LIST_WIDTH_MIN, next)));
      },
      onMouseDown: onDividerDrag,
    },
  };
}
