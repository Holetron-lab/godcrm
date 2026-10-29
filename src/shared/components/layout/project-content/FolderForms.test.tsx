import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InlineCreateFolder, InlineEditFolder } from './FolderForms';

afterEach(cleanup);

describe('folder form focus', () => {
  it('focuses the name on each opening without stealing focus during editing', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onClose = vi.fn();
    const view = (isOpen: boolean) => <InlineCreateFolder isOpen={isOpen} onCreate={onCreate} onClose={onClose} />;
    const { rerender } = render(view(false));
    rerender(view(true));
    const name = screen.getByRole('textbox', { name: 'Folder name' });
    expect(name).toHaveFocus();
    await user.type(name, 'Reports');
    await user.click(screen.getByTitle('Emoji icon'));
    await user.keyboard('a');
    expect(screen.getByTitle('Emoji icon')).toHaveFocus();
    await user.click(name);
    await user.keyboard('{Enter}');
    expect(onCreate).toHaveBeenCalledWith('Reports', '📁a');
    expect(onClose).toHaveBeenCalledOnce();
    rerender(view(false));
    rerender(view(true));
    expect(screen.getByRole('textbox', { name: 'Folder name' })).toHaveFocus();
  });

  it('returns focus to the name after cancelling deletion and preserves keyboard save', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onDelete = vi.fn();
    render(<InlineEditFolder folder={{ id: 'folder-1', name: 'Reports', items: [], isExpanded: true }}
      onSave={onSave} onClose={vi.fn()} onDelete={onDelete} />);
    expect(screen.getByRole('textbox', { name: 'Folder name' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const name = screen.getByRole('textbox', { name: 'Folder name' });
    expect(name).toHaveFocus();
    await user.clear(name);
    await user.type(name, 'Renamed{Enter}');
    expect(onSave).toHaveBeenCalledWith('folder-1', 'Renamed', '📁');
    expect(onDelete).not.toHaveBeenCalled();
  });
});
