import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FieldPreviewEditor } from './FieldPreviewEditor';
import { FieldPreviewReadonly } from './FieldPreviewReadonly';
import type { ColumnModel } from '../../types/table.types';
import type { FormField } from '../../types/form-config.types';

const column: ColumnModel = { id: 'name', tableId: '1', name: 'name', displayName: 'Name', type: 'text', config: {}, isRequired: false, isReadonly: false, orderIndex: 0, width: 200, isVisible: true };
const field: FormField = { id: 'name', columnId: 'name', label: 'Display name', width: 'half', order: 0 };
afterEach(cleanup);

describe('field previews', () => {
  it('names the editor preview and selects it with Enter and Space', () => {
    const onClick = vi.fn();
    render(<FieldPreviewEditor field={field} column={column} viewMode="standard" isSelected={false} onClick={onClick} />);
    expect(screen.getByLabelText('Display name')).toBeDisabled();
    const button = screen.getByRole('button', { name: 'Выбрать поле: Display name' });
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.keyDown(button, { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('keeps label associations unique when the same preview is mounted twice', () => {
    render(<><FieldPreviewReadonly field={field} column={column} viewMode="standard" /><FieldPreviewReadonly field={field} column={column} viewMode="standard" /></>);
    const inputs = screen.getAllByLabelText('Display name');
    expect(inputs).toHaveLength(2);
    expect(inputs[0].id).not.toBe(inputs[1].id);
  });

  it('handles a missing column and gives compact inputs an accessible name', () => {
    const { container, rerender } = render(<FieldPreviewReadonly field={field} column={undefined} viewMode="compact" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<FieldPreviewReadonly field={field} column={column} viewMode="compact" sampleValue="Alice" />);
    expect(screen.getByRole('textbox', { name: 'Display name' })).toHaveValue('Alice');
    rerender(<FieldPreviewReadonly field={field} column={undefined} viewMode="compact" />);
    expect(container).toBeEmptyDOMElement();
  });
});
