import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DynamicFormRenderer } from '../DynamicFormRenderer';
import { FieldPreviewEditor } from '../FieldPreviewEditor';
import { FieldPreviewReadonly } from '../FieldPreviewReadonly';
import { FieldRenderer } from '../../modals/FieldRenderer';
import type { ColumnModel } from '../../../types/table.types';
import type { FormConfig, FormField } from '../../../types/form-config.types';

afterEach(cleanup);

const column: ColumnModel = {
  id: 'comment', tableId: '1', name: 'comment', displayName: 'Комментарий', type: 'text',
  config: {}, isRequired: false, isReadonly: false, orderIndex: 0, width: 200, isVisible: true,
};
const expandable: FormField = { id: 'comment', columnId: 'comment', width: 'full', order: 0, expandable: true, rows: 10 };
const plain: FormField = { ...expandable, expandable: false, rows: undefined };

const withQuery = (ui: ReactNode) =>
  createElement(QueryClientProvider, { client: new QueryClient() }, ui);

describe('form builder "Расширяемое" text field', () => {
  it('FieldRenderer renders a resizable textarea with the configured rows and still reports edits', () => {
    const onChange = vi.fn();
    render(withQuery(<FieldRenderer column={column} value="" onChange={onChange} showLabel={false} multiline rows={10} />));
    const box = screen.getByRole('textbox', { name: '' });
    expect(box.tagName).toBe('TEXTAREA');
    expect(box).toHaveAttribute('rows', '10');
    expect(box.className).toContain('resize-y');
    fireEvent.change(box, { target: { value: 'line 1\nline 2' } });
    expect(onChange).toHaveBeenCalledWith('line 1\nline 2');
  });

  it('FieldRenderer keeps the single-line input without the flag (every other caller is unchanged)', () => {
    render(withQuery(<FieldRenderer column={column} value="" onChange={vi.fn()} showLabel={false} />));
    expect(screen.getByRole('textbox').tagName).toBe('INPUT');
  });

  it('the live form (DynamicFormRenderer) honours expandable + rows from the form config', () => {
    const config: FormConfig = { version: 1, layout: 'grid', fields: [expandable], elements: [] };
    render(withQuery(<DynamicFormRenderer config={config} columns={[column]} formData={{}} onChange={vi.fn()} />));
    const box = screen.getByRole('textbox');
    expect(box.tagName).toBe('TEXTAREA');
    expect(box).toHaveAttribute('rows', '10');
  });

  it('the live form falls back to 3 rows when rows is unset and ignores the flag on non-text columns', () => {
    const number: ColumnModel = { ...column, id: 'amount', name: 'amount', type: 'number' };
    const config: FormConfig = {
      version: 1, layout: 'grid', elements: [],
      fields: [{ ...expandable, rows: undefined }, { id: 'amount', columnId: 'amount', width: 'full', order: 1, expandable: true }],
    };
    render(withQuery(<DynamicFormRenderer config={config} columns={[column, number]} formData={{}} onChange={vi.fn()} />));
    expect(screen.getByRole('textbox')).toHaveAttribute('rows', '3');
    expect(screen.getByRole('spinbutton').tagName).toBe('INPUT');
  });

  it.each(['standard', 'compact'] as const)('the builder preview (%s) shows the textarea the user configured', (viewMode) => {
    render(<FieldPreviewEditor field={expandable} column={column} viewMode={viewMode} isSelected={false} onClick={vi.fn()} />);
    const box = screen.getByLabelText('Комментарий');
    expect(box.tagName).toBe('TEXTAREA');
    expect(box).toHaveAttribute('rows', '10');
    expect(box).toBeDisabled();
  });

  it('the builder preview stays an input for a plain text field', () => {
    render(<FieldPreviewEditor field={plain} column={column} viewMode="standard" isSelected={false} onClick={vi.fn()} />);
    expect(screen.getByLabelText('Комментарий').tagName).toBe('INPUT');
  });

  it('the preview-mode renderer shows the textarea too', () => {
    render(<FieldPreviewReadonly field={expandable} column={column} viewMode="standard" sampleValue="hello" />);
    const box = screen.getByLabelText('Комментарий');
    expect(box.tagName).toBe('TEXTAREA');
    expect(box).toHaveAttribute('rows', '10');
    expect(box).toHaveValue('hello');
  });
});
