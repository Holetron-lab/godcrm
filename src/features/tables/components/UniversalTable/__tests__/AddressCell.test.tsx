/**
 * ADR-0035-A — address cell: label order (name → name_template → formatted, §Amendment 1),
 * map URL by the linked geo_point or by search, paste path, editor round-trip.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ColumnModel } from '@/features/tables/types/table.types';
import { renderCellValue } from '../renderCellValue';
import {
  AddressCell,
  addressMapUrl,
  addressSearchUrl,
  addressSortKey,
  parseAddressDraft,
  parseAddressValue,
  resolveAddressLabel,
} from '../../cells/AddressCell';
import { AddressEditor } from '../../cells/AddressEditor';
import { geoPointMapUrl } from '../../cells/GeoPointCell';
import { createMockColumn } from './columnSettingsTestUtils';

const TVERSKAYA = { formatted: 'Тверская 7, Москва', provider: 'dadata', provider_place_id: 'fias-1' };
const MOSCOW = { lat: 55.75, lng: 37.61, source: 'raw' };

const geoColumn = (): ColumnModel =>
  createMockColumn({ id: '77', name: 'where', displayName: 'Where', type: 'geo_point', config: { geo: { version: 1, raw_sibling: false, indexed: false } } });
const addressColumn = (overrides: Partial<ColumnModel> = {}): ColumnModel =>
  createMockColumn({ id: '88', name: 'addr', displayName: 'Addr', type: 'address', config: { address: { geo_column_id: 77, name_template: null } }, ...overrides });

describe('address helpers', () => {
  it('parseAddressValue accepts strings and allowlisted objects, rejects the rest', () => {
    expect(parseAddressValue(' Тверская 7 ')).toEqual({ formatted: 'Тверская 7' });
    expect(parseAddressValue({ formatted: 'X', name: 'Офис', junk: 1, city: ' Москва ' })).toEqual({ formatted: 'X', name: 'Офис', city: 'Москва' });
    expect(parseAddressValue({ name: 'no line' })).toBeNull();
    for (const v of [null, undefined, '', '  ', 5, [], {}]) expect(parseAddressValue(v)).toBeNull();
  });

  it('parseAddressDraft: "" clears, JSON object passes through, text stays a plain string', () => {
    expect(parseAddressDraft('   ')).toBeNull();
    expect(parseAddressDraft('{"formatted":"X","name":"Y"}')).toEqual({ formatted: 'X', name: 'Y' });
    expect(parseAddressDraft('Тверская 7, Москва')).toBe('Тверская 7, Москва');
    expect(parseAddressDraft('{not json')).toBe('{not json');
  });

  it('addressMapUrl: linked point → OSM at the point; otherwise OSM search by formatted', () => {
    expect(addressMapUrl(TVERSKAYA, MOSCOW)).toBe(geoPointMapUrl({ lat: 55.75, lng: 37.61 }));
    expect(addressMapUrl(TVERSKAYA, '55.75, 37.61')).toBe(geoPointMapUrl({ lat: 55.75, lng: 37.61 }));
    expect(addressMapUrl(TVERSKAYA, null)).toBe(addressSearchUrl('Тверская 7, Москва'));
    expect(addressMapUrl(TVERSKAYA, { lat: 'x' })).toBe(`https://www.openstreetmap.org/search?query=${encodeURIComponent('Тверская 7, Москва')}`);
  });

  it('resolveAddressLabel: name → name_template → formatted, empty renders fall through', () => {
    const row = { id: 'r1', title: 'Склад №2', city: 'Москва', blank: '' };
    expect(resolveAddressLabel({ formatted: 'F', name: 'Офис' }, row, '{{title}}')).toBe('Офис');
    expect(resolveAddressLabel({ formatted: 'F', name: 'Офис {{city}}' }, row)).toBe('Офис Москва'); // AC10
    expect(resolveAddressLabel({ formatted: 'F' }, row, '{{title}}')).toBe('Склад №2');           // AC9
    expect(resolveAddressLabel({ formatted: 'F' }, row, '{{blank}}')).toBe('F');                   // AC11
    expect(resolveAddressLabel({ formatted: 'F', name: '{{missing}}' }, row, '{{blank}}')).toBe('F');
    expect(resolveAddressLabel({ formatted: 'F' }, row, '#{{row_id}}')).toBe('#r1');
    expect(resolveAddressLabel({ formatted: 'F' }, row, null)).toBe('F');
  });

  it('addressSortKey sorts by formatted', () => {
    expect(addressSortKey({ formatted: 'B', name: 'A' })).toBe('B');
    expect(addressSortKey(null)).toBe('');
  });
});

describe('AddressCell', () => {
  it('renders the formatted line as a chip with the full address in the tooltip', () => {
    render(<AddressCell value={{ formatted: 'Тверская 7, Москва' }} />);
    const chip = screen.getByTestId('address-chip');
    expect(chip).toHaveTextContent('Тверская 7, Москва');
    expect(chip).toHaveAttribute('title', 'Тверская 7, Москва');
    expect(chip).toHaveAttribute('target', '_blank');
    expect(chip).toHaveAttribute('href', addressSearchUrl('Тверская 7, Москва'));
  });

  it('prefers name, then the column template, keeping formatted in the tooltip', () => {
    const { rerender } = render(<AddressCell value={{ formatted: 'F', name: 'Офис {{city}}' }} rowData={{ city: 'Москва' }} />);
    expect(screen.getByTestId('address-chip')).toHaveTextContent('Офис Москва');
    rerender(<AddressCell value={{ formatted: 'F' }} rowData={{ title: 'Склад №2' }} nameTemplate="{{title}}" />);
    expect(screen.getByTestId('address-chip')).toHaveTextContent('Склад №2');
    expect(screen.getByTestId('address-chip')).toHaveAttribute('title', 'F');
    rerender(<AddressCell value={{ formatted: 'F' }} rowData={{ title: '' }} nameTemplate="{{title}}" />);
    expect(screen.getByTestId('address-chip')).toHaveTextContent('F');
  });

  it('links to the point when the linked geo cell is filled', () => {
    render(<AddressCell value={{ formatted: 'F' }} linkedPoint={MOSCOW} />);
    expect(screen.getByTestId('address-chip')).toHaveAttribute('href', geoPointMapUrl({ lat: 55.75, lng: 37.61 }));
  });

  it.each([null, undefined, '', {}, { name: 'x' }, 42])('renders an empty cell for %j without crashing', (value) => {
    render(<AddressCell value={value} />);
    expect(screen.queryByTestId('address-chip')).toBeNull();
    expect(screen.getByTestId('address-empty')).toBeInTheDocument();
  });

  it('raw mode shows the stored JSON, not the chip', () => {
    render(<AddressCell value={TVERSKAYA} rawMode />);
    expect(screen.queryByTestId('address-chip')).toBeNull();
    expect(screen.getByText(JSON.stringify(TVERSKAYA))).toBeInTheDocument();
  });

  it('paste hands the plain text to onPasteAddress; blank paste and read-only cells are ignored', () => {
    const onPasteAddress = vi.fn();
    const { rerender } = render(<AddressCell value={null} onPasteAddress={onPasteAddress} />);
    fireEvent.paste(screen.getByTestId('address-empty'), { clipboardData: { getData: () => '   ' } });
    expect(onPasteAddress).not.toHaveBeenCalled();
    fireEvent.paste(screen.getByTestId('address-empty'), { clipboardData: { getData: () => ' Невский 1 ' } });
    expect(onPasteAddress).toHaveBeenCalledWith('Невский 1');
    rerender(<AddressCell value={{ formatted: 'F' }} readOnly onPasteAddress={onPasteAddress} />);
    fireEvent.paste(screen.getByTestId('address-chip'), { clipboardData: { getData: () => 'X' } });
    expect(onPasteAddress).toHaveBeenCalledTimes(1);
  });
});

describe('renderCellValue address', () => {
  it('resolves the linked geo_point column by config.address.geo_column_id and reads its cell by column name', () => {
    const column = addressColumn();
    const rowData = { id: 'r1', addr: { formatted: 'F' }, where: MOSCOW, title: 'Склад №2' };
    render(<>{renderCellValue({ column, columns: [geoColumn(), column], value: rowData.addr, rowId: 'r1', rowData, rows: [{ id: 'r1', data: rowData }], rowMutation: { mutate: vi.fn() } } as any)}</>);
    expect(screen.getByTestId('address-chip')).toHaveAttribute('href', geoPointMapUrl({ lat: 55.75, lng: 37.61 }));
  });

  it('falls back to search when the linked point is empty, and renders the template label', () => {
    const column = addressColumn({ config: { address: { geo_column_id: 77, name_template: '{{title}}' } } });
    const rowData = { id: 'r1', addr: { formatted: 'F' }, title: 'Склад №2' };
    render(<>{renderCellValue({ column, columns: [geoColumn(), column], value: rowData.addr, rowId: 'r1', rowData, rows: [{ id: 'r1', data: rowData }], rowMutation: { mutate: vi.fn() } } as any)}</>);
    const chip = screen.getByTestId('address-chip');
    expect(chip).toHaveTextContent('Склад №2');
    expect(chip).toHaveAttribute('href', addressSearchUrl('F'));
  });

  it('paste onto the cell PUTs the plain string (the server stores {formatted})', () => {
    const column = addressColumn();
    const mutate = vi.fn();
    const row = { id: 'r1', data: { other: 1 } };
    render(<>{renderCellValue({ column, columns: [column], value: null, rowId: 'r1', rowData: row.data, rows: [row], rowMutation: { mutate } } as any)}</>);
    fireEvent.paste(screen.getByTestId('address-empty'), { clipboardData: { getData: () => 'Невский 1' } });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({ rowId: 'r1', columnId: '88', value: 'Невский 1', data: { other: 1, '88': 'Невский 1' } });
  });

  it('empty value renders an empty cell, not a crash', () => {
    const column = addressColumn();
    render(<>{renderCellValue({ column, value: null, rowId: 'r1', rows: [], rowMutation: { mutate: vi.fn() } } as any)}</>);
    expect(screen.queryByTestId('address-chip')).toBeNull();
  });
});

describe('AddressEditor', () => {
  it('loads fields from the JSON draft and commits the object with reserved keys passed through', () => {
    const onCommit = vi.fn();
    render(<AddressEditor value={JSON.stringify({ ...TVERSKAYA, name: 'Офис', city: 'Москва' })} onCommit={onCommit} onCancel={vi.fn()} />);
    expect(screen.getByTestId('address-formatted')).toHaveValue('Тверская 7, Москва');
    expect(screen.getByTestId('address-name')).toHaveValue('Офис');
    // Components block opens by itself when a component is filled.
    expect(screen.getByTestId('address-city')).toHaveValue('Москва');
    fireEvent.change(screen.getByTestId('address-name'), { target: { value: 'Офис {{city}}' } });
    fireEvent.change(screen.getByTestId('address-building'), { target: { value: ' 7 ' } });
    fireEvent.click(screen.getByTestId('address-save'));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onCommit.mock.calls[0][0])).toEqual({
      provider: 'dadata', provider_place_id: 'fias-1',
      formatted: 'Тверская 7, Москва', name: 'Офис {{city}}', city: 'Москва', building: '7',
    });
  });

  it('Enter in the address line saves; a plain-text draft is taken as the formatted line', () => {
    const onCommit = vi.fn();
    render(<AddressEditor value="Невский 1" onCommit={onCommit} onCancel={vi.fn()} />);
    const line = screen.getByTestId('address-formatted');
    expect(line).toHaveValue('Невский 1');
    expect(document.activeElement).toBe(line);
    fireEvent.keyDown(line, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(JSON.stringify({ formatted: 'Невский 1' }));
  });

  it('empty address line → inline error, nothing committed, typed name kept', () => {
    const onCommit = vi.fn();
    render(<AddressEditor value="" onCommit={onCommit} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('address-name'), { target: { value: 'Офис' } });
    fireEvent.click(screen.getByTestId('address-save'));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('address-name')).toHaveValue('Офис');
    expect(screen.queryByText(/^(Clear|Очистить)$/)).toBeNull();
  });

  it('Clear commits "" for an existing value', () => {
    const onCommit = vi.fn();
    render(<AddressEditor value={JSON.stringify({ formatted: 'F' })} onCommit={onCommit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText(/^(Clear|Очистить)$/));
    expect(onCommit).toHaveBeenCalledWith('');
  });
});
