import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SelectEditor } from './SelectEditor';
import type { ColumnRelationConfig } from '../../types/table.types';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(multiple = false, initial = '', storageFormat: ColumnRelationConfig['storageFormat'] = 'comma') {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 60, 280, 40));
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const onSubmit = vi.fn();
  function Editor() {
    const [value, setValue] = useState(initial);
    return <form onSubmit={event => { event.preventDefault(); onSubmit(); }}>
      <SelectEditor value={value} multiple={multiple} relation={{ enabled: false, storageFormat }}
        options={[{ value: 'alpha', label: 'Альфа' }, { value: 'beta', label: 'Бета' }]}
        onChange={setValue} onCommit={onCommit} onCancel={onCancel} />
      <output aria-label="Значение">{value}</output>
    </form>;
  }
  render(<QueryClientProvider client={new QueryClient()}><Editor /></QueryClientProvider>);
  return { user: userEvent.setup(), onCommit, onCancel, onSubmit };
}

describe('SelectEditor option keyboard access', () => {
  it.each(['[Enter]', '[Space]'])('selects a single option with %s, without form submission', async key => {
    const { user, onCommit, onSubmit } = setup();
    const option = screen.getByRole('button', { name: 'Альфа' });
    act(() => screen.getByRole('textbox', { name: 'Поиск опций' }).focus());
    await user.tab();
    expect(screen.getByRole('button', { name: '— Не выбрано —' })).toHaveFocus();
    await user.tab();
    expect(option).toHaveFocus();
    await user.keyboard(key);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('alpha');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each([
    ['comma', 'alpha, legacy', 'alpha, legacy, beta', 'legacy, beta'],
    ['json', '["alpha","legacy"]', '["alpha","legacy","beta"]', '["legacy","beta"]'],
    ['semicolon', 'alpha; legacy', 'alpha; legacy; beta', 'legacy; beta'],
    ['newline', 'alpha\nlegacy', 'alpha\nlegacy\nbeta', 'legacy\nbeta'],
  ] as const)('toggles multiple options without committing or losing values (%s)', async (format, initial, added, removed) => {
    const { user, onCommit } = setup(true, initial, format);
    const beta = screen.getByRole('button', { name: 'Бета' });
    expect(beta).toHaveAttribute('aria-pressed', 'false');
    act(() => beta.focus());
    await user.keyboard('[Space]');
    expect(beta).toHaveAttribute('aria-pressed', 'true');
    expect(beta).toHaveFocus();
    expect(screen.getByLabelText('Значение')).toHaveTextContent(added.replace(/\n/g, ' '));
    act(() => screen.getByRole('button', { name: 'Альфа' }).focus());
    await user.keyboard('[Enter]');
    expect(screen.getByLabelText('Значение')).toHaveTextContent(removed.replace(/\n/g, ' '));
    expect(onCommit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Готово' }));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith();
  });

  it('uses search Enter to toggle the filtered multi-option, keeping unknown stored values', async () => {
    const { user, onCommit } = setup(true, 'alpha, legacy');
    const search = screen.getByRole('textbox', { name: 'Поиск опций' });
    await user.type(search, 'Бета{Enter}');
    expect(screen.getByLabelText('Значение')).toHaveTextContent('alpha, legacy, beta');
    await user.keyboard('[Enter]');
    expect(screen.getByLabelText('Значение')).toHaveTextContent('alpha, legacy');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('resets keyboard selection on filtering and leaves an empty multi-result unchanged', async () => {
    const { user, onCommit } = setup(true, 'legacy');
    const search = screen.getByRole('textbox', { name: 'Поиск опций' });
    await user.click(search);
    await user.keyboard('[ArrowDown]');
    await user.type(search, 'Бета{Enter}');
    expect(screen.getByLabelText('Значение')).toHaveTextContent('legacy, beta');
    await user.clear(search);
    await user.type(search, 'missing{ArrowDown}{Enter}');
    expect(screen.getByText('Ничего не найдено')).toBeVisible();
    expect(screen.getByLabelText('Значение')).toHaveTextContent('legacy, beta');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('keeps single search arrows, clear selection and outside commit working', async () => {
    const { user, onCommit } = setup(false, 'beta');
    const search = screen.getByRole('textbox', { name: 'Поиск опций' });
    await user.click(search);
    await user.keyboard('[ArrowDown][Enter]');
    expect(onCommit).toHaveBeenLastCalledWith('alpha');
    await user.keyboard('[ArrowUp][Enter]');
    expect(onCommit).toHaveBeenLastCalledWith('');
    fireEvent.mouseDown(document.body);
    expect(onCommit).toHaveBeenLastCalledWith();
  });

  it.each(['Альфа', 'Удалить Альфа', 'Готово'])('cancels from %s without committing', async name => {
    const { user, onCommit, onCancel } = setup(true, 'alpha');
    act(() => screen.getByRole('button', { name }).focus());
    await user.keyboard('[Escape]');
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
