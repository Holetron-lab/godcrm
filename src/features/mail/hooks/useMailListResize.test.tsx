import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useMailListResize } from './useMailListResize';

function ListPane() {
  const { listWidth, paneRef, dividerProps } = useMailListResize();
  return <div ref={paneRef} data-testid="pane"><div role="slider" aria-valuenow={listWidth} {...dividerProps} /></div>;
}

it('clamps pointer resizing relative to the pane and releases the drag on mouseup', () => {
  render(<ListPane />);
  vi.spyOn(screen.getByTestId('pane'), 'getBoundingClientRect').mockReturnValue({ left: 100 } as DOMRect);
  const divider = screen.getByRole('slider');
  expect(divider).toHaveAttribute('aria-valuenow', '288');
  fireEvent.mouseDown(divider);
  expect(document.body.style.userSelect).toBe('none');
  fireEvent.mouseMove(document, { clientX: 500 });
  expect(divider).toHaveAttribute('aria-valuenow', '400');
  fireEvent.mouseMove(document, { clientX: 0 });
  expect(divider).toHaveAttribute('aria-valuenow', '220');
  fireEvent.mouseMove(document, { clientX: 1000 });
  expect(divider).toHaveAttribute('aria-valuenow', '560');
  fireEvent.mouseUp(document);
  expect(document.body.style.userSelect).toBe('');
  fireEvent.mouseMove(document, { clientX: 400 });
  expect(divider).toHaveAttribute('aria-valuenow', '560');
});
