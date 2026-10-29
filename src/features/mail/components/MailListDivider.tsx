import { useCallback, type RefObject } from 'react';
import { useLanguage } from '@/shared/i18n/LanguageContext';

// Resizable list-column bounds (px). Default matches the old fixed w-72 (288px)
// so nothing shifts on first paint.
export const LIST_WIDTH_DEFAULT = 288;
const LIST_WIDTH_MIN = 220;
const LIST_WIDTH_MAX = 560;

interface MailListDividerProps {
  paneRef: RefObject<HTMLDivElement>;
  listWidth: number;
  setListWidth: (width: number) => void;
}

export function MailListDivider({ paneRef, listWidth, setListWidth }: MailListDividerProps) {
  const { t } = useLanguage();
  // Drag the full-height divider to resize the list column.
  const onDividerDrag = useCallback((e: React.MouseEvent) => {
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
  }, [paneRef, setListWidth]);

  /* Full-height divider between the list column and the preview/reading
      pane. Draggable to resize the list column; sits above the reading pane
      (z-20) so you can resize while a message is open. */
  return (
    <div
      role="slider"
      aria-orientation="horizontal"
      aria-label={t('mail.page.resizeList')}
      tabIndex={0}
      aria-valuemin={LIST_WIDTH_MIN}
      aria-valuemax={LIST_WIDTH_MAX}
      aria-valuenow={listWidth}
      aria-valuetext={`${listWidth} px`}
      onKeyDown={(e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const next = e.key === 'Home' ? LIST_WIDTH_MIN : e.key === 'End' ? LIST_WIDTH_MAX
          : listWidth + (e.key === 'ArrowRight' ? 20 : -20);
        setListWidth(Math.min(LIST_WIDTH_MAX, Math.max(LIST_WIDTH_MIN, next)));
      }}
      onMouseDown={onDividerDrag}
      className="group absolute inset-y-0 z-20 -ml-1 hidden w-2 cursor-col-resize focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary-500)] md:block"
      style={{ left: listWidth }}
    >
      <span className="mx-auto block h-full w-px bg-[var(--border-primary)] transition-colors group-hover:bg-[var(--color-primary-500)]" />
    </div>
  );
}
