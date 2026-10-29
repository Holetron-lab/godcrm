import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ScrollableTextCell } from '../ScrollableTextCell';

let resize: () => void;
let contentHeight: number;
let viewportHeight: number;
const disconnect = vi.fn();

beforeEach(() => {
  contentHeight = 80;
  viewportHeight = 120;
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => contentHeight);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => viewportHeight);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('hides the scroll control when content fits, including an exact fit', () => {
  render(<ScrollableTextCell height={120}>Short text</ScrollableTextCell>);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  contentHeight = viewportHeight;
  act(() => resize());
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('updates the control when content or the viewport changes and disconnects on unmount', () => {
  contentHeight = 300;
  const { unmount } = render(<ScrollableTextCell height={120}>Long text</ScrollableTextCell>);
  expect(screen.getByRole('button')).toBeInTheDocument();
  viewportHeight = 320;
  act(() => resize());
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  viewportHeight = 120;
  act(() => resize());
  expect(screen.getByRole('button')).toBeInTheDocument();
  contentHeight = 80;
  act(() => resize());
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  unmount();
  expect(disconnect).toHaveBeenCalled();
});

it('names the scroll region after the label when one is given', () => {
  render(<ScrollableTextCell height={120} label="images">Gallery</ScrollableTextCell>);
  expect(screen.getByRole('group', { name: 'images' })).toBeInTheDocument();
});
