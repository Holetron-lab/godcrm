// ADR-207 W3.1 — the reusable mapping row: target select (skip / + new / existing),
// type select locked for existing targets, compat badge, accessible names via i18n.
import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import {
  ColumnMappingRow,
  NEW_COLUMN,
  setMappingTarget,
  setMappingType,
  type ColumnMapping,
  type TargetColumnLike,
} from '@/shared/column-mapping';

const targets: TargetColumnLike[] = [
  { id: 'c1', name: 'status', displayName: 'Статус', type: 'select' },
  { id: 'c2', name: 'qty', type: 'number' },
];
const typeOptions = [
  { value: 'text', label: 'Text', icon: '📝' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select' },
];

const withLanguage = (ui: ReactNode) => render(<LanguageProvider>{ui}</LanguageProvider>);

function Harness({ initial, allowNewColumn = true }: { initial: ColumnMapping; allowNewColumn?: boolean }) {
  const [mappings, setMappings] = useState([initial]);
  const m = mappings[0];
  return (
    <>
      <ColumnMappingRow
        mapping={m}
        targetColumns={targets}
        typeOptions={typeOptions}
        sample="open"
        allowNewColumn={allowNewColumn}
        onTargetChange={t => setMappings(prev => setMappingTarget(prev, m.sourceColumn, t, targets))}
        onTypeChange={t => setMappings(prev => setMappingType(prev, m.sourceColumn, t))}
      />
      <output data-testid="state">{JSON.stringify(m)}</output>
    </>
  );
}

const readState = () => JSON.parse(screen.getByTestId('state').textContent || '{}') as ColumnMapping;

describe('ColumnMappingRow', () => {
  beforeEach(() => {
    window.localStorage.setItem('god-crm-language', 'en');
  });

  it('renders source, sample and the three kinds of target options', () => {
    withLanguage(<Harness initial={{ sourceColumn: 'State', targetColumn: null, type: 'text' }} />);
    expect(screen.getByRole('group', { name: 'State' })).toBeInTheDocument();
    expect(screen.getByText('open')).toBeInTheDocument();
    const target = screen.getByRole('combobox', { name: 'Target column for State' }) as HTMLSelectElement;
    expect(Array.from(target.options).map(o => o.value)).toEqual(['', NEW_COLUMN, 'c1', 'c2']);
    expect(Array.from(target.options).map(o => o.text)).toEqual(['—', '+ new column', 'Статус', 'qty']);
    expect(target.value).toBe('');
  });

  it('hides + new column when the consumer does not allow it (CSV into existing table)', () => {
    withLanguage(<Harness initial={{ sourceColumn: 'State', targetColumn: null, type: 'text' }} allowNewColumn={false} />);
    const target = screen.getByRole('combobox', { name: 'Target column for State' }) as HTMLSelectElement;
    expect(Array.from(target.options).map(o => o.value)).toEqual(['', 'c1', 'c2']);
  });

  it('selecting an existing column adopts its type and locks the type select', async () => {
    const user = userEvent.setup();
    withLanguage(<Harness initial={{ sourceColumn: 'State', targetColumn: null, type: 'text' }} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Target column for State' }), 'c1');
    expect(readState()).toEqual({ sourceColumn: 'State', targetColumn: 'c1', type: 'select', match: null });
    const type = screen.getByRole('combobox', { name: 'Type for State' });
    expect(type).toBeDisabled();
    expect(type).toHaveValue('select');
  });

  it('selecting + new column keeps the type editable', async () => {
    const user = userEvent.setup();
    withLanguage(<Harness initial={{ sourceColumn: 'State', targetColumn: 'c1', type: 'select', match: 'name' }} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Target column for State' }), NEW_COLUMN);
    expect(readState().targetColumn).toBe(NEW_COLUMN);
    const type = screen.getByRole('combobox', { name: 'Type for State' });
    expect(type).toBeEnabled();
    await user.selectOptions(type, 'number');
    expect(readState().type).toBe('number');
  });

  it('selecting — skips the column', async () => {
    const user = userEvent.setup();
    withLanguage(<Harness initial={{ sourceColumn: 'State', targetColumn: 'c1', type: 'select' }} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Target column for State' }), '');
    expect(readState().targetColumn).toBeNull();
  });

  it('shows the server compat verdict and honours label overrides', () => {
    const onTargetChange = vi.fn();
    withLanguage(
      <ColumnMappingRow
        mapping={{ sourceColumn: 'priority', targetColumn: 'c2', type: 'number' }}
        targetColumns={targets}
        typeOptions={typeOptions}
        compat={{ compat: 'conflict', reason: 'number ← select' }}
        labels={{ skip: 'Пропустить', targetFor: 'Куда класть {column}' }}
        onTargetChange={onTargetChange}
        onTypeChange={() => {}}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('number ← select');
    const target = screen.getByRole('combobox', { name: 'Куда класть priority' }) as HTMLSelectElement;
    expect(target.options[0].text).toBe('Пропустить');
    expect(onTargetChange).not.toHaveBeenCalled();
  });

  it('speaks Russian when the language is ru', () => {
    window.localStorage.setItem('god-crm-language', 'ru');
    withLanguage(
      <ColumnMappingRow
        mapping={{ sourceColumn: 'State', targetColumn: null, type: 'text' }}
        targetColumns={targets}
        typeOptions={typeOptions}
        allowNewColumn
        compat={{ compat: 'ok' }}
        onTargetChange={() => {}}
        onTypeChange={() => {}}
      />,
    );
    const target = screen.getByRole('combobox', { name: 'Целевая колонка для State' }) as HTMLSelectElement;
    expect(target.options[1].text).toBe('+ новая колонка');
    expect(screen.getByRole('combobox', { name: 'Тип для State' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('OK');
  });

  it('keeps an unknown type visible instead of silently switching it', () => {
    withLanguage(
      <ColumnMappingRow
        mapping={{ sourceColumn: 'when', targetColumn: NEW_COLUMN, type: 'datetime' }}
        targetColumns={targets}
        typeOptions={typeOptions}
        onTargetChange={() => {}}
        onTypeChange={() => {}}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Type for when' })).toHaveValue('datetime');
  });
});
