import { expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SelectDataSourceStep } from '../components/steps/SelectDataSourceStep';
import { ChooseTableStep } from '../components/steps/ChooseTableStep';
import { SelectIdColumnStep } from '../components/steps/SelectIdColumnStep';
import { ConfigureSyncStep } from '../components/steps/ConfigureSyncStep';

vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('@/features/data-sources/hooks/useDataSources', () => ({
  useDataSources: () => ({ loading: false, dataSources: [{ id: 'source', name: 'Warehouse', type: 'postgres', host: 'localhost', port: 5432, database: 'fixture' }] }),
}));

it('selects a data source with Enter and exposes selection', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const { rerender } = render(<SelectDataSourceStep workspaceId="11" onSelect={onSelect} />);
  const choice = screen.getByRole('button', { name: /Warehouse/ });
  choice.focus();
  await user.keyboard('{Enter}');
  expect(onSelect).toHaveBeenCalledWith('source');
  rerender(<SelectDataSourceStep workspaceId="11" selectedId="source" onSelect={onSelect} />);
  expect(choice).toHaveAttribute('aria-pressed', 'true');
});

it('selects a table with Space', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  vi.useFakeTimers();
  try {
    render(<ChooseTableStep dataSourceId="source" onSelect={onSelect} />);
    await act(async () => { await vi.runAllTimersAsync(); });
  } finally {
    vi.useRealTimers();
  }
  const choice = screen.getByRole('button', { name: /customers/ });
  choice.focus();
  await user.keyboard(' ');
  expect(onSelect).toHaveBeenCalledWith('customers', expect.objectContaining({ name: 'customers' }));
});

it('validates an ID column after keyboard selection', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(<SelectIdColumnStep tableInfo={{ name: 'records', row_count: 0, columns: [{ name: 'id', type: 'INT', nullable: false, is_primary_key: true }] }} onSelect={onSelect} />);
  screen.getByRole('button', { name: /PRIMARY KEY/ }).focus();
  await user.keyboard('{Enter}');
  expect(onSelect).toHaveBeenCalledWith('id', false);
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith('id', true), { timeout: 3000 });
});

it('changes the interval with Space without changing other options', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<ConfigureSyncStep config={{ enabled: true, interval_minutes: 5, auto_archive_deleted: true }} onChange={onChange} />);
  expect(screen.getByRole('button', { name: '5 minutes' })).toHaveAttribute('aria-pressed', 'true');
  screen.getByRole('button', { name: '15 minutes' }).focus();
  await user.keyboard(' ');
  expect(onChange).toHaveBeenCalledWith({ enabled: true, interval_minutes: 15, auto_archive_deleted: true });
});
