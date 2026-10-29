/**
 * BoundRowsStrip — parent-owned bound-row display and unbind (ADR-203 G9).
 *
 * The historical RowBindingV2 assertions "shows bound rows list when expanded"
 * and "calls onUnbind when clicking delete on bound row" described a list that
 * lived inside the picker. That list no longer exists: in the live tree
 * (AIChatPanel → BoundRowsStrip) the bound rows are rendered by the parent as
 * BoundRowChip pills, and removal is the toolbar's "Открепить" button, which
 * drops exactly the (table_id, row_id) pair and persists the unbind.
 *
 * Everything below renders the REAL composition — BoundRowsStrip, BoundRowChip,
 * BoundRowToolbar, useBoundRowDisplay and the lazily loaded RowBindingV2 picker.
 * Only the network boundary (apiClient) is mocked.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { apiClient } from '@/shared/utils/apiClient';
import { BoundRowsStrip } from '../BoundRowsStrip';

vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: { request: vi.fn(), get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }
}));

const TASKS_ROWS = [
  { id: 1, table_id: 1, data: { title: 'Task One' } },
  { id: 2, table_id: 1, data: { title: 'Task Two' } }
];

type BoundRow = { table_id: number; row_id: number; table_name?: string; row_title?: string };
const ROW_ONE: BoundRow = { table_id: 1, row_id: 1, table_name: 'Tasks', row_title: 'Task One' };
const ROW_TWO: BoundRow = { table_id: 1, row_id: 2, table_name: 'Tasks', row_title: 'Task Two' };

function mockApi() {
  vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
    if (/\/tables\/1\/rows\/\d+$/.test(url)) {
      const id = Number(url.split('/').pop());
      return { success: true, data: { row: TASKS_ROWS.find(r => r.id === id) } };
    }
    if (url.includes('/columns')) return { success: true, data: [] };
    if (url.includes('/tables/1/rows')) return { success: true, data: { rows: TASKS_ROWS } };
    return { success: false };
  });
  // useAllTables (inside the real RowBindingV2 picker) goes through apiClient.request.
  vi.mocked(apiClient.request).mockImplementation(async (url: string) => {
    if (url === '/spaces') return { data: [{ id: 1, name: 'Main Space' }] };
    if (url === '/projects') return { data: [{ id: 10, name: 'Project Alpha', space_id: 1 }] };
    if (url === '/projects/10/tables') return { data: [{ id: 1, project_id: 10, name: 'tasks', display_name: 'Tasks' }] };
    return { data: [] };
  });
  vi.mocked(apiClient.patch).mockResolvedValue({ success: true });
}

type SetBoundRows = Mock<(fn: (prev: BoundRow[]) => BoundRow[]) => void>;

function renderStrip(overrides: { boundRows?: BoundRow[]; showRowBinding?: boolean; currentConversationId?: number | null } = {}) {
  const setBoundRows: SetBoundRows = vi.fn();
  const setShowRowBinding = vi.fn<(v: boolean) => void>();
  const setShowBoundRowsBar = vi.fn<(v: boolean) => void>();
  renderWithProviders(
    <BoundRowsStrip
      boundRows={[ROW_ONE, ROW_TWO]}
      showRowBinding={false}
      currentConversationId={77}
      {...overrides}
      setBoundRows={setBoundRows}
      setShowRowBinding={setShowRowBinding}
      setShowBoundRowsBar={setShowBoundRowsBar}
      userConversationId={null}
      effectiveSpaceId={1}
      tasksSource={undefined}
    />
  );
  return { setBoundRows, setShowRowBinding, setShowBoundRowsBar };
}

/** Apply the functional updater BoundRowsStrip hands to setBoundRows. */
function applyUpdater(setBoundRows: SetBoundRows, prev: BoundRow[]) {
  expect(setBoundRows).toHaveBeenCalledTimes(1);
  return setBoundRows.mock.calls[0][0](prev);
}

describe('BoundRowsStrip — parent-owned bound rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi();
  });

  it('displays every bound row as a chip carrying its identity', () => {
    renderStrip();
    expect(screen.getByRole('button', { name: 'Task One' })).toHaveAttribute('title', 'Tasks · Task One');
    expect(screen.getByRole('button', { name: 'Task Two' })).toHaveAttribute('title', 'Tasks · Task Two');
    // No picker while rows are bound.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('unbinds exactly the selected (table_id, row_id) pair and persists the unbind', () => {
    const { setBoundRows } = renderStrip();

    fireEvent.click(screen.getByRole('button', { name: 'Task Two' }));
    expect(screen.getByText('2/2')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Открепить'));

    expect(applyUpdater(setBoundRows, [ROW_ONE, ROW_TWO])).toEqual([ROW_ONE]);
    expect(apiClient.patch).toHaveBeenCalledExactlyOnceWith('/chat/conversations/77', {
      bound_table_id: null,
      bound_row_id: null
    });
    // Toolbar closes after unbind.
    expect(screen.queryByTitle('Открепить')).not.toBeInTheDocument();
  });

  it('does not call the API when there is no conversation to persist to', () => {
    const { setBoundRows } = renderStrip({ boundRows: [ROW_ONE], currentConversationId: null });

    fireEvent.click(screen.getByRole('button', { name: 'Task One' }));
    fireEvent.click(screen.getByTitle('Открепить'));

    expect(applyUpdater(setBoundRows, [ROW_ONE])).toEqual([]);
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  it('turns a binding request into the first row toolbar while a row is bound', () => {
    const { setShowRowBinding } = renderStrip({ boundRows: [ROW_ONE], showRowBinding: true });

    expect(setShowRowBinding).toHaveBeenCalledWith(false);
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(screen.getByTitle('Открепить')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('binds through the real expanded picker and persists the pair', async () => {
    const { setBoundRows, setShowRowBinding, setShowBoundRowsBar } = renderStrip({
      boundRows: [],
      showRowBinding: true
    });

    // RowBindingV2 is React.lazy: wait for the real picker, not a stub.
    const selects = await screen.findAllByRole('combobox', {}, { timeout: 4000 });
    fireEvent.change(selects[0], { target: { value: '10' } });
    await waitFor(() => expect(selects[1]).not.toBeDisabled());
    fireEvent.change(selects[1], { target: { value: '1' } });

    const row = await screen.findByText('Task One');
    expect(screen.queryByTitle('Открепить')).not.toBeInTheDocument();
    fireEvent.click(row);

    expect(applyUpdater(setBoundRows, [])).toEqual([
      expect.objectContaining({ table_id: 1, row_id: 1, row_title: 'Task One', table_name: 'Tasks' })
    ]);
    expect(apiClient.patch).toHaveBeenCalledExactlyOnceWith('/chat/conversations/77', {
      bound_table_id: 1,
      bound_row_id: 1
    });
    expect(setShowRowBinding).toHaveBeenCalledWith(false);
    expect(setShowBoundRowsBar).toHaveBeenCalledWith(true);
    expect(within(row.closest('button')!).queryByText('привязано')).not.toBeInTheDocument();
  }, 10000);
});
