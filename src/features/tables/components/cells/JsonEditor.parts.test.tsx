import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdderRow, FormNode, TreeNode } from './JsonEditor.parts';

afterEach(cleanup);

describe('JSON editor focus', () => {
  it.each([false, true])('focuses the new entry control (array=%s) without stealing focus on change', async (isArray) => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<AdderRow isArray={isArray} existingKeys={[]} onAdd={onAdd} onCancel={vi.fn()} indent={0} />);
    expect(isArray ? screen.getByRole('combobox') : screen.getByRole('textbox')).toHaveFocus();
    if (!isArray) await user.type(screen.getByRole('textbox'), 'newKey');
    const type = screen.getByRole('combobox');
    await user.selectOptions(type, 'number');
    expect(type).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    expect(onAdd).toHaveBeenCalledWith('number', isArray ? undefined : 'newKey');
  });

  it.each(['tree', 'form'])('focuses rename and preserves save/cancel in %s mode', async (mode) => {
    const user = userEvent.setup();
    const mutate = { setAt: vi.fn(), deleteAt: vi.fn(), renameKey: vi.fn() };
    render(mode === 'tree'
      ? <TreeNode value="value" keyName="key" path={['key']} parentIsArray={false} depth={0} mutate={mutate} />
      : <FormNode value={{ key: 'value' }} path={[]} depth={0} mutate={mutate} />);
    await user.dblClick(screen.getByTitle('Double-click для переименования'));
    let input = screen.getByRole('textbox', { name: 'Имя ключа' });
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, 'renamed{Enter}');
    expect(mutate.renameKey).toHaveBeenCalledWith([], 'key', 'renamed');
    mutate.renameKey.mockClear();
    await user.dblClick(screen.getByTitle('Double-click для переименования'));
    input = screen.getByRole('textbox', { name: 'Имя ключа' });
    await user.clear(input);
    await user.type(input, 'cancelled{Escape}');
    expect(mutate.renameKey).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Имя ключа' })).not.toBeInTheDocument();
  });
});
