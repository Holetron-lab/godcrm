import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextBlockSettingsPanel } from './TextBlockComponents';
import type { FormTextBlock } from '../../types/form-config.types';

afterEach(cleanup);

const block: FormTextBlock = { id: 'text-1', type: 'text', content: 'Инструкция', order: 1 };
const props = () => ({
  block, onUpdate: vi.fn(), onDelete: vi.fn(), onMoveUp: vi.fn(),
  onMoveDown: vi.fn(), onClose: vi.fn(), canMoveUp: true, canMoveDown: true,
});

describe('TextBlockSettingsPanel accessibility', () => {
  it('names the close action and associates each editor with its own visible label', () => {
    const first = props();
    render(<><TextBlockSettingsPanel {...first} /><TextBlockSettingsPanel {...props()} block={{ ...block, id: 'text-2', contentType: 'html' }} /></>);
    const markdown = screen.getByRole('textbox', { name: 'Содержимое (Markdown)' });
    const html = screen.getByRole('textbox', { name: 'Содержимое (HTML)' });
    expect(markdown.id).not.toBe(html.id);
    fireEvent.change(markdown, { target: { value: 'Новая инструкция' } });
    expect(first.onUpdate).toHaveBeenCalledWith({ content: 'Новая инструкция' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Закрыть настройки текстового блока' })[0]);
    expect(first.onClose).toHaveBeenCalledOnce();
  });

  it('exposes the default and changed width as a pressed button', () => {
    const callbacks = props();
    const { rerender } = render(<TextBlockSettingsPanel {...callbacks} />);
    const widths = within(screen.getByRole('group', { name: 'Ширина' }));
    expect(widths.getByRole('button', { name: '100%', pressed: true })).toBeInTheDocument();
    fireEvent.click(widths.getByRole('button', { name: '50%', pressed: false }));
    expect(callbacks.onUpdate).toHaveBeenCalledWith({ width: 'half' });
    rerender(<TextBlockSettingsPanel {...callbacks} block={{ ...block, width: 'half' }} />);
    expect(widths.getByRole('button', { name: '50%', pressed: true })).toBeInTheDocument();
    expect(widths.getAllByRole('button', { pressed: true })).toHaveLength(1);
  });

  it('keeps all button actions from submitting the surrounding form', async () => {
    const user = userEvent.setup();
    const callbacks = props();
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<form onSubmit={submit}><TextBlockSettingsPanel {...callbacks} /></form>);
    for (const button of screen.getAllByRole('button')) await user.click(button);
    expect(submit).not.toHaveBeenCalled();
    for (const action of [callbacks.onMoveUp, callbacks.onMoveDown, callbacks.onDelete, callbacks.onClose]) {
      expect(action).toHaveBeenCalledOnce();
    }
  });

  it('applies order once with Enter without submitting the form', async () => {
    const user = userEvent.setup();
    const callbacks = props();
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<form onSubmit={submit}><TextBlockSettingsPanel {...callbacks} /></form>);
    const order = screen.getByRole('spinbutton');
    await user.clear(order);
    await user.type(order, '3{Enter}');
    expect(callbacks.onUpdate).toHaveBeenCalledExactlyOnceWith({ order: 3 });
    expect(submit).not.toHaveBeenCalled();
  });

  it('preserves disabled movement and content-type updates', () => {
    const callbacks = props();
    render(<TextBlockSettingsPanel {...callbacks} canMoveUp={false} canMoveDown={false} />);
    for (const name of ['Переместить вверх', 'Переместить вниз']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(callbacks.onMoveUp).not.toHaveBeenCalled();
    expect(callbacks.onMoveDown).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Тип контента' }), { target: { value: 'html' } });
    expect(callbacks.onUpdate).toHaveBeenCalledExactlyOnceWith({ contentType: 'html' });
  });
});
