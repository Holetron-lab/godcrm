import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DividerPreview } from './DividerPreview';

afterEach(cleanup);

function props() {
  return {
    isSelected: false,
    onClick: vi.fn(),
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
    onDelete: vi.fn(),
    canMoveUp: true,
    canMoveDown: true,
  };
}

describe('DividerPreview controls', () => {
  it('exposes selection and keeps actions separate without submitting the form', () => {
    const callbacks = props();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const { container, rerender } = render(<form onSubmit={onSubmit}><DividerPreview {...callbacks} /></form>);
    const select = screen.getByRole('button', { name: 'Выбрать разделитель' });
    expect(select.tagName).toBe('BUTTON');
    expect(select).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(select);
    fireEvent.click(screen.getByRole('button', { name: 'Переместить вверх' }));
    fireEvent.click(screen.getByRole('button', { name: 'Переместить вниз' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить разделитель' }));
    expect(callbacks.onClick).toHaveBeenCalledTimes(1);
    expect(callbacks.onMoveUp).toHaveBeenCalledTimes(1);
    expect(callbacks.onMoveDown).toHaveBeenCalledTimes(1);
    expect(callbacks.onDelete).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.querySelector('button button, button input')).toBeNull();
    rerender(<DividerPreview {...callbacks} isPageBreak isSelected />);
    expect(screen.getByRole('button', { name: 'Выбрать: Новая страница' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Удалить разрыв страницы' })).toBeInTheDocument();
  });

  it('preserves disabled movement and applies the order independently of selection', () => {
    const callbacks = props();
    const onOrderChange = vi.fn();
    render(<DividerPreview {...callbacks} canMoveUp={false} canMoveDown={false} order={2} onOrderChange={onOrderChange} />);
    for (const name of ['Переместить вверх', 'Переместить вниз']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name }));
    }
    const order = screen.getByRole('spinbutton', { name: 'Порядок (Enter для применения)' });
    fireEvent.change(order, { target: { value: '3' } });
    fireEvent.blur(order);
    expect(onOrderChange).toHaveBeenCalledWith(3);
    expect(callbacks.onClick).not.toHaveBeenCalled();
    expect(callbacks.onMoveUp).not.toHaveBeenCalled();
    expect(callbacks.onMoveDown).not.toHaveBeenCalled();
  });

  it('keeps preview dividers inert and hides preview page breaks', () => {
    const { container, rerender } = render(<DividerPreview {...props()} isPreviewMode />);
    expect(container).not.toBeEmptyDOMElement();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<DividerPreview {...props()} isPreviewMode isPageBreak />);
    expect(container).toBeEmptyDOMElement();
  });
});
