import { useEffect, useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { PaginationInfo } from '../UniversalTable/types';

interface RowPositionBarProps {
  pagination: PaginationInfo;
  scrollContainerRef: RefObject<HTMLElement | null>;
  /** With a search or filter active the loaded rows no longer map to table row numbers: the bar then only tracks the scroll. */
  blocked: boolean;
  onGoToRow: (rowNumber: number) => void;
}

/** Fractions (0..1) of the scrollable content currently in view. */
interface Viewport {
  top: number;
  size: number;
}

const readViewport = (element: HTMLElement | null): Viewport => {
  if (!element || element.scrollHeight <= 0) return { top: 0, size: 1 };
  return {
    top: element.scrollTop / element.scrollHeight,
    size: Math.min(1, element.clientHeight / element.scrollHeight),
  };
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const percent = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;
const BACKWARD_KEYS = ['ArrowLeft', 'ArrowUp', 'PageUp'];
const FORWARD_KEYS = ['ArrowRight', 'ArrowDown', 'PageDown'];

/** Thin strip under the row count: the loaded window and the visible rows as fractions of the whole table. Click or arrow keys jump. */
export const RowPositionBar = ({ pagination, scrollContainerRef, blocked, onGoToRow }: RowPositionBarProps) => {
  const { t, language } = useLanguage();
  const [viewport, setViewport] = useState<Viewport>(() => readViewport(scrollContainerRef.current));

  // Scroll moves the thumb; a change in loaded rows changes the content height, so re-read then too.
  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element) return;
    const update = () => setViewport(readViewport(element));
    update();
    element.addEventListener('scroll', update, { passive: true });
    return () => element.removeEventListener('scroll', update);
  }, [scrollContainerRef, pagination]);

  const { totalRows, rowsLimit, rowsCount, minLoadedPage } = pagination;
  // The loaded window as a fraction of the whole table; blocked = the loaded rows are the whole track.
  const windowStart = blocked ? 0 : ((minLoadedPage - 1) * rowsLimit) / totalRows;
  const windowSize = blocked ? 1 : Math.min(1 - windowStart, rowsCount / totalRows);
  const thumbStart = windowStart + viewport.top * windowSize;
  const thumbSize = viewport.size * windowSize;

  // Everything is loaded and fits on screen: nothing to point at.
  if (thumbSize >= 1) return null;

  const firstRow = Math.min(totalRows, Math.floor(thumbStart * totalRows) + 1);
  const lastRow = Math.min(totalRows, Math.max(firstRow, Math.ceil((thumbStart + thumbSize) * totalRows)));
  const scrollPercent = Math.round(thumbStart * 100);
  const valueText = blocked
    ? `${scrollPercent}%`
    : t('table.rowsVisible', {
        from: firstRow.toLocaleString(language),
        to: lastRow.toLocaleString(language),
        total: totalRows.toLocaleString(language),
      });

  const jumpTo = (fraction: number) => {
    const target = clamp01(fraction);
    if (blocked) {
      const element = scrollContainerRef.current;
      element?.scrollTo({ top: target * element.scrollHeight - element.clientHeight / 2 });
      return;
    }
    onGoToRow(Math.min(totalRows, Math.floor(target * totalRows) + 1));
  };

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    jumpTo((event.clientX - rect.left) / rect.width);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Home') jumpTo(0);
    else if (event.key === 'End') jumpTo(1);
    else if (BACKWARD_KEYS.includes(event.key)) jumpTo(thumbStart - thumbSize);
    else if (FORWARD_KEYS.includes(event.key)) jumpTo(thumbStart + thumbSize);
    else return;
    event.preventDefault();
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={t('table.tablePosition')}
      aria-orientation="horizontal"
      aria-valuemin={blocked ? 0 : 1}
      aria-valuemax={blocked ? 100 : totalRows}
      aria-valuenow={blocked ? scrollPercent : firstRow}
      aria-valuetext={valueText}
      title={valueText}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      // Fixed width: the parent column widens when the go-to-row input opens, and the bar must not stretch with it.
      className="w-16 self-start mx-1.5 py-1 rounded cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]"
    >
      <div className="relative h-1 rounded-full bg-[var(--bg-tertiary)]">
        {windowSize < 1 && (
          <div
            data-testid="row-position-window"
            className="absolute inset-y-0 rounded-full bg-[var(--color-primary-200)]"
            style={{ left: `min(${percent(windowStart)}, calc(100% - 4px))`, width: percent(windowSize), minWidth: 4 }}
          />
        )}
        <div
          data-testid="row-position-thumb"
          className="absolute inset-y-0 rounded-full bg-[var(--color-primary-500)]"
          style={{ left: `min(${percent(thumbStart)}, calc(100% - 4px))`, width: percent(thumbSize), minWidth: 4 }}
        />
      </div>
    </div>
  );
};
