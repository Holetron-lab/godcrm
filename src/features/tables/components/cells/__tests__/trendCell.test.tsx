// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NumberCell } from '../NumberCell';
import { trendOf, parseTrendCell } from '../trend';

/**
 * Динамика позиции в ячейке (документ 239321): «4 ↑1» зелёным, «7 ↓3» красным,
 * «4 —» нейтрально, первый замер без стрелки, «>N» после полного обхода,
 * ошибка/ожидание не стирают последнюю позицию.
 */
const at = '2026-10-02T00:15:00Z';
const prevAt = '2026-10-01T20:48:01Z';
const found = (position: number, extra: Record<string, unknown> = {}) => ({ status: 'found', position, depth: 50, checked: 50, at, url: 'https://sixtynine.ru/p', ...extra });
const prev = (position: number | null, status = position === null ? 'not_found' : 'found') => ({ position, status, depth: 50, checked: 50, at: prevAt, run_id: 'r1' });

describe('trendOf', () => {
  it('improvement: 5 → 4 is "4 ↑1" (up)', () => {
    expect(trendOf(found(4, { prev: prev(5) }))).toMatchObject({ value: '4', delta: '↑1', tone: 'up' });
  });
  it('decline: 4 → 7 is "7 ↓3" (down)', () => {
    expect(trendOf(found(7, { prev: prev(4) }))).toMatchObject({ value: '7', delta: '↓3', tone: 'down' });
  });
  it('equal: 4 → 4 is "4 —" (flat)', () => {
    expect(trendOf(found(4, { prev: prev(4) }))).toMatchObject({ value: '4', delta: '—', tone: 'flat' });
  });
  it('first measurement has no arrow', () => {
    expect(trendOf(found(4, { prev: null }))).toMatchObject({ value: '4', delta: null, tone: 'none' });
  });
  it('not found shows ">N" and entering/leaving the top-N without an invented delta', () => {
    expect(trendOf({ status: 'not_found', position: null, depth: 50, checked: 50, at, prev: prev(12) })).toMatchObject({ value: '>50', delta: '↓ из топ-50', tone: 'down' });
    expect(trendOf(found(9, { prev: prev(null) }))).toMatchObject({ value: '9', delta: '↑ в топ-50', tone: 'up' });
    expect(trendOf({ status: 'not_found', position: null, depth: 50, checked: 50, at, prev: prev(null) })).toMatchObject({ value: '>50', delta: '—', tone: 'flat' });
  });
  it('keeps the last position on error and marks it; pending is marked too', () => {
    const t = trendOf(found(4, { prev: prev(5), error: 'HTTP 429', error_at: at }));
    expect(t).toMatchObject({ value: '4', delta: '↑1', tone: 'up', marker: '⚠' });
    expect(t.title).toContain('HTTP 429');
    expect(trendOf(found(4, { pending: { operation_id: 'op1', submitted_at: at } })).marker).toBe('⏳');
  });
  it('tooltip carries both dates and the baseline reset note', () => {
    const t = trendOf(found(4, { prev: prev(5) }));
    expect(t.title).toContain('2026');
    expect(t.title).toContain('Предыдущий');
    expect(trendOf(found(4, { baseline_reset: true })).title).toContain('методика');
  });
  it('parseTrendCell accepts string or object and rejects junk', () => {
    expect(parseTrendCell('{"position":3}')).toEqual({ position: 3 });
    expect(parseTrendCell({ position: 3 })).toEqual({ position: 3 });
    expect(parseTrendCell('junk')).toBeNull();
    expect(parseTrendCell(null)).toBeNull();
  });
});

describe('NumberCell displayStyle=trend', () => {
  it('renders value and coloured delta from the sidecar column', () => {
    render(<NumberCell value={4} config={{ displayStyle: 'trend', trendField: 'dyn_msk' }} rowData={{ pos_msk: 4, dyn_msk: found(4, { prev: prev(5) }) }} />);
    expect(screen.getByText('4')).toBeInTheDocument();
    const delta = screen.getByText('↑1');
    expect(delta.className).toMatch(/green|emerald/);
  });
  it('colours a decline red and a flat change neutrally', () => {
    const { rerender } = render(<NumberCell value={7} config={{ displayStyle: 'trend', trendField: 'd' }} rowData={{ d: found(7, { prev: prev(4) }) }} />);
    expect(screen.getByText('↓3').className).toMatch(/red/);
    rerender(<NumberCell value={4} config={{ displayStyle: 'trend', trendField: 'd' }} rowData={{ d: found(4, { prev: prev(4) }) }} />);
    expect(screen.getByText('—').className).not.toMatch(/red|green|emerald/);
  });
  it('falls back to the plain number when the sidecar is missing', () => {
    render(<NumberCell value={6} config={{ displayStyle: 'trend', trendField: 'd' }} rowData={{}} />);
    expect(screen.getByText('6')).toBeInTheDocument();
  });
});
