import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { JsonTableCell, buildGrid } from '../JsonTableCell';

// Monaco cannot run in jsdom: stand in with a textarea that mirrors the editor's value/onChange contract.
vi.mock('@/shared/hooks/useBundledMonaco', () => ({ useBundledMonaco: () => true }));
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v?: string) => void }) => (
    <textarea data-testid="monaco-mock" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const items = [
  { name: 'Болт', qty: 10, done: false },
  { name: 'Гайка', qty: 5, done: true, note: 'срочно' },
];

const labels = { key: 'ключ', value: 'значение' };

describe('JsonTableCell', () => {
  it('renders an array of objects as rows and the union of keys as columns', () => {
    renderWithProviders(<JsonTableCell value={JSON.stringify(items)} />);

    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual(['name', 'qty', 'done', 'note']);
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('Гайка')).toBeInTheDocument();
    expect(screen.getByText('срочно')).toBeInTheDocument();
  });

  it('accepts an already-parsed value and renders an object as key/value rows', () => {
    renderWithProviders(<JsonTableCell value={{ city: 'Алматы', zip: 50000 }} />);

    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['ключ', 'значение']);
    expect(screen.getByText('city')).toBeInTheDocument();
    expect(screen.getByText('50000')).toBeInTheDocument();
  });

  it('translates the synthetic headers and controls', () => {
    renderWithProviders(<JsonTableCell value={{ city: 'Almaty' }} onChange={vi.fn()} />, { language: 'en' });

    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['key', 'value']);
    expect(screen.getByRole('table', { name: 'JSON as a table' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Almaty' })).toHaveAttribute('title', 'Edit');
  });

  it('is read-only without onChange: no inputs, no row controls', () => {
    renderWithProviders(<JsonTableCell value={items} />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('fills a key missing in one item as a blank editable value', () => {
    const onChange = vi.fn();
    renderWithProviders(<JsonTableCell value={items} config={{ prettyInCell: false }} onChange={onChange} />);

    const blank = screen.getAllByTitle('Редактировать').find((b) => b.textContent?.trim() === '');
    expect(blank).toBeDefined();
    fireEvent.click(blank as HTMLElement);
    const input = screen.getByRole('textbox', { name: 'Значение' });
    fireEvent.change(input, { target: { value: 'ok' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(JSON.parse(onChange.mock.calls[0][0])[0].note).toBe('ok');
  });

  it('edits a value in place and commits JSON with the number type preserved', () => {
    const onChange = vi.fn();
    renderWithProviders(<JsonTableCell value={items} config={{ prettyInCell: false }} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '10' }));
    const input = screen.getByRole('textbox', { name: 'Значение' });
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = JSON.parse(onChange.mock.calls[0][0]);
    expect(next[0].qty).toBe(12);
    expect(next[1]).toEqual(items[1]);
    expect(onChange.mock.calls[0][0]).not.toContain('\n');
  });

  it('Escape cancels the edit without committing', () => {
    const onChange = vi.fn();
    renderWithProviders(<JsonTableCell value={items} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Болт' }));
    const input = screen.getByRole('textbox', { name: 'Значение' });
    fireEvent.change(input, { target: { value: 'Шуруп' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Болт' })).toBeInTheDocument();
  });

  it('toggles booleans with a checkbox', () => {
    const onChange = vi.fn();
    renderWithProviders(<JsonTableCell value={items} onChange={onChange} />);

    const [first] = screen.getAllByRole('checkbox');
    fireEvent.click(first);

    expect(JSON.parse(onChange.mock.calls[0][0])[0].done).toBe(true);
  });

  it('adds and deletes rows of an array', () => {
    const onChange = vi.fn();
    renderWithProviders(<JsonTableCell value={items} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '+ строка' }));
    expect(JSON.parse(onChange.mock.calls[0][0])).toEqual([
      ...items,
      { name: '', qty: '', done: '', note: '' },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Удалить строку 1' }));
    expect(JSON.parse(onChange.mock.calls[1][0])).toEqual([items[1]]);
  });

  it('opens the Monaco JSON editor scoped to a nested value on click and writes it back on save', () => {
    const nested = { model: 'claude', thinking: true };
    const onChange = vi.fn();
    renderWithProviders(<JsonTableCell value={{ max_history: 30, auto_summary: nested }} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: JSON.stringify(nested) }));

    const editor = screen.getByTestId('monaco-mock') as HTMLTextAreaElement;
    expect(screen.getByRole('dialog', { name: 'Редактирование JSON' })).toBeInTheDocument();
    expect(editor.value).toBe(JSON.stringify(nested, null, 2));

    fireEvent.change(editor, { target: { value: '{"model": "opus"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(JSON.parse(onChange.mock.calls[0][0])).toEqual({ max_history: 30, auto_summary: { model: 'opus' } });
  });

  it('closes the nested editor on cancel without committing', () => {
    const onChange = vi.fn();
    renderWithProviders(<JsonTableCell value={{ cfg: { a: 1 } }} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '{"a":1}' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows a nested value as plain text when the cell is read-only', () => {
    renderWithProviders(<JsonTableCell value={{ cfg: { a: 1 } }} />);

    expect(screen.getByText('{"a":1}')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '{"a":1}' })).toBeNull();
  });

  it('falls back to the text preview for invalid JSON and primitive roots', () => {
    const { rerender } = renderWithProviders(<JsonTableCell value="{not json" onChange={vi.fn()} />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('{not json')).toBeInTheDocument();

    rerender(<JsonTableCell value={42} onChange={vi.fn()} />);
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('buildGrid', () => {
  it('maps primitives arrays to a single value column and mixed arrays to null', () => {
    expect(buildGrid(['a', 1], labels)?.headers).toEqual(['значение']);
    expect(buildGrid([{ a: 1 }, 'x'], labels)).toBeNull();
    expect(buildGrid('str', labels)).toBeNull();
  });
});
