/**
 * ADR-0035 Slice 1 (S1.6) — geo_point pin chip + paste path through the one shared parser.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ColumnModel } from '@/features/tables/types/table.types';
import { renderCellValue } from '../renderCellValue';
import { GeoPointCell, geoPointMapUrl } from '../../cells/GeoPointCell';
import { createMockColumn } from './columnSettingsTestUtils';

const MOSCOW = { lat: 55.7558, lng: 37.6173, source: 'paste' };

const geoColumn = (overrides: Partial<ColumnModel> = {}): ColumnModel =>
  createMockColumn({ id: '77', name: 'where', displayName: 'Where', type: 'geo_point', config: { geo: { version: 1, raw_sibling: false, indexed: false } }, ...overrides });

describe('GeoPointCell', () => {
  it('renders a pin chip with 4 decimals linking to an external map', () => {
    render(<GeoPointCell value={MOSCOW} />);
    const chip = screen.getByTestId('geo-point-chip');
    expect(chip).toHaveTextContent('📍 55.7558, 37.6173');
    expect(chip).toHaveAttribute('href', geoPointMapUrl({ lat: 55.7558, lng: 37.6173 }));
    expect(chip).toHaveAttribute('target', '_blank');
  });

  it('rounds to 4 decimals in the chip but keeps 6 in the title', () => {
    render(<GeoPointCell value={{ lat: 55.123456789, lng: 37.987654321 }} />);
    const chip = screen.getByTestId('geo-point-chip');
    expect(chip).toHaveTextContent('55.1235, 37.9877');
    expect(chip).toHaveAttribute('title', expect.stringContaining('55.123457, 37.987654'));
  });

  it.each([null, undefined, '', {}, { lat: 'x', lng: 1 }, { lat: 91, lng: 0 }])('renders an empty cell for %j without crashing', (value) => {
    render(<GeoPointCell value={value} />);
    expect(screen.queryByTestId('geo-point-chip')).toBeNull();
    expect(screen.getByTestId('geo-point-empty')).toBeInTheDocument();
  });

  it('raw mode shows the stored JSON, not the chip', () => {
    render(<GeoPointCell value={MOSCOW} rawMode />);
    expect(screen.queryByTestId('geo-point-chip')).toBeNull();
    expect(screen.getByText(JSON.stringify(MOSCOW))).toBeInTheDocument();
  });

  it('paste of coordinates calls onPastePoint with the parsed point; garbage is ignored', () => {
    const onPastePoint = vi.fn();
    render(<GeoPointCell value={MOSCOW} onPastePoint={onPastePoint} />);
    const chip = screen.getByTestId('geo-point-chip');
    fireEvent.paste(chip, { clipboardData: { getData: () => 'abc' } });
    expect(onPastePoint).not.toHaveBeenCalled();
    fireEvent.paste(chip, { clipboardData: { getData: () => '59.9343, 30.3351' } });
    expect(onPastePoint).toHaveBeenCalledWith({ lat: 59.9343, lng: 30.3351 });
  });

  it('read-only cells ignore paste', () => {
    const onPastePoint = vi.fn();
    render(<GeoPointCell value={MOSCOW} readOnly onPastePoint={onPastePoint} />);
    fireEvent.paste(screen.getByTestId('geo-point-chip'), { clipboardData: { getData: () => '59.9343, 30.3351' } });
    expect(onPastePoint).not.toHaveBeenCalled();
  });
});

describe('renderCellValue geo_point', () => {
  it('renders the chip for a geo_point column', () => {
    const column = geoColumn();
    render(<>{renderCellValue({ column, value: MOSCOW, rowId: 'r1', rows: [{ id: 'r1', data: { [column.id]: MOSCOW } }], rowMutation: { mutate: vi.fn() } } as any)}</>);
    expect(screen.getByTestId('geo-point-chip')).toHaveTextContent('55.7558, 37.6173');
  });

  it('paste onto the chip PUTs the parent cell as {lat, lng, source: paste}', () => {
    const column = geoColumn();
    const mutate = vi.fn();
    const row = { id: 'r1', data: { [column.id]: MOSCOW, other: 1 } };
    render(<>{renderCellValue({ column, value: MOSCOW, rowId: 'r1', rows: [row], rowMutation: { mutate } } as any)}</>);
    fireEvent.paste(screen.getByTestId('geo-point-chip'), { clipboardData: { getData: () => '55°45′N 37°37′E' } });
    expect(mutate).toHaveBeenCalledTimes(1);
    const call = mutate.mock.calls[0][0];
    expect(call.rowId).toBe('r1');
    expect(call.columnId).toBe(column.id);
    expect(call.value).toEqual({ lat: 55.75, lng: expect.closeTo(37.6167, 3), source: 'paste' });
    expect(call.data.other).toBe(1);
  });

  it('empty value renders an empty cell, not a crash', () => {
    const column = geoColumn();
    render(<>{renderCellValue({ column, value: null, rowId: 'r1', rows: [], rowMutation: { mutate: vi.fn() } } as any)}</>);
    expect(screen.queryByTestId('geo-point-chip')).toBeNull();
  });
});
