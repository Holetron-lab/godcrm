/**
 * RowBindingV2 Tests
 * ADR-024: Chat & Message Architecture
 * 
 * Tests for the simplified RowBindingV2 using useAllTables hook
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RowBindingV2 } from '../RowBindingV2';

// Mock useAllTables hook
vi.mock('@/features/tables/hooks/useAllTables', () => ({
  useAllTables: vi.fn(() => ({
    data: {
      spacesWithTables: [
        {
          id: 1,
          name: 'Main Space',
          icon: '🏠',
          projects: [
            {
              id: 1,
              name: 'Project Alpha',
              icon: '📂',
              tables: [
                { id: '1', name: 'tasks', displayName: 'Tasks', icon: '📋', displayField: 'title', projectId: 1, spaceId: 1 },
                { id: '2', name: 'contacts', displayName: 'Contacts', icon: '👤', displayField: 'name', projectId: 1, spaceId: 1 }
              ]
            },
            {
              id: 2,
              name: 'Project Beta',
              icon: '📁',
              tables: [
                { id: '3', name: 'orders', displayName: 'Orders', icon: '🛒', displayField: 'number', projectId: 2, spaceId: 1 }
              ]
            }
          ]
        }
      ],
      flat: [
        { id: '1', name: 'tasks', displayName: 'Tasks', icon: '📋', displayField: 'title', projectId: 1, projectName: 'Project Alpha', spaceId: 1 },
        { id: '2', name: 'contacts', displayName: 'Contacts', icon: '👤', displayField: 'name', projectId: 1, projectName: 'Project Alpha', spaceId: 1 },
        { id: '3', name: 'orders', displayName: 'Orders', icon: '🛒', displayField: 'number', projectId: 2, projectName: 'Project Beta', spaceId: 1 }
      ]
    },
    isLoading: false,
    error: null
  }))
}));

// Mock apiClient for rows
vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: {
    get: vi.fn().mockImplementation((url: string) => {
      if (url.includes('/rows')) {
        return Promise.resolve({
          success: true,
          data: {
            rows: [
              { id: 1, table_id: 1, data: { title: 'Task One', status: 'open' } },
              { id: 2, table_id: 1, data: { title: 'Task Two', status: 'done' } },
              { id: 3, table_id: 1, data: { title: 'Task Three', status: 'open' } }
            ]
          }
        });
      }
      return Promise.resolve({ success: false });
    })
  }
}));

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
}

describe('RowBindingV2', () => {
  const mockOnBind = vi.fn();
  const mockOnUnbind = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders header with "Привязать к записи" text', () => {
    renderWithProviders(
      <RowBindingV2
        defaultSpaceId={1}
        onBind={mockOnBind}
        onUnbind={mockOnUnbind}
      />
    );

    expect(screen.getByText('Привязать к записи')).toBeInTheDocument();
  });

  it('expands when clicked', async () => {
    renderWithProviders(
      <RowBindingV2
        defaultSpaceId={1}
        onBind={mockOnBind}
        onUnbind={mockOnUnbind}
      />
    );

    fireEvent.click(screen.getByText('Привязать к записи'));

    await waitFor(() => {
      // Default tab bar shows "Другая таблица" when no tasksSource
      expect(screen.getByText('Другая таблица')).toBeInTheDocument();
    });

    // Click "Другая таблица" tab to see project/table selectors
    fireEvent.click(screen.getByText('Другая таблица'));

    await waitFor(() => {
      expect(screen.getByText('Проект')).toBeInTheDocument();
      expect(screen.getByText('Таблица')).toBeInTheDocument();
    });
  });

  it('shows bound rows count badge', () => {
    const boundRows = [
      { table_id: 1, row_id: 1, row_title: 'Task One', table_name: 'Tasks' }
    ];
    
    renderWithProviders(
      <RowBindingV2
        defaultSpaceId={1}
        boundRows={boundRows}
        onBind={mockOnBind}
        onUnbind={mockOnUnbind}
      />
    );

    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('shows compact bound rows with badges', () => {
    const boundRows = [
      { table_id: 1, row_id: 1, row_title: 'Task One' },
      { table_id: 1, row_id: 2, row_title: 'Task Two' }
    ];
    
    renderWithProviders(
      <RowBindingV2
        defaultSpaceId={1}
        boundRows={boundRows}
        compact={true}
        onBind={mockOnBind}
        onUnbind={mockOnUnbind}
      />
    );

    expect(screen.getByText('Task One')).toBeInTheDocument();
    expect(screen.getByText('Task Two')).toBeInTheDocument();
  });

  it('shows project selector with optgroups after expanding', async () => {
    renderWithProviders(
      <RowBindingV2
        defaultSpaceId={1}
        onBind={mockOnBind}
        onUnbind={mockOnUnbind}
      />
    );

    fireEvent.click(screen.getByText('Привязать к записи'));

    // Click "Другая таблица" tab to see project selector
    await waitFor(() => {
      expect(screen.getByText('Другая таблица')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Другая таблица'));

    await waitFor(() => {
      // Check for optgroup labels and options
      expect(screen.getByText('— Выберите проект —')).toBeInTheDocument();
    });
  });

  it('enables table selector after project selection', async () => {
    renderWithProviders(
      <RowBindingV2
        defaultSpaceId={1}
        onBind={mockOnBind}
        onUnbind={mockOnUnbind}
      />
    );

    fireEvent.click(screen.getByText('Привязать к записи'));

    // Click "Другая таблица" tab first
    await waitFor(() => {
      expect(screen.getByText('Другая таблица')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Другая таблица'));

    await waitFor(() => {
      expect(screen.getByText('Проект')).toBeInTheDocument();
    });

    // Find project selector by placeholder option
    const selects = screen.getAllByRole('combobox');
    const projectSelect = selects[0]; // First select is project
    fireEvent.change(projectSelect, { target: { value: '1' } });

    await waitFor(() => {
      const tableSelect = selects[1];
      expect(tableSelect).not.toBeDisabled();
    });
  });

  it('shows row search after table selection', async () => {
    renderWithProviders(
      <RowBindingV2
        defaultSpaceId={1}
        defaultTableId={1}
        onBind={mockOnBind}
        onUnbind={mockOnUnbind}
      />
    );

    fireEvent.click(screen.getByText('Привязать к записи'));

    // Switch to "Другая таблица" tab to see the row search
    await waitFor(() => {
      expect(screen.getByText('Другая таблица')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Другая таблица'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Поиск записей...')).toBeInTheDocument();
    });
  });

  it('shows rows for selected table', async () => {
    renderWithProviders(
      <RowBindingV2
        defaultSpaceId={1}
        defaultTableId={1}
        onBind={mockOnBind}
        onUnbind={mockOnUnbind}
      />
    );

    fireEvent.click(screen.getByText('Привязать к записи'));

    // Switch to "Другая таблица" tab to see rows
    await waitFor(() => {
      expect(screen.getByText('Другая таблица')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Другая таблица'));

    await waitFor(() => {
      expect(screen.getByText('Task One')).toBeInTheDocument();
      expect(screen.getByText('Task Two')).toBeInTheDocument();
      expect(screen.getByText('Task Three')).toBeInTheDocument();
    });
  });

  it('calls onBind when selecting a row', async () => {
    renderWithProviders(
      <RowBindingV2
        defaultSpaceId={1}
        defaultTableId={1}
        onBind={mockOnBind}
        onUnbind={mockOnUnbind}
      />
    );

    fireEvent.click(screen.getByText('Привязать к записи'));

    // Switch to "Другая таблица" tab to see rows
    await waitFor(() => {
      expect(screen.getByText('Другая таблица')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Другая таблица'));

    await waitFor(() => {
      expect(screen.getByText('Task One')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Task One'));

    expect(mockOnBind).toHaveBeenCalledWith(
      expect.objectContaining({
        table_id: 1,
        row_id: 1,
        row_title: 'Task One'
      })
    );
  });

  it('shows collapse button in expanded mode', async () => {
    renderWithProviders(
      <RowBindingV2
        defaultSpaceId={1}
        onBind={mockOnBind}
        onUnbind={mockOnUnbind}
      />
    );

    fireEvent.click(screen.getByText('Привязать к записи'));
    
    await waitFor(() => {
      expect(screen.getByText('Свернуть')).toBeInTheDocument();
    });
  });

  it('respects maxBindings limit', async () => {
    const boundRows = [
      { table_id: 1, row_id: 1, row_title: 'Task One' },
      { table_id: 1, row_id: 2, row_title: 'Task Two' }
    ];
    
    renderWithProviders(
      <RowBindingV2
        defaultSpaceId={1}
        boundRows={boundRows}
        maxBindings={2}
        onBind={mockOnBind}
        onUnbind={mockOnUnbind}
      />
    );

    fireEvent.click(screen.getByText('Привязать к записи'));
    
    await waitFor(() => {
      expect(screen.getByText(/Достигнут лимит привязок/)).toBeInTheDocument();
    });
  });

  it('shows bound rows list when expanded', async () => {
    const boundRows = [
      { table_id: 1, row_id: 1, row_title: 'Task One', table_name: 'Tasks', table_icon: '📋' }
    ];
    
    renderWithProviders(
      <RowBindingV2
        defaultSpaceId={1}
        boundRows={boundRows}
        onBind={mockOnBind}
        onUnbind={mockOnUnbind}
      />
    );

    fireEvent.click(screen.getByText('Привязать к записи'));
    
    await waitFor(() => {
      expect(screen.getByText('Привязанные записи (1/10)')).toBeInTheDocument();
      expect(screen.getByText('Task One')).toBeInTheDocument();
    });
  });

  it('calls onUnbind when clicking delete on bound row', async () => {
    const boundRows = [
      { table_id: 1, row_id: 1, row_title: 'Task One', table_name: 'Tasks' }
    ];
    
    renderWithProviders(
      <RowBindingV2
        defaultSpaceId={1}
        boundRows={boundRows}
        onBind={mockOnBind}
        onUnbind={mockOnUnbind}
      />
    );

    fireEvent.click(screen.getByText('Привязать к записи'));
    
    await waitFor(() => {
      expect(screen.getByText('Task One')).toBeInTheDocument();
    });

    // Find trash button
    const trashButtons = document.querySelectorAll('button');
    const trashButton = Array.from(trashButtons).find(btn => 
      btn.querySelector('svg.lucide-trash-2')
    );
    
    if (trashButton) {
      fireEvent.click(trashButton);
      expect(mockOnUnbind).toHaveBeenCalledWith(1, 1);
    }
  });

  it('shows green indicator when table is selected', async () => {
    renderWithProviders(
      <RowBindingV2
        defaultSpaceId={1}
        defaultTableId={1}
        onBind={mockOnBind}
        onUnbind={mockOnUnbind}
      />
    );

    fireEvent.click(screen.getByText('Привязать к записи'));

    // Switch to "Другая таблица" tab to see the green indicator
    await waitFor(() => {
      expect(screen.getByText('Другая таблица')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Другая таблица'));

    await waitFor(() => {
      // Should show green indicator with table info (class contains bg-green-500/10)
      const greenIndicator = document.querySelector('[class*="bg-green-500"]');
      expect(greenIndicator).toBeInTheDocument();
    });
  });

  // ADR-024: Auto-mapping to Tasks table
  describe('Tasks Auto-Mapping', () => {
    const tasksSource = {
      tableId: 1,
      tableName: 'Задачи',
      tableIcon: '📋',
      displayColumn: 'title'
    };

    it('shows tasks list immediately when tasksSource is provided', async () => {
      renderWithProviders(
        <RowBindingV2
          defaultSpaceId={1}
          tasksSource={tasksSource}
          onBind={mockOnBind}
          onUnbind={mockOnUnbind}
        />
      );

      fireEvent.click(screen.getByText('Привязать к записи'));
      
      await waitFor(() => {
        // Should show "Quick Tasks" section (emoji and text are separate spans)
        expect(screen.getByText('Задачи')).toBeInTheDocument();
        expect(screen.getByText('📋')).toBeInTheDocument();
      });

      await waitFor(() => {
        // Tasks from the table should be visible
        expect(screen.getByText('Task One')).toBeInTheDocument();
        expect(screen.getByText('Task Two')).toBeInTheDocument();
      });
    });

    it('allows selecting a task from quick tasks section', async () => {
      renderWithProviders(
        <RowBindingV2
          defaultSpaceId={1}
          tasksSource={tasksSource}
          onBind={mockOnBind}
          onUnbind={mockOnUnbind}
        />
      );

      fireEvent.click(screen.getByText('Привязать к записи'));
      
      await waitFor(() => {
        expect(screen.getByText('Task One')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Task One'));
      
      expect(mockOnBind).toHaveBeenCalledWith(
        expect.objectContaining({
          table_id: 1,
          row_id: 1,
          table_name: 'Задачи',
          table_icon: '📋'
        })
      );
    });

    it('still shows "Other tables" option when tasksSource is provided', async () => {
      renderWithProviders(
        <RowBindingV2
          defaultSpaceId={1}
          tasksSource={tasksSource}
          allowOtherTables={true}
          onBind={mockOnBind}
          onUnbind={mockOnUnbind}
        />
      );

      fireEvent.click(screen.getByText('Привязать к записи'));
      
      await waitFor(() => {
        expect(screen.getByText('Другая таблица')).toBeInTheDocument();
      });
    });
  });

  // ADR-024: Space Files Binding
  describe('Space Files Binding', () => {
    it('shows files section when spaceFilesTableId is provided', async () => {
      renderWithProviders(
        <RowBindingV2
          defaultSpaceId={1}
          spaceFilesTableId={5}
          onBind={mockOnBind}
          onUnbind={mockOnUnbind}
        />
      );

      fireEvent.click(screen.getByText('Привязать к записи'));

      await waitFor(() => {
        // Tab text is "Файлы" (not "Файлы пространства")
        expect(screen.getByText('Файлы')).toBeInTheDocument();
      });
    });

    it('allows binding a file from space files table', async () => {
      // Mock file rows
      const { apiClient } = await import('@/shared/utils/apiClient');
      vi.mocked(apiClient.get).mockImplementation((url: string) => {
        if (url.includes('/tables/5/rows')) {
          return Promise.resolve({
            success: true,
            data: {
              rows: [
                { id: 101, table_id: 5, data: { name: 'document.pdf', type: 'application/pdf' } },
                { id: 102, table_id: 5, data: { name: 'image.png', type: 'image/png' } }
              ]
            }
          });
        }
        // Default tasks response
        return Promise.resolve({
          success: true,
          data: {
            rows: [
              { id: 1, table_id: 1, data: { title: 'Task One' } }
            ]
          }
        });
      });

      renderWithProviders(
        <RowBindingV2
          defaultSpaceId={1}
          spaceFilesTableId={5}
          onBind={mockOnBind}
          onUnbind={mockOnUnbind}
        />
      );

      fireEvent.click(screen.getByText('Привязать к записи'));

      await waitFor(() => {
        // Tab text is "Файлы"
        expect(screen.getByText('Файлы')).toBeInTheDocument();
      });

      // Click on "Файлы" tab to switch to files content
      fireEvent.click(screen.getByText('Файлы'));

      await waitFor(() => {
        expect(screen.getByText('document.pdf')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('document.pdf'));

      expect(mockOnBind).toHaveBeenCalledWith(
        expect.objectContaining({
          table_id: 5,
          row_id: 101,
          row_title: 'document.pdf'
        })
      );
    });
  });
});
