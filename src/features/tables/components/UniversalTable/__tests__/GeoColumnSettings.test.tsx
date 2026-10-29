/**
 * ADR-0035-A — «Гео» column settings in the drawer:
 * - geo_point: no raw-sibling toggle any more (AC6), just the hint;
 * - address: linked geo point (defaults to the single geo_point), label template
 *   (§Amendment 1) and the collapsed geocoder block; secret *names* only (AC8).
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ColumnModel } from '@/features/tables/types/table.types';
import { ColumnSettingsDrawer } from '../ColumnSettingsDrawer';
import { createMockColumn, renderWithProviders, openTab, TABS } from './columnSettingsTestUtils';

vi.mock('@/features/projects/hooks/useProjectTables', () => ({
  useProjectTables: () => ({ tables: [], isLoading: false }),
}));

const listSecrets = vi.fn().mockResolvedValue({ secrets: [{ key: 'dadata_api_key', description: 'DaData' }, { key: 'photon_url', description: '' }], table_id: 5 });
const revealSecret = vi.fn();
vi.mock('@/features/secrets/api/secretsApi', () => ({
  secretsApi: {
    list: (...args: unknown[]) => listSecrets(...args),
    reveal: (...args: unknown[]) => revealSecret(...args),
  },
}));

const geoColumn = (): ColumnModel =>
  createMockColumn({ id: '77', name: 'where', displayName: 'Where', type: 'geo_point', config: { geo: { version: 1, raw_sibling: true, indexed: false } } });
const titleColumn = (): ColumnModel => createMockColumn({ id: '70', name: 'title', displayName: 'Title', type: 'text', config: {} });
const addressColumn = (config: ColumnModel['config'] = {}): ColumnModel =>
  createMockColumn({ id: '88', name: 'addr', displayName: 'Addr', type: 'address', config });

describe('GeoColumnSettings — geo_point', () => {
  it('shows the hint and no raw-sibling toggle even when the legacy flag is on', async () => {
    renderWithProviders(<ColumnSettingsDrawer column={geoColumn()} allColumns={[geoColumn()]} open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    await openTab(TABS.TYPE);
    expect(screen.getByTestId('geo-point-settings')).toBeInTheDocument();
    expect(screen.queryByTestId('geo-raw-sibling-toggle')).toBeNull();
    expect(screen.queryByTestId('address-settings')).toBeNull();
  });

  it('is absent for other types', async () => {
    renderWithProviders(<ColumnSettingsDrawer column={createMockColumn({ type: 'text' })} open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    await openTab(TABS.TYPE);
    expect(screen.queryByTestId('geo-point-settings')).toBeNull();
    expect(screen.queryByTestId('address-settings')).toBeNull();
  });
});

describe('GeoColumnSettings — address', () => {
  const allColumns = [titleColumn(), geoColumn(), addressColumn()];

  it('lists only geo_point columns in the link selector and defaults to the single one', async () => {
    renderWithProviders(<ColumnSettingsDrawer column={addressColumn()} allColumns={allColumns} spaceId={11} open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    await openTab(TABS.TYPE);
    const link = screen.getByTestId('address-geo-link') as HTMLSelectElement;
    const values = Array.from(link.options).map((o) => o.value);
    expect(values).toEqual(['', '77']);
    await waitFor(() => expect(link.value).toBe('77'));
  });

  it('respects an explicit null link (server-stamped) instead of re-defaulting', async () => {
    renderWithProviders(
      <ColumnSettingsDrawer column={addressColumn({ address: { version: 1, geo_column_id: null, geocoder: { secret_key: null, provider: null } } })} allColumns={allColumns} spaceId={11} open onOpenChange={vi.fn()} onSave={vi.fn()} />
    );
    await openTab(TABS.TYPE);
    expect((screen.getByTestId('address-geo-link') as HTMLSelectElement).value).toBe('');
  });

  it('save sends config.address with the link, a trimmed name_template and the geocoder block', async () => {
    const onSave = vi.fn();
    renderWithProviders(<ColumnSettingsDrawer column={addressColumn()} allColumns={allColumns} spaceId={11} open onOpenChange={vi.fn()} onSave={onSave} />);
    await openTab(TABS.TYPE);

    const template = screen.getByTestId('address-name-template') as HTMLInputElement;
    fireEvent.click(screen.getByTestId('address-template-key-title'));
    expect(template.value).toBe('{{title}}');
    fireEvent.change(template, { target: { value: '  {{title}} ' } });
    fireEvent.blur(template);
    expect(template.value).toBe('{{title}}');

    fireEvent.change(screen.getByTestId('address-geocoder-secret-key'), { target: { value: 'dadata_api_key' } });
    fireEvent.change(screen.getByTestId('address-geocoder-provider'), { target: { value: 'dadata' } });

    fireEvent.click(screen.getByRole('button', { name: /^(Сохранить|Save)$/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const [columnId, payload] = onSave.mock.calls[0];
    expect(columnId).toBe('88');
    expect(payload.type).toBe('address');
    expect(payload.config.address).toEqual({
      geo_column_id: 77,
      name_template: '{{title}}',
      geocoder: { secret_key: 'dadata_api_key', provider: 'dadata' },
    });
  });

  it('an emptied name_template is saved as null', async () => {
    const onSave = vi.fn();
    renderWithProviders(
      <ColumnSettingsDrawer column={addressColumn({ address: { geo_column_id: 77, name_template: '{{title}}' } })} allColumns={allColumns} spaceId={11} open onOpenChange={vi.fn()} onSave={onSave} />
    );
    await openTab(TABS.TYPE);
    const template = screen.getByTestId('address-name-template');
    fireEvent.change(template, { target: { value: '   ' } });
    fireEvent.blur(template);
    fireEvent.click(screen.getByRole('button', { name: /^(Сохранить|Save)$/i }));
    expect(onSave.mock.calls[0][1].config.address.name_template).toBeNull();
  });

  it('AC8: offers secret key names from the space list and never requests a value', async () => {
    renderWithProviders(<ColumnSettingsDrawer column={addressColumn()} allColumns={allColumns} spaceId={11} open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    await openTab(TABS.TYPE);
    const details = screen.getByTestId('address-geocoder') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    await waitFor(() => expect(listSecrets).toHaveBeenCalledWith(11));
    await waitFor(() => expect(details.querySelector('datalist option[value="dadata_api_key"]')).not.toBeNull());
    expect(details.querySelector('datalist option[value="photon_url"]')).not.toBeNull();
    expect(revealSecret).not.toHaveBeenCalled();
    expect(details.querySelectorAll('button')).toHaveLength(0);
  });

  it('shows the "add a Geo point column" hint when the table has none', async () => {
    renderWithProviders(<ColumnSettingsDrawer column={addressColumn()} allColumns={[titleColumn(), addressColumn()]} open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    await openTab(TABS.TYPE);
    const link = screen.getByTestId('address-geo-link') as HTMLSelectElement;
    expect(Array.from(link.options).map((o) => o.value)).toEqual(['']);
    expect(screen.getByText(/Add a «Geo point» column|Добавьте в таблицу колонку «Геоточка»/)).toBeInTheDocument();
  });
});
