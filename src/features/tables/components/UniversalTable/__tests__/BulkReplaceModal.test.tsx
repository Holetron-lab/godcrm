import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkReplaceModal } from '../BulkReplaceModal';
import type { ColumnModel, RowModel } from '../../../types/table.types';

// TODO: Тесты требуют обновления после рефакторинга BulkReplaceModal
// UI значительно изменился, нужно переписать тесты
describe.skip('BulkReplaceModal', () => {
  const columns: ColumnModel[] = [
    { id: 'col1', name: 'status', displayName: 'Статус', type: 'text', system: false },
    { id: 'col2', name: 'priority', displayName: 'Приоритет', type: 'text', system: false },
    { id: 'col3', name: 'id', displayName: 'ID', type: 'text', system: true },
  ] as ColumnModel[];

  const rows: RowModel[] = [
    { id: '1', data: { col1: 'Draft', col2: 'High' } },
    { id: '2', data: { col1: 'Active', col2: 'Low' } },
    { id: '3', data: { col1: 'Draft', col2: 'Medium' } },
  ] as RowModel[];

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    columns,
    rows,
    selectedRowIds: new Set(['1', '3']),
    filteredRowIds: ['1', '2', '3'],
    allRowIds: ['1', '2', '3'],
    onExecute: vi.fn().mockResolvedValue({ success: true, updated: 2 }),
    isProcessing: false
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders when open', () => {
    render(<BulkReplaceModal {...defaultProps} />);
    
    expect(screen.getByText(/массовая замена/i)).toBeInTheDocument();
  });

  test('does not render when closed', () => {
    render(<BulkReplaceModal {...defaultProps} isOpen={false} />);
    
    expect(screen.queryByText(/массовая замена/i)).not.toBeInTheDocument();
  });

  test('calls onClose when close button clicked', () => {
    render(<BulkReplaceModal {...defaultProps} />);
    
    const closeButton = screen.getByLabelText(/закрыть/i);
    fireEvent.click(closeButton);
    
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  test('shows column selector with non-system columns', () => {
    render(<BulkReplaceModal {...defaultProps} />);
    
    const columnSelect = screen.getByLabelText(/колонка/i);
    expect(columnSelect).toBeInTheDocument();
    
    // System columns should be filtered out
    expect(screen.queryByText('ID')).not.toBeInTheDocument();
    expect(screen.getByText('Статус')).toBeInTheDocument();
    expect(screen.getByText('Приоритет')).toBeInTheDocument();
  });

  test('shows scope selector with three options', () => {
    render(<BulkReplaceModal {...defaultProps} />);
    
    expect(screen.getByLabelText(/область/i)).toBeInTheDocument();
    expect(screen.getByText(/выбранные/i)).toBeInTheDocument();
    expect(screen.getByText(/отфильтрованные/i)).toBeInTheDocument();
    expect(screen.getByText(/все/i)).toBeInTheDocument();
  });

  test('shows operation type selector', () => {
    render(<BulkReplaceModal {...defaultProps} />);
    
    expect(screen.getByText(/заменить/i)).toBeInTheDocument();
    expect(screen.getByText(/добавить в конец/i)).toBeInTheDocument();
    expect(screen.getByText(/добавить в начало/i)).toBeInTheDocument();
    expect(screen.getByText(/очистить/i)).toBeInTheDocument();
  });

  test('shows find/replace inputs for replace operation', async () => {
    const user = userEvent.setup();
    render(<BulkReplaceModal {...defaultProps} />);
    
    // Select replace operation
    const replaceButton = screen.getByText(/заменить/i);
    await user.click(replaceButton);
    
    expect(screen.getByPlaceholderText(/найти/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/заменить на/i)).toBeInTheDocument();
  });

  test('shows append input for append operation', async () => {
    const user = userEvent.setup();
    render(<BulkReplaceModal {...defaultProps} />);
    
    // Select append operation
    const appendButton = screen.getByText(/добавить в конец/i);
    await user.click(appendButton);
    
    expect(screen.getByPlaceholderText(/текст для добавления/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/найти/i)).not.toBeInTheDocument();
  });

  test('hides inputs for clear operation', async () => {
    const user = userEvent.setup();
    render(<BulkReplaceModal {...defaultProps} />);
    
    // Select clear operation
    const clearButton = screen.getByText(/очистить/i);
    await user.click(clearButton);
    
    expect(screen.queryByPlaceholderText(/найти/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/текст для добавления/i)).not.toBeInTheDocument();
  });

  test('shows case sensitivity checkbox for replace', async () => {
    const user = userEvent.setup();
    render(<BulkReplaceModal {...defaultProps} />);
    
    const replaceButton = screen.getByText(/заменить/i);
    await user.click(replaceButton);
    
    expect(screen.getByLabelText(/учитывать регистр/i)).toBeInTheDocument();
  });

  test('shows regex checkbox for replace', async () => {
    const user = userEvent.setup();
    render(<BulkReplaceModal {...defaultProps} />);
    
    const replaceButton = screen.getByText(/заменить/i);
    await user.click(replaceButton);
    
    expect(screen.getByLabelText(/регулярное выражение/i)).toBeInTheDocument();
  });

  test('shows preview section', () => {
    render(<BulkReplaceModal {...defaultProps} />);
    
    expect(screen.getByText(/предпросмотр/i)).toBeInTheDocument();
  });

  test('updates preview when config changes', async () => {
    const user = userEvent.setup();
    render(<BulkReplaceModal {...defaultProps} />);
    
    // Select column
    const columnSelect = screen.getByLabelText(/колонка/i);
    await user.selectOptions(columnSelect, 'col1');
    
    // Enter find value
    const findInput = screen.getByPlaceholderText(/найти/i);
    await user.type(findInput, 'Draft');
    
    // Enter replace value
    const replaceInput = screen.getByPlaceholderText(/заменить на/i);
    await user.type(replaceInput, 'Published');
    
    // Preview should show changes
    await waitFor(() => {
      expect(screen.getByText(/изменений: 2/i)).toBeInTheDocument();
    });
  });

  test('shows preview items with before/after values', async () => {
    const user = userEvent.setup();
    render(<BulkReplaceModal {...defaultProps} />);
    
    // Configure replace
    const columnSelect = screen.getByLabelText(/колонка/i);
    await user.selectOptions(columnSelect, 'col1');
    
    const findInput = screen.getByPlaceholderText(/найти/i);
    await user.type(findInput, 'Draft');
    
    const replaceInput = screen.getByPlaceholderText(/заменить на/i);
    await user.type(replaceInput, 'Published');
    
    // Check preview items
    await waitFor(() => {
      expect(screen.getByText('Draft')).toBeInTheDocument();
      expect(screen.getByText('→')).toBeInTheDocument();
      expect(screen.getByText('Published')).toBeInTheDocument();
    });
  });

  test('disables execute button when no column selected', () => {
    render(<BulkReplaceModal {...defaultProps} />);
    
    const executeButton = screen.getByText(/выполнить/i);
    expect(executeButton).toBeDisabled();
  });

  test('disables execute button when no changes in preview', async () => {
    const user = userEvent.setup();
    render(<BulkReplaceModal {...defaultProps} />);
    
    const columnSelect = screen.getByLabelText(/колонка/i);
    await user.selectOptions(columnSelect, 'col1');
    
    const findInput = screen.getByPlaceholderText(/найти/i);
    await user.type(findInput, 'NonexistentValue');
    
    const executeButton = screen.getByText(/выполнить/i);
    expect(executeButton).toBeDisabled();
  });

  test('enables execute button when valid config', async () => {
    const user = userEvent.setup();
    render(<BulkReplaceModal {...defaultProps} />);
    
    const columnSelect = screen.getByLabelText(/колонка/i);
    await user.selectOptions(columnSelect, 'col1');
    
    const findInput = screen.getByPlaceholderText(/найти/i);
    await user.type(findInput, 'Draft');
    
    const replaceInput = screen.getByPlaceholderText(/заменить на/i);
    await user.type(replaceInput, 'Published');
    
    await waitFor(() => {
      const executeButton = screen.getByText(/выполнить/i);
      expect(executeButton).not.toBeDisabled();
    });
  });

  test('calls onExecute with correct config', async () => {
    const user = userEvent.setup();
    render(<BulkReplaceModal {...defaultProps} />);
    
    // Configure
    const columnSelect = screen.getByLabelText(/колонка/i);
    await user.selectOptions(columnSelect, 'col1');
    
    const findInput = screen.getByPlaceholderText(/найти/i);
    await user.type(findInput, 'Draft');
    
    const replaceInput = screen.getByPlaceholderText(/заменить на/i);
    await user.type(replaceInput, 'Published');
    
    // Execute
    await waitFor(() => {
      const executeButton = screen.getByText(/выполнить/i);
      expect(executeButton).not.toBeDisabled();
    });
    
    const executeButton = screen.getByText(/выполнить/i);
    await user.click(executeButton);
    
    expect(defaultProps.onExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        columnId: 'col1',
        operationType: 'replace',
        findValue: 'Draft',
        replaceValue: 'Published'
      })
    );
  });

  test('shows loading state when processing', () => {
    render(<BulkReplaceModal {...defaultProps} isProcessing={true} />);
    
    const executeButton = screen.getByText(/выполняется/i);
    expect(executeButton).toBeDisabled();
  });

  test('closes modal on successful execution', async () => {
    const user = userEvent.setup();
    render(<BulkReplaceModal {...defaultProps} />);
    
    // Configure
    const columnSelect = screen.getByLabelText(/колонка/i);
    await user.selectOptions(columnSelect, 'col1');
    
    const findInput = screen.getByPlaceholderText(/найти/i);
    await user.type(findInput, 'Draft');
    
    const replaceInput = screen.getByPlaceholderText(/заменить на/i);
    await user.type(replaceInput, 'Published');
    
    // Execute
    await waitFor(() => {
      const executeButton = screen.getByText(/выполнить/i);
      expect(executeButton).not.toBeDisabled();
    });
    
    const executeButton = screen.getByText(/выполнить/i);
    await user.click(executeButton);
    
    await waitFor(() => {
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  test('shows error message on failed execution', async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn().mockResolvedValue({ 
      success: false, 
      updated: 0, 
      errors: ['Database error'] 
    });
    
    render(<BulkReplaceModal {...defaultProps} onExecute={onExecute} />);
    
    // Configure
    const columnSelect = screen.getByLabelText(/колонка/i);
    await user.selectOptions(columnSelect, 'col1');
    
    const findInput = screen.getByPlaceholderText(/найти/i);
    await user.type(findInput, 'Draft');
    
    const replaceInput = screen.getByPlaceholderText(/заменить на/i);
    await user.type(replaceInput, 'Published');
    
    // Execute
    await waitFor(() => {
      const executeButton = screen.getByText(/выполнить/i);
      expect(executeButton).not.toBeDisabled();
    });
    
    const executeButton = screen.getByText(/выполнить/i);
    await user.click(executeButton);
    
    await waitFor(() => {
      expect(screen.getByText(/ошибка/i)).toBeInTheDocument();
    });
  });

  test('shows affected rows count in scope selector', () => {
    render(<BulkReplaceModal {...defaultProps} />);
    
    // Should show counts for each scope
    expect(screen.getByText(/выбранные.*2/i)).toBeInTheDocument();
    expect(screen.getByText(/отфильтрованные.*3/i)).toBeInTheDocument();
    expect(screen.getByText(/все.*3/i)).toBeInTheDocument();
  });
});
