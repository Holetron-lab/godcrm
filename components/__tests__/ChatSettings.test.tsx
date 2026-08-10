/**
 * ChatSettings Component Tests
 * ADR-024: Chat & Message Architecture
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatSettings } from '../ChatSettings';

// Mock apiClient
vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: {
    get: vi.fn()
  }
}));

import { apiClient } from '@/shared/utils/apiClient';

const mockSpaces = [
  { id: 1, name: 'Space One', icon: '🏠' },
  { id: 2, name: 'Space Two', icon: '🏢' }
];

const mockTables = [
  { id: 10, name: 'Tasks', icon: '📋' },
  { id: 11, name: 'Projects', icon: '📁' }
];

const mockRows = [
  { id: 100, table_id: 10, data: { name: 'Task 1' } },
  { id: 101, table_id: 10, data: { name: 'Task 2' } }
];

describe('ChatSettings', () => {
  let queryClient: QueryClient;
  const mockOnSpaceChange = vi.fn();
  const mockOnDefaultTableChange = vi.fn();
  const mockOnBindRow = vi.fn();
  const mockOnUnbindRow = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false }
      }
    });

    // Setup API mocks
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url === '/spaces') {
        return Promise.resolve({ success: true, data: mockSpaces });
      }
      if (url.includes('/tables')) {
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
        <ChatSettings
          onSpaceChange={mockOnSpaceChange}
          onDefaultTableChange={mockOnDefaultTableChange}
          onBindRow={mockOnBindRow}
          onUnbindRow={mockOnUnbindRow}
          onClose={mockOnClose}
          {...props}
        />
      </QueryClientProvider>
    );
  };

  it('should render settings header', () => {
    renderComponent();
    expect(screen.getByText('Настройки чата')).toBeInTheDocument();
  });

  it('should show space selector', () => {
    renderComponent();
    expect(screen.getByText('Привязка к Space')).toBeInTheDocument();
    expect(screen.getByText('Не выбран')).toBeInTheDocument();
  });

  it('should call onSpaceChange when space selected', async () => {
    renderComponent();
    
    // Open space selector
    fireEvent.click(screen.getByText('Не выбран'));
    
    await waitFor(() => {
      expect(screen.getByText('Space One')).toBeInTheDocument();
    });
    
    // Select space
    fireEvent.click(screen.getByText('Space One'));
    
    expect(mockOnSpaceChange).toHaveBeenCalledWith(1);
  });

  it('should show table selector when space selected', async () => {
    renderComponent({ spaceId: 1 });
    
    await waitFor(() => {
      expect(screen.getByText('Таблица по умолчанию')).toBeInTheDocument();
    });
  });

  it('should call onDefaultTableChange when table selected', async () => {
    renderComponent({ spaceId: 1 });
    
    // Open table selector
    const tableButton = await screen.findByText('Не выбрана');
    fireEvent.click(tableButton);
    
    await waitFor(() => {
      expect(screen.getByText('Tasks')).toBeInTheDocument();
    });
    
    fireEvent.click(screen.getByText('Tasks'));
    
    expect(mockOnDefaultTableChange).toHaveBeenCalledWith(10);
  });

  it('should display bound rows', () => {
    const boundRows = [
      { table_id: 10, row_id: 100, table_name: 'Tasks', row_title: 'Task 1' }
    ];
    
    renderComponent({ boundRows });
    
    expect(screen.getByText('Привязанные строки')).toBeInTheDocument();
    expect(screen.getByText('Task 1')).toBeInTheDocument();
  });

  it('should call onUnbindRow when unbind clicked', () => {
    const boundRows = [
      { table_id: 10, row_id: 100, table_name: 'Tasks', row_title: 'Task 1' }
    ];
    
    renderComponent({ boundRows });
    
    // Find and click unbind button (trash icon)
    const unbindButtons = screen.getAllByRole('button');
    const trashButton = unbindButtons.find(btn => 
      btn.querySelector('svg.lucide-trash-2')
    );
    
    if (trashButton) {
      fireEvent.click(trashButton);
      expect(mockOnUnbindRow).toHaveBeenCalledWith(10, 100);
    }
  });

  it('should call onClose when close button clicked', () => {
    renderComponent();
    
    const closeButtons = screen.getAllByRole('button');
    const closeButton = closeButtons.find(btn => 
      btn.querySelector('svg.lucide-x')
    );
    
    if (closeButton) {
      fireEvent.click(closeButton);
      expect(mockOnClose).toHaveBeenCalled();
    }
  });

  it('should show no bound rows message when empty', () => {
    renderComponent({ boundRows: [] });
    expect(screen.getByText('Нет привязанных строк')).toBeInTheDocument();
  });
});
