import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { RowPositionBar } from '../RowPositionBar';
import type { PaginationInfo } from '../../UniversalTable/types';

// Pages 3–4 of a 1000-row table are loaded: rows 101–200.
const pagination: PaginationInfo = {
  rowsCount: 100, rowsLimit: 50, currentPage: 4, totalPages: 20, totalRows: 1000, canLoadMore: true, minLoadedPage: 3,
};

const makeContainer = ({ scrollTop = 0, scrollHeight = 2000, clientHeight = 500 } = {}) => {
  const element = document.createElement('div');
  Object.defineProperties(element, {
    scrollTop: { value: scrollTop, writable: true },
    scrollHeight: { value: scrollHeight },
    clientHeight: { value: clientHeight },
  });
  element.scrollTo = vi.fn();
  return element;
};

const setup = ({ blocked = false, container = makeContainer(), info = pagination } = {}) => {
  const onGoToRow = vi.fn();
  render(
    <LanguageProvider>
      <RowPositionBar pagination={info} scrollContainerRef={{ current: container }} blocked={blocked} onGoToRow={onGoToRow} />
    </LanguageProvider>
  );
  const slider = screen.queryByRole('slider', { name: 'Position in table' });
  if (slider) slider.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect;
  return { onGoToRow, slider, container };
};

beforeEach(() => localStorage.setItem('god-crm-language', 'en'));
afterEach(() => localStorage.removeItem('god-crm-language'));

describe('RowPositionBar', () => {
  it('keeps a fixed short width instead of stretching with the row-count column', () => {
    const { slider } = setup();
    expect(slider).toHaveClass('w-16', 'self-start');
  });

  it('reports the visible rows in table numbering, offset by the loaded window', () => {
    const { slider } = setup();
    expect(slider).toHaveAttribute('aria-valuenow', '101');
    expect(slider).toHaveAttribute('aria-valuemax', '1000');
    expect(slider).toHaveAttribute('aria-valuetext', 'Rows 101–125 of 1,000');
    expect(screen.getByTestId('row-position-window').style.width).toBe('10%');
    expect(screen.getByTestId('row-position-thumb').style.width).toBe('2.5%');
  });

  it('follows the scroll of the container', () => {
    const { slider, container } = setup();
    container.scrollTop = 1500;
    fireEvent.scroll(container);
    expect(slider).toHaveAttribute('aria-valuetext', 'Rows 176–200 of 1,000');
  });

  it('jumps to the row under the pointer', () => {
    const { slider, onGoToRow } = setup();
    fireEvent.click(slider!, { clientX: 100 });
    expect(onGoToRow).toHaveBeenCalledWith(501);
  });

  it.each([
    ['Home', 1],
    ['End', 1000],
    ['ArrowRight', 126],
    ['PageUp', 76],
  ])('moves with %s', (key, row) => {
    const { slider, onGoToRow } = setup();
    fireEvent.keyDown(slider!, { key });
    expect(onGoToRow).toHaveBeenCalledWith(row);
  });

  it('only scrolls the loaded rows while a filter is active', () => {
    const container = makeContainer({ scrollTop: 500 });
    const { slider, onGoToRow } = setup({ blocked: true, container });
    expect(slider).toHaveAttribute('aria-valuetext', '25%');
    expect(screen.queryByTestId('row-position-window')).toBeNull();
    fireEvent.click(slider!, { clientX: 100 });
    expect(onGoToRow).not.toHaveBeenCalled();
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 750 });
  });

  it('renders nothing when the whole table is loaded and fits on screen', () => {
    const info = { ...pagination, rowsCount: 40, totalRows: 40, totalPages: 1, minLoadedPage: 1, canLoadMore: false };
    const { slider } = setup({ info, container: makeContainer({ scrollHeight: 400 }) });
    expect(slider).toBeNull();
  });
});
