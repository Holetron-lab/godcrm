/**
 * Tests for MissingColumnDialog component
 * ADR-031: Missing Column Resolution Dialog
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MissingColumnDialog } from '../MissingColumnDialog';
import { useMissingColumnStore } from '@/shared/stores/missingColumnStore';
import { MissingColumnContext, ColumnModel } from '@/shared/services/MissingColumnResolver';

// Mock context for testing
const mockContext: MissingColumnContext = {
  source: 'import',
  tableId: 1,
  tableName: 'Задачи',
  missingColumnKey: 'status_id',
  expectedType: 'number',
  sampleValues: [1, 2, 3]
};

const mockColumns: ColumnModel[] = [
  { id: '1', name: 'status', type: 'select' },
  { id: '2', name: 'priority', type: 'select' },
  { id: '3', name: 'title', type: 'text' },
  { id: '4', name: 'id', type: 'number' }
];

describe('MissingColumnDialog', () => {
  beforeEach(() => {
    // Reset store
    useMissingColumnStore.setState({
      isOpen: false,
      context: null,
      contexts: [],
      tableColumns: [],
      onResolve: null,
      onResolveBatch: null,
      isLoading: false
    });
  });

  describe('when closed', () => {
    it('should not render when isOpen is false', () => {
      render(<MissingColumnDialog />);
      expect(screen.queryByText('Колонка не найдена')).not.toBeInTheDocument();
    });
  });

  describe('when open', () => {
    beforeEach(() => {
      useMissingColumnStore.setState({
        isOpen: true,
        context: mockContext,
        tableColumns: mockColumns,
        onResolve: vi.fn()
      });
    });

    it('should render dialog title', () => {
      render(<MissingColumnDialog />);
      expect(screen.getByText('Колонка не найдена')).toBeInTheDocument();
    });

    it('should show missing column name', () => {
      render(<MissingColumnDialog />);
      expect(screen.getByText('status_id')).toBeInTheDocument();
    });

    it('should show table name', () => {
      render(<MissingColumnDialog />);
      expect(screen.getByText(/Задачи/)).toBeInTheDocument();
    });

    it('should show source label', () => {
      render(<MissingColumnDialog />);
      expect(screen.getByText(/Импорт данных/)).toBeInTheDocument();
    });

    it('should have create action selected by default', () => {
      render(<MissingColumnDialog />);
      const createOption = screen.getByText(/Создать колонку/);
      expect(createOption).toBeInTheDocument();
    });

    it('should show map option', () => {
      render(<MissingColumnDialog />);
      expect(screen.getByText(/Использовать существующую колонку/)).toBeInTheDocument();
    });

    it('should show skip option', () => {
      render(<MissingColumnDialog />);
      expect(screen.getByText(/Пропустить эту колонку/)).toBeInTheDocument();
    });

    it('should show apply to all checkbox', () => {
      render(<MissingColumnDialog />);
      expect(screen.getByText(/Применить ко всем похожим ошибкам/)).toBeInTheDocument();
    });

    it('should have cancel and apply buttons', () => {
      render(<MissingColumnDialog />);
      expect(screen.getByText('Отмена')).toBeInTheDocument();
      expect(screen.getByText('Применить')).toBeInTheDocument();
    });
  });

  describe('create action', () => {
    it('should show column type selector when create is selected', async () => {
      useMissingColumnStore.setState({
        isOpen: true,
        context: mockContext,
        tableColumns: mockColumns,
        onResolve: vi.fn()
      });

      render(<MissingColumnDialog />);
      
      // Type selector should be visible
      expect(screen.getByText('Тип колонки')).toBeInTheDocument();
    });

    it('should auto-detect type from sample values', () => {
      useMissingColumnStore.setState({
        isOpen: true,
        context: { ...mockContext, sampleValues: [1, 2, 3] },
        tableColumns: mockColumns,
        onResolve: vi.fn()
      });

      render(<MissingColumnDialog />);
      
      // Should show hint about auto-detection
      expect(screen.getByText(/Тип определён по данным/)).toBeInTheDocument();
    });
  });

  describe('map action', () => {
    beforeEach(() => {
      useMissingColumnStore.setState({
        isOpen: true,
        context: mockContext,
        tableColumns: mockColumns,
        onResolve: vi.fn()
      });
    });

    it('should show similar columns hint', async () => {
      render(<MissingColumnDialog />);
      
      // Click on map option
      const mapOption = screen.getByText(/Использовать существующую колонку/);
      fireEvent.click(mapOption);
      
      // Should show similar columns
      await waitFor(() => {
        expect(screen.getByText(/Похожие:/)).toBeInTheDocument();
      });
    });
  });

  describe('resolution', () => {
    it('should call onResolve with create action', async () => {
      const onResolve = vi.fn();
      useMissingColumnStore.setState({
        isOpen: true,
        context: mockContext,
        tableColumns: mockColumns,
        onResolve
      });

      render(<MissingColumnDialog />);
      
      // Click apply
      fireEvent.click(screen.getByText('Применить'));
      
      expect(onResolve).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'create',
          newColumn: expect.objectContaining({
            name: 'status_id'
          })
        })
      );
    });

    it('should call closeDialog on cancel', () => {
      const onResolve = vi.fn();
      useMissingColumnStore.setState({
        isOpen: true,
        context: mockContext,
        tableColumns: mockColumns,
        onResolve
      });

      render(<MissingColumnDialog />);
      
      fireEvent.click(screen.getByText('Отмена'));
      
      // Should call onResolve with cancel action
      expect(onResolve).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'cancel'
        })
      );
    });

    it('should pass applyToAll flag', async () => {
      const onResolve = vi.fn();
      useMissingColumnStore.setState({
        isOpen: true,
        context: mockContext,
        tableColumns: mockColumns,
        onResolve
      });

      render(<MissingColumnDialog />);
      
      // Check apply to all
      const checkbox = screen.getByText(/Применить ко всем похожим ошибкам/);
      fireEvent.click(checkbox);
      
      // Click apply
      fireEvent.click(screen.getByText('Применить'));
      
      expect(onResolve).toHaveBeenCalledWith(
        expect.objectContaining({
          applyToAll: true
        })
      );
    });
  });
});

describe('MissingColumnDialog batch mode', () => {
  const mockContexts: MissingColumnContext[] = [
    { source: 'import', tableId: 1, tableName: 'Tasks', missingColumnKey: 'status' },
    { source: 'import', tableId: 1, tableName: 'Tasks', missingColumnKey: 'priority' },
    { source: 'import', tableId: 1, tableName: 'Tasks', missingColumnKey: 'category' }
  ];

  it('should show batch dialog when contexts array provided', () => {
    useMissingColumnStore.setState({
      isOpen: true,
      context: null,
      contexts: mockContexts,
      tableColumns: mockColumns,
      onResolveBatch: vi.fn()
    });

    render(<MissingColumnDialog />);
    
    // Should show progress indicator
    expect(screen.getByText(/1\/3/)).toBeInTheDocument();
  });

  it('should show progress bar', () => {
    useMissingColumnStore.setState({
      isOpen: true,
      context: null,
      contexts: mockContexts,
      tableColumns: mockColumns,
      onResolveBatch: vi.fn()
    });

    render(<MissingColumnDialog />);
    
    expect(screen.getByText('Прогресс')).toBeInTheDocument();
  });

  it('should show quick action buttons', () => {
    useMissingColumnStore.setState({
      isOpen: true,
      context: null,
      contexts: mockContexts,
      tableColumns: mockColumns,
      onResolveBatch: vi.fn()
    });

    render(<MissingColumnDialog />);
    
    expect(screen.getByText(/Создать/)).toBeInTheDocument();
    expect(screen.getByText(/Пропустить$/)).toBeInTheDocument();
  });
});
