import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { JsonColumnSettings } from '../JsonColumnSettings';
import type { ColumnModel } from '../../../../types/table.types';

const baseColumn = {
  id: '1', tableId: '1', name: 'meta', displayName: 'meta', type: 'json',
  width: 120, orderIndex: 0, isVisible: true, isRequired: false, isReadonly: false,
} as ColumnModel;

const Harness = ({ initial }: { initial: Partial<ColumnModel> }) => {
  const [draft, setDraft] = useState<ColumnModel>({ ...baseColumn, ...initial });
  return (
    <>
      <JsonColumnSettings draft={draft} setDraft={setDraft} />
      <output aria-label="Configuration">{JSON.stringify(draft.config)}</output>
    </>
  );
};

const readConfig = () => JSON.parse(screen.getByLabelText('Configuration').textContent || '{}');

describe('JsonColumnSettings — cell view', () => {
  it('defaults to preview and switches to table', () => {
    renderWithProviders(<Harness initial={{ type: 'json', config: {} }} />);

    expect(screen.getByRole('radio', { name: 'Превью' })).toBeChecked();

    fireEvent.click(screen.getByRole('radio', { name: 'Таблица' }));

    expect(screen.getByRole('radio', { name: 'Таблица' })).toBeChecked();
    expect(readConfig().json.cellView).toBe('table');
  });

  it('reflects a saved table view and keeps it when another setting changes', () => {
    renderWithProviders(<Harness initial={{ type: 'json', config: { json: { cellView: 'table', previewLines: 2 } } }} />);

    expect(screen.getByRole('radio', { name: 'Таблица' })).toBeChecked();

    fireEvent.click(screen.getByRole('radio', { name: 'Дерево' }));

    expect(readConfig().json).toMatchObject({ cellView: 'table', defaultMode: 'tree', previewLines: 2 });
  });

  it('renders English copy when the language is en', () => {
    renderWithProviders(<Harness initial={{ type: 'json', config: {} }} />, { language: 'en' });

    expect(screen.getByRole('heading', { name: '🧬 JSON settings' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Cell view' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Table' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Code' })).toBeChecked();
    expect(screen.getByLabelText('Lines in the cell preview')).toHaveValue(3);
  });
});
