import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTableCellActions } from '../useTableCellActions';
import { useTablesStore } from '../../../store/tablesStore';
import type { ColumnModel, RowModel, TableModel } from '../../../types/table.types';

const pending = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../hooks/useRowMutations', () => ({ getPendingValue: pending.get }));
vi.mock('@/shared/hooks/useToast', () => ({ showToast: vi.fn() }));

const column = { id: 'value', name: 'value', type: 'text', config: {} } as ColumnModel;
const row: RowModel = {
  id: '1', tableId: '42', data: { value: 'before', sibling: 'keep' },
  createdAt: '', updatedAt: '', createdBy: 'test',
};
const table = { id: '42' } as TableModel;
const mutate = vi.fn();
const localUpdate = vi.fn();
const defaults = {
  table, columns: [column], rows: [row], rowMutation: { mutate },
  isReadOnlyContext: false, isViewerRole: false, onLocalCellUpdate: localUpdate,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  pending.get.mockReturnValue(undefined);
  useTablesStore.setState({ rows: {} });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it('commits the current draft once, preserving sibling cells, and cancels cleanly', () => {
  const { result } = renderHook(() => useTableCellActions(defaults));
  act(() => result.current.handleCellDoubleClick('1', 'value', 'before'));
  act(() => result.current.setDraftValue('after'));
  act(() => {
    result.current.handleCommitEdit();
    result.current.handleCommitEdit();
  });
  expect(mutate).toHaveBeenCalledExactlyOnceWith({
    rowId: '1', columnId: 'value', value: 'after', data: { value: 'after', sibling: 'keep' },
  });
  expect(result.current.editingCell).toBeNull();
  act(() => result.current.handleCellDoubleClick('1', 'value', 'next'));
  act(() => result.current.handleCancelEdit());
  expect(result.current.draftValue).toBe('');
  expect(result.current.editingCell).toBeNull();
});

it.each(['isReadOnlyContext', 'isViewerRole'] as const)('blocks editing and quick mutations for %s', guard => {
  const { result } = renderHook(() => useTableCellActions({ ...defaults, [guard]: true }));
  act(() => {
    result.current.handleCellDoubleClick('1', 'value', 'text');
    result.current.handleCheckboxToggle('1', 'value', false);
    result.current.handleNumberStep('1', 'value', 4, 1);
  });
  expect(result.current.editingCell).toBeNull();
  expect(mutate).not.toHaveBeenCalled();
  expect(localUpdate).not.toHaveBeenCalled();
});

it('keeps invalid coordinates open and commits valid coordinates through the shared parser', () => {
  const { result } = renderHook(() => useTableCellActions({
    ...defaults, columns: [{ ...column, type: 'geo_point' }],
  }));
  act(() => result.current.handleCellDoubleClick('1', 'value', null));
  act(() => result.current.handleCommitEdit('invalid'));
  expect(mutate).not.toHaveBeenCalled();
  expect(result.current.editingCell).toEqual({ rowId: '1', columnId: 'value' });
  act(() => result.current.handleCommitEdit('55.75, 37.61'));
  expect(mutate.mock.calls[0][0].value).toEqual({ lat: 55.75, lng: 37.61, source: 'raw' });
});

it('formats JSON drafts without losing objects and parses address edits', () => {
  const { result, rerender } = renderHook(({ type }) => useTableCellActions({
    ...defaults, columns: [{ ...column, type }],
  }), { initialProps: { type: 'json' as ColumnModel['type'] } });
  act(() => result.current.handleCellDoubleClick('1', 'value', { nested: [1] }));
  expect(result.current.draftValue).toBe(JSON.stringify({ nested: [1] }, null, 2));
  rerender({ type: 'address' });
  act(() => result.current.handleCommitEdit('{"formatted":"Moscow","city":"Moscow"}'));
  expect(mutate.mock.calls[0][0].value).toEqual({ formatted: 'Moscow', city: 'Moscow' });
});

it('toggles configured checkbox values and takes the freshest numeric value within bounds', () => {
  const { result } = renderHook(() => useTableCellActions(defaults));
  act(() => result.current.handleCheckboxToggle('1', 'value', 'yes', { trueValue: 'yes', falseValue: 'no' }));
  expect(mutate.mock.lastCall?.[0].value).toBe('no');
  useTablesStore.setState({ rows: { '42': [{ ...row, data: { value: 20 } }] } });
  act(() => result.current.handleNumberStep('1', 'value', 1, 1, { step: 2 }));
  expect(mutate.mock.lastCall?.[0].value).toBe(22);
  pending.get.mockReturnValue(30);
  act(() => result.current.handleNumberStep('1', 'value', 1, 1, { step: 2, max: 31 }));
  expect(mutate.mock.lastCall?.[0].value).toBe(31);
  expect(localUpdate).toHaveBeenLastCalledWith('1', 'value', 31);
  pending.get.mockReturnValue(-5);
  act(() => result.current.handleNumberStep('1', 'value', 1, -1, { min: 0 }));
  expect(mutate.mock.lastCall?.[0].value).toBe(0);
});

it('copies only permitted nonempty values with Ctrl or Meta', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const { result, rerender } = renderHook(({ col }) => useTableCellActions({ ...defaults, columns: [col] }), {
    initialProps: { col: column },
  });
  const event = { ctrlKey: true } as React.MouseEvent;
  await act(async () => result.current.handleCellClick('text', 'value', event));
  expect(writeText).toHaveBeenCalledExactlyOnceWith('text');
  rerender({ col: { ...column, type: 'password' } });
  act(() => result.current.handleCellClick('secret', 'value', event));
  rerender({ col: { ...column, config: { copyable: false } } });
  act(() => result.current.handleCellClick('hidden', 'value', event));
  rerender({ col: column });
  act(() => {
    result.current.handleCellClick('text', 'value');
    result.current.handleCellClick('—', 'value', event);
  });
  expect(writeText).toHaveBeenCalledTimes(1);
});
