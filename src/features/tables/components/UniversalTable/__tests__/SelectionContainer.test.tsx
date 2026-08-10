import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SelectionContainer } from '../SelectionContainer';
import type { SelectionSortMode } from '../../../types/selection.types';

describe('SelectionContainer', () => {
  const defaultProps = {
    selectedCount: 5,
    totalCount: 100,
    filteredCount: 50,
    selectionSort: 'default' as SelectionSortMode,
    onSortChange: vi.fn(),
    onClearSelection: vi.fn(),
    onSelectAllFiltered: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders selection count badge', () => {
    render(<SelectionContainer {...defaultProps} />);
    
    const badge = screen.getByText('5');
    expect(badge).toBeInTheDocument();
  });

  test('opens dropdown on click', () => {
    render(<SelectionContainer {...defaultProps} />);
    
    // Click the button to open dropdown
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);
    
    // Should show dropdown content
    expect(screen.getByText(/выбрано/i)).toBeInTheDocument();
  });

  test('displays selected count information', () => {
    render(<SelectionContainer {...defaultProps} />);
    
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);
    
    // Text: "Выбрано: 5 строк"
    expect(screen.getByText(/выбрано.*5/i)).toBeInTheDocument();
  });

  test('calls onClearSelection when clear button clicked', () => {
    render(<SelectionContainer {...defaultProps} />);
    
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);
    
    // Text: "Снять выделение"
    const clearButton = screen.getByText(/снять выделение/i);
    fireEvent.click(clearButton);
    
    expect(defaultProps.onClearSelection).toHaveBeenCalledTimes(1);
  });

  test('calls onSelectAllFiltered when select filtered clicked', () => {
    render(<SelectionContainer {...defaultProps} />);
    
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);
    
    // Text: "Выбрать все отфильтрованные (50)"
    const selectFilteredButton = screen.getByText(/выбрать все отфильтрованные/i);
    fireEvent.click(selectFilteredButton);
    
    expect(defaultProps.onSelectAllFiltered).toHaveBeenCalledTimes(1);
  });

  test('shows sort options', () => {
    render(<SelectionContainer {...defaultProps} />);
    
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);
    
    expect(screen.getByText(/по умолчанию/i)).toBeInTheDocument();
    expect(screen.getByText(/выделенные сверху/i)).toBeInTheDocument();
    expect(screen.getByText(/выделенные снизу/i)).toBeInTheDocument();
  });

  test('calls onSortChange with correct value', () => {
    render(<SelectionContainer {...defaultProps} />);
    
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);
    
    const selectedFirst = screen.getByText(/выделенные сверху/i);
    fireEvent.click(selectedFirst);
    
    expect(defaultProps.onSortChange).toHaveBeenCalledWith('selected-first');
  });

  test('highlights current sort option', () => {
    render(<SelectionContainer {...defaultProps} selectionSort="selected-first" />);
    
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);
    
    const selectedFirst = screen.getByText(/выделенные сверху/i).closest('button');
    // Uses CSS variable bg-[var(--color-primary-500)]/15 for selected state
    expect(selectedFirst).toHaveClass('bg-[var(--color-primary-500)]/15');
  });

  test('does not render when no selection', () => {
    const { container } = render(<SelectionContainer {...defaultProps} selectedCount={0} />);
    
    expect(container.firstChild).toBeNull();
  });

  test('renders correctly with single selection', () => {
    render(<SelectionContainer {...defaultProps} selectedCount={1} />);
    
    const badge = screen.getByText('1');
    expect(badge).toBeInTheDocument();
  });

  test('hides select all filtered button when all filtered are selected', () => {
    render(<SelectionContainer 
      {...defaultProps} 
      selectedCount={50} 
      filteredCount={50} 
    />);
    
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);
    
    // Button should not be rendered when selectedCount === filteredCount
    expect(screen.queryByText(/выбрать все отфильтрованные/i)).not.toBeInTheDocument();
  });
});
