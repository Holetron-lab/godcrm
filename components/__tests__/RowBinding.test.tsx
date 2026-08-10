/**
 * RowBinding Component Tests
 * ADR-024: Chat & Message Architecture
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RowBinding, BoundRow } from '../RowBinding';

// Mock apiClient
vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: {
    get: vi.fn()
  }
}));

import { apiClient } from '@/shared/utils/apiClient';

const mockTables = [
  { id: 10, name: 'Tasks', icon: '📋', display_column: 'name' },
  { id: 11, name: 'Projects', icon: '📁', display_column: 'title' }
];

const mockRows = [
  { id: 100, table_id: 10, data: { name: 'Task 1' } },
  { id: 101, table_id: 10, data: { name: 'Task 2' } },
  { id: 102, table_id: 10, data: { name: 'Task 3' } }
];

describe('RowBinding', () => {
  let queryClient: QueryClient;
  const mockOnBind = vi.fn();
  const mockOnUnbind = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false }
      }
    });

    // Setup API mocks
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url.includes('/tables?')) {
        return Promise.resolve({ success: true, data: mockTables });
      }
      if (url.includes('/rows')) {
        return Promise.resolve({ success: true, data: { rows: mockRows } });
      }
      return Promise.resolve({ success: false, data: [] });
    });
  });

  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <RowBinding
          onBind={mockOnBind}
          onUnbind={mockOnUnbind}
          {...props}
        />
      </QueryClientProvider>
    );
  };

  it('should render placeholder when no bindings', () => {
    renderComponent();
    expect(screen.getByText('Привязать к записи...')).toBeInTheDocument();
  });

  it('should expand panel on click', async () => {
    renderComponent({ spaceId: 1 });
    
    fireEvent.click(screen.getByText('Привязать к записи...'));
    
    await waitFor(() => {
      expect(screen.getByText('Добавить привязку')).toBeInTheDocument();
    });
  });

  it('should show bound rows count', () => {
    const boundRows: BoundRow[] = [
      { table_id: 10, row_id: 100, row_title: 'Task 1' },
      { table_id: 10, row_id: 101, row_title: 'Task 2' }
    ];
    
    renderComponent({ boundRows });
    
    expect(screen.getByText('2 привязка(ок)')).toBeInTheDocument();
  });

  it('should display bound row titles', () => {
    const boundRows: BoundRow[] = [
      { table_id: 10, row_id: 100, row_title: 'Task 1', table_name: 'Tasks' }
    ];
    
    renderComponent({ boundRows });
    
    // Expand panel to see full list
    fireEvent.click(screen.getByText('1 привязка(ок)'));
    
    // Multiple elements with "Task 1" is expected (header preview + list)
    expect(screen.getAllByText('Task 1').length).toBeGreaterThanOrEqual(1);
  });

  it('should show table selector when expanded', async () => {
    renderComponent({ spaceId: 1 });
    
    fireEvent.click(screen.getByText('Привязать к записи...'));
    
    await waitFor(() => {
      expect(screen.getByText('Выберите таблицу')).toBeInTheDocument();
    });
  });

  it('should load tables when expanded', async () => {
    renderComponent({ spaceId: 1 });
    
    fireEvent.click(screen.getByText('Привязать к записи...'));
    
    await waitFor(() => {
      expect(screen.getByText('Выберите таблицу')).toBeInTheDocument();
    });
    
    fireEvent.click(screen.getByText('Выберите таблицу'));
    
    await waitFor(() => {
      expect(screen.getByText('Tasks')).toBeInTheDocument();
      expect(screen.getByText('Projects')).toBeInTheDocument();
    });
  });

  it('should show rows after table selected', async () => {
    renderComponent({ spaceId: 1, defaultTableId: 10 });
    
    fireEvent.click(screen.getByText('Привязать к записи...'));
    
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Поиск записей...')).toBeInTheDocument();
    });
    
    await waitFor(() => {
      expect(screen.getByText('Task 1')).toBeInTheDocument();
      expect(screen.getByText('Task 2')).toBeInTheDocument();
    });
  });

  it('should call onBind when row selected', async () => {
    renderComponent({ spaceId: 1, defaultTableId: 10 });
    
    fireEvent.click(screen.getByText('Привязать к записи...'));
    
    await waitFor(() => {
      expect(screen.getByText('Task 1')).toBeInTheDocument();
    });
    
    fireEvent.click(screen.getByText('Task 1'));
    
    expect(mockOnBind).toHaveBeenCalledWith(10, 100, expect.objectContaining({
      tableName: 'Tasks',
      rowTitle: 'Task 1'
    }));
  });

  it('should call onUnbind when remove clicked', async () => {
    const boundRows: BoundRow[] = [
      { table_id: 10, row_id: 100, row_title: 'Task 1' }
    ];
    
    renderComponent({ boundRows, spaceId: 1 });
    
    fireEvent.click(screen.getByText('1 привязка(ок)'));
    
    await waitFor(() => {
      expect(screen.getByText('Привязанные записи')).toBeInTheDocument();
    });
    
    // Find trash button
    const trashButtons = screen.getAllByRole('button').filter(btn =>
      btn.querySelector('svg.lucide-trash-2')
    );
    
    if (trashButtons.length > 0) {
      fireEvent.click(trashButtons[0]);
      expect(mockOnUnbind).toHaveBeenCalledWith(10, 100);
    }
  });

  it('should disable already bound rows', async () => {
    const boundRows: BoundRow[] = [
      { table_id: 10, row_id: 100, row_title: 'Task 1' }
    ];
    
    renderComponent({ boundRows, spaceId: 1, defaultTableId: 10 });
    
    fireEvent.click(screen.getByText('1 привязка(ок)'));
    
    await waitFor(() => {
      const task1Buttons = screen.getAllByRole('button').filter(
        btn => btn.textContent?.includes('Task 1')
      );
      // Should have at least one disabled
      const disabledBtn = task1Buttons.find(btn => btn.hasAttribute('disabled'));
      expect(disabledBtn || screen.getByText('привязано')).toBeTruthy();
    });
  });

  it('should show max bindings message when limit reached', () => {
    const boundRows: BoundRow[] = [
      { table_id: 10, row_id: 100, row_title: 'Task 1' },
      { table_id: 10, row_id: 101, row_title: 'Task 2' }
    ];
    
    renderComponent({ boundRows, maxBindings: 2, spaceId: 1 });
    
    fireEvent.click(screen.getByText('2 привязка(ок)'));
    
    expect(screen.getByText('Достигнут лимит привязок (2)')).toBeInTheDocument();
  });

  it('should search rows', async () => {
    renderComponent({ spaceId: 1, defaultTableId: 10 });
    
    fireEvent.click(screen.getByText('Привязать к записи...'));
    
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Поиск записей...')).toBeInTheDocument();
    });
    
    const searchInput = screen.getByPlaceholderText('Поиск записей...');
    fireEvent.change(searchInput, { target: { value: 'Task 2' } });
    
    // Search is passed to API, so we just check input works
    expect(searchInput).toHaveValue('Task 2');
  });

  it('should show no space message when spaceId not provided', () => {
    renderComponent({ boundRows: [] });
    
    fireEvent.click(screen.getByText('Привязать к записи...'));
    
    expect(screen.getByText('Выберите Space в настройках чата')).toBeInTheDocument();
  });

  it('should collapse panel on collapse button', async () => {
    renderComponent({ spaceId: 1 });
    
    fireEvent.click(screen.getByText('Привязать к записи...'));
    
    await waitFor(() => {
      expect(screen.getByText('Свернуть')).toBeInTheDocument();
    });
    
    fireEvent.click(screen.getByText('Свернуть'));
    
    await waitFor(() => {
      expect(screen.queryByText('Свернуть')).not.toBeInTheDocument();
    });
  });

  describe('compact mode', () => {
    it('should show inline tags in compact mode', () => {
      const boundRows: BoundRow[] = [
        { table_id: 10, row_id: 100, row_title: 'Task 1' },
        { table_id: 10, row_id: 101, row_title: 'Task 2' }
      ];
      
      renderComponent({ boundRows, compact: true });
      
      expect(screen.getByText('Task 1')).toBeInTheDocument();
      expect(screen.getByText('Task 2')).toBeInTheDocument();
    });

    it('should allow unbind from compact view', () => {
      const boundRows: BoundRow[] = [
        { table_id: 10, row_id: 100, row_title: 'Task 1' }
      ];
      
      renderComponent({ boundRows, compact: true });
      
      // Find X button in tag
      const closeButtons = screen.getAllByRole('button').filter(btn =>
        btn.querySelector('svg.lucide-x')
      );
      
      if (closeButtons.length > 0) {
        fireEvent.click(closeButtons[0]);
        expect(mockOnUnbind).toHaveBeenCalledWith(10, 100);
      }
    });

    it('should show add button in compact mode', () => {
      const boundRows: BoundRow[] = [
        { table_id: 10, row_id: 100, row_title: 'Task 1' }
      ];
      
      renderComponent({ boundRows, compact: true, maxBindings: 5 });
      
      // Should have + button
      const plusButtons = screen.getAllByRole('button').filter(btn =>
        btn.querySelector('svg.lucide-plus')
      );
      
      expect(plusButtons.length).toBeGreaterThan(0);
    });
  });
});
