/* Scrollable regions need focus and keyboard handling so users can read overflow without a mouse.
   They remain groups because their rendered markdown can contain links and checkboxes. */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
import { useEffect, useRef, useState, type ReactNode } from 'react';

interface ScrollableTextCellProps {
  height?: number;
  minHeight?: number;
  maxHeight?: number;
  align?: 'left' | 'center' | 'right';
  /** Accessible name of the scroll region; defaults to the text-cell label. */
  label?: string;
  /** Keep a bottom gutter under the text for the scroll control (default); off when the child pins its own bottom bar. */
  reserveScrollControl?: boolean;
  children: ReactNode;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onEdit?: () => void;
}

export function ScrollableTextCell({ height, minHeight, maxHeight, align, label = 'Текст ячейки', reserveScrollControl = true, children, onClick, onEdit }: ScrollableTextCellProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const held = useRef(false);
  const [active, setActive] = useState(false);
  const release = () => { held.current = false; setActive(false); };

  useEffect(() => {
    const content = contentRef.current;
    const text = textRef.current;
    if (!content || !text) return;
    const measure = () => {
      const overflowing = content.scrollHeight > content.clientHeight;
      setHasOverflow(overflowing);
      if (!overflowing) {
        held.current = false;
        setActive(false);
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    observer.observe(text);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) return; // Preserve browser pinch/zoom.
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? content.clientHeight : 1;
      if (held.current) {
        event.preventDefault();
        event.stopPropagation();
        content.scrollTop += event.deltaY * scale;
        return;
      }
      // The scrollbar stays draggable, while an ordinary wheel scrolls the table.
      let parent = container.parentElement;
      while (parent) {
        const style = getComputedStyle(parent);
        const vertical = event.deltaY !== 0 && /auto|scroll/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight;
        const horizontal = event.deltaX !== 0 && /auto|scroll/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth;
        if (vertical || horizontal) {
          event.preventDefault();
          parent.scrollTop += event.deltaY * scale;
          parent.scrollLeft += event.deltaX * scale;
          return;
        }
        parent = parent.parentElement;
      }
      event.preventDefault();
      window.scrollBy(event.deltaX * scale, event.deltaY * scale);
    };
    container.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('blur', release);
    return () => {
      container.removeEventListener('wheel', wheel);
      window.removeEventListener('blur', release);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative w-full" style={{ height, textAlign: align }}>
      <div
        ref={contentRef}
        tabIndex={0}
        role="group"
        aria-label={label}
        className={`h-full w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words px-4 pt-2 ${reserveScrollControl ? 'pb-7' : 'pb-0'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary-500)]`}
        style={{ height, minHeight, maxHeight, scrollbarGutter: 'stable' }}
        onClick={onClick}
        onDoubleClick={(event) => { event.stopPropagation(); onEdit?.(); }}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === 'F2') && event.target === event.currentTarget && onEdit) {
            event.preventDefault();
            onEdit();
          }
        }}
      ><div ref={textRef} className="flow-root">{children}</div></div>
      {hasOverflow && <button
        type="button"
        aria-label="Удерживайте для прокрутки ячейки колёсиком"
        title="Удерживайте кнопку мышью или пробелом и прокручивайте колёсико"
        aria-pressed={active}
        className="absolute bottom-0 right-4 flex h-6 w-6 items-center justify-center rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary-500)]"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          held.current = true;
          setActive(true);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onBlur={release}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            held.current = true;
            setActive(true);
          }
        }}
        onKeyUp={release}
      ><span aria-hidden="true">↕</span></button>}
    </div>
  );
}
