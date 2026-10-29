import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AutomationTab, automationTouchesColumn } from '../AutomationTab';
import type { Automation } from '@/features/automations/api/automationsApi';
import { createMockColumn } from '../../__tests__/columnSettingsTestUtils';

const getByTable = vi.fn();
const mutate = vi.fn();

vi.mock('@/features/automations/api/automationsApi', () => ({
  automationsApi: {
    getByTable: (...args: unknown[]) => getByTable(...args),
    toggle: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/features/automations/api/useAutomations', () => ({
  useCreateAutomation: () => ({ mutate, isPending: false }),
}));

vi.mock('@/shared/hooks/useToast', () => ({ showToast: vi.fn() }));

// AutomationModal deps (same mocks as AutomationsPage.test)
vi.mock('@/features/projects/hooks/useProjectTables', () => ({
  useProjectTables: () => ({ data: [], isLoading: false }),
}));
vi.mock('@/features/spaces/hooks/useSpacesQuery', () => ({
  useSpacesQuery: () => ({ data: [], isLoading: false }),
}));
vi.mock('@/features/projects/store/projectStore', () => ({
  useProjectStore: (selector: (s: { projects: unknown[] }) => unknown) => selector({ projects: [] }),
}));

// Real shapes from master A (automations_list rows for table 101024)
const watchStatus: Automation = {
  id: '254140',
  name: 'Возвраты: статус ✓ → цвет #84cc16',
  table_id: 101024,
  is_active: true,
  trigger_type: 'row_update',
  trigger_config: { equals: true, watch_field: 'status' },
  action_type: 'update_field',
  action_config: { value: '#84cc16', column_id: 'colour' },
  created_at: '2026-10-20T05:45:16.679Z',
  updated_at: '2026-10-20T05:45:16.679Z',
};
const unrelated: Automation = {
  ...watchStatus,
  id: '999',
  name: 'Другая колонка',
  trigger_config: { watch_field: 'amount' },
  action_config: { column_id: 'note', value: '' },
};
const legacyNumericId: Automation = {
  ...watchStatus,
  id: '1000',
  name: 'Legacy columnId',
  trigger_config: { columnId: 4567 },
  action_config: {},
};

const renderTab = (column = createMockColumn({ id: '4567', name: 'status', displayName: 'Статус' })) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AutomationTab draft={column} tableId={101024} projectId={8} tableName="Возвраты" language="ru" />
    </QueryClientProvider>
  );
};

describe('automationTouchesColumn', () => {
  const status = { id: '4567', name: 'status' };

  it('matches trigger watch_field by column key', () => {
    expect(automationTouchesColumn(watchStatus, status)).toBe(true);
  });

  it('matches update_field target by column key', () => {
    expect(automationTouchesColumn(watchStatus, { id: '1', name: 'colour' })).toBe(true);
  });

  it('matches legacy numeric columnId by column id', () => {
    expect(automationTouchesColumn(legacyNumericId, status)).toBe(true);
  });

  it('ignores automations that reference other columns', () => {
    expect(automationTouchesColumn(unrelated, status)).toBe(false);
  });
});

describe('AutomationTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getByTable.mockResolvedValue([watchStatus, unrelated]);
  });

  it('lists only automations that reference this column, with trigger/action labels and column refs', async () => {
    renderTab();
    expect(await screen.findByText('Возвраты: статус ✓ → цвет #84cc16')).toBeInTheDocument();
    expect(screen.queryByText('Другая колонка')).not.toBeInTheDocument();
    expect(screen.getByText(/Изменение записи → Обновить поле/)).toBeInTheDocument();
    expect(screen.getByText('следит: status')).toBeInTheDocument();
    expect(screen.getByText('пишет: colour')).toBeInTheDocument();
    expect(getByTable).toHaveBeenCalledWith(101024);
  });

  it('shows the empty state when nothing references the column', async () => {
    getByTable.mockResolvedValue([unrelated]);
    renderTab();
    expect(await screen.findByText('Нет автоматизаций для этой колонки')).toBeInTheDocument();
  });

  it('opens the shared modal prefilled with row_update + watch_field and creates via the automations hook', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Возвраты: статус ✓ → цвет #84cc16');

    await user.click(screen.getByRole('button', { name: /Новая автоматизация/ }));

    const watched = await screen.findByLabelText(/Отслеживаемое поле/);
    expect(watched).toHaveValue('status');
    expect(screen.getByLabelText(/Триггер \(когда запускать\)/)).toHaveValue('row_update');

    await user.click(screen.getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0]).toMatchObject({
      name: 'Возвраты: Статус',
      tableId: '101024',
      triggerType: 'row_update',
      triggerConfig: { watch_field: 'status' },
      actionType: 'webhook',
    });
    expect(screen.queryByLabelText(/Отслеживаемое поле/)).not.toBeInTheDocument();
  });

  it('hides the create button for system columns', async () => {
    getByTable.mockResolvedValue([]);
    renderTab(createMockColumn({ id: '__sys_created_at', name: 'created_at', displayName: 'Создано' }));
    await screen.findByText('Нет автоматизаций для этой колонки');
    expect(screen.queryByRole('button', { name: /Новая автоматизация/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Системные колонки/)).toBeInTheDocument();
  });
});
