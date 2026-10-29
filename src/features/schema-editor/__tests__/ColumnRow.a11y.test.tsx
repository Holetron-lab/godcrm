import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ColumnRow, type ColumnRowProps } from '../components/nodes/TableNodeColumnRow';

// Handles need a ReactFlow store; the row is rendered standalone here.
vi.mock('@xyflow/react', () => ({ Handle: () => null, Position: { Left: 'left', Right: 'right' } }));
vi.mock('@/shared/i18n/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${Object.values(params).join(',')}` : key), language: 'en' }),
}));

function setup(overrides: Partial<ColumnRowProps> = {}) {
  const props: ColumnRowProps = {
    column: { id: '1', name: 'name', displayName: 'Name', type: 'text', isPrimaryKey: false, isForeignKey: false, isRequired: false },
    tableId: 1, isSelected: false, linkType: 'none', isPendingConnected: false,
    rowsPreview: [{ name: 'Alice' }], onSelect: vi.fn(),
    onOpenSettings: vi.fn(), onChangeType: vi.fn(),
    ...overrides,
  };
  render(<ColumnRow {...props} />);
  return props;
}

describe('ColumnRow keyboard controls', () => {
  it('selects a column without expanding the data preview', async () => {
    const user = userEvent.setup();
    const props = setup();
    screen.getByRole('checkbox', { name: 'Select Name' }).focus();
    await user.keyboard(' ');
    expect(props.onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('opens settings and changes type using native controls', async () => {
    const user = userEvent.setup();
    const props = setup();
    screen.getByRole('button', { name: 'Open column settings: Name' }).focus();
    await user.keyboard('{Enter}');
    expect(props.onOpenSettings).toHaveBeenCalledWith(props.column);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Column type: Name' }), 'number');
    expect(props.onChangeType).toHaveBeenCalledWith(props.column, 'number');
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('expands preview; the name opens settings on Enter and copies the key on Ctrl+Enter', async () => {
    const user = userEvent.setup();
    const props = setup();
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const preview = screen.getByRole('button', { name: 'Preview Name' });
    preview.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(preview).toHaveAttribute('aria-expanded', 'true');
    const nameButton = screen.getByRole('button', { name: 'Name' });
    nameButton.focus();
    await user.keyboard('{Enter}');
    expect(props.onOpenSettings).toHaveBeenCalledWith(props.column);
    expect(copy).not.toHaveBeenCalled();
    fireEvent.click(nameButton, { ctrlKey: true });
    expect(copy).toHaveBeenCalledWith('name');
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1);
  });
});

describe('ColumnRow actions menu', () => {
  it('mirrors the universal table column menu and toggles the preview from it', async () => {
    const user = userEvent.setup();
    const props = setup({
      canReorder: true,
      onToggleVisibility: vi.fn(), onMoveUp: vi.fn(), onMoveDown: vi.fn(),
      onAddColumn: vi.fn(), onToggleReadonly: vi.fn(), onDelete: vi.fn(),
    });
    await user.click(screen.getByRole('button', { name: 'columnHeader.actions:Name' }));
    const labels = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(labels).toEqual([
      'schemaEditor.columnMenu.preview', 'columnHeader.settings', 'columnHeader.hide',
      'columnHeader.move›', 'schemaEditor.columnMenu.addAbove', 'schemaEditor.columnMenu.addBelow', 'columnHeader.readOnly', 'columnHeader.delete',
    ]);

    await user.click(screen.getByRole('menuitem', { name: 'schemaEditor.columnMenu.addBelow' }));
    expect(props.onAddColumn).toHaveBeenCalledWith('below');

    await user.click(screen.getByRole('button', { name: 'columnHeader.actions:Name' }));
    await user.click(screen.getByRole('menuitem', { name: 'schemaEditor.columnMenu.preview' }));
    expect(screen.getByText('Alice')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'columnHeader.actions:Name' }));
    await user.click(screen.getByRole('menuitem', { name: 'columnHeader.delete' }));
    expect(props.onDelete).toHaveBeenCalledWith(props.column);
    expect(screen.getByRole('button', { name: 'Open column settings: Name' })).toHaveClass('nodrag', 'cursor-grab');
  });

  it('offers only the preview when the column is not editable, and "show" for a hidden column', async () => {
    const user = userEvent.setup();
    setup({ onOpenSettings: undefined, column: { id: '0', name: 'id', displayName: 'ID', type: 'number', isPrimaryKey: true, isForeignKey: false, isRequired: true } });
    await user.click(screen.getByRole('button', { name: 'columnHeader.actions:ID' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['schemaEditor.columnMenu.preview']);
    await user.keyboard('{Escape}');

    const onToggleVisibility = vi.fn();
    setup({ onToggleVisibility, column: { id: '2', name: 'seo', displayName: 'SEO', type: 'json', isPrimaryKey: false, isForeignKey: false, isRequired: false, isVisible: false } });
    await user.click(screen.getByRole('button', { name: 'columnHeader.actions:SEO' }));
    await user.click(screen.getByRole('menuitem', { name: 'schemaEditor.columnMenu.show' }));
    expect(onToggleVisibility).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }));
  });
});
