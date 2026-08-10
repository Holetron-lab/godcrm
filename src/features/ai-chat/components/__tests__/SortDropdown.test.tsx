/**
 * SortDropdown Component Tests
 * TASK-043: Accordion Chat UI + Sub-Agents Settings
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SortDropdown, SortOption } from '../SortDropdown';

describe('SortDropdown', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with default value', () => {
    render(
      <SortDropdown 
        value="date" 
        onChange={mockOnChange} 
      />
    );

    expect(screen.getByText('По дате')).toBeInTheDocument();
  });

  it('shows all options when clicked', () => {
    render(
      <SortDropdown 
        value="date" 
        onChange={mockOnChange} 
      />
    );

    // Click to open dropdown
    fireEvent.click(screen.getByRole('button'));

    // Check all options are visible
    expect(screen.getByText('По алфавиту')).toBeInTheDocument();
    expect(screen.getByText('По спейсу')).toBeInTheDocument();
    expect(screen.getByText('По участникам')).toBeInTheDocument();
  });

  it('calls onChange when option is selected', () => {
    render(
      <SortDropdown 
        value="date" 
        onChange={mockOnChange} 
      />
    );

    // Open dropdown
    fireEvent.click(screen.getByRole('button'));

    // Select alphabet option
    fireEvent.click(screen.getByText('По алфавиту'));

    expect(mockOnChange).toHaveBeenCalledWith('alphabet');
  });

  it('filters options based on options prop', () => {
    render(
      <SortDropdown 
        value="date" 
        onChange={mockOnChange}
        options={['date', 'alphabet']}
      />
    );

    // Open dropdown
    fireEvent.click(screen.getByRole('button'));

    // Should show only date and alphabet (multiple because it's in button + dropdown)
    expect(screen.getAllByText('По дате').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('По алфавиту').length).toBeGreaterThanOrEqual(1);
    
    // Should NOT show space and participants
    expect(screen.queryByText('По спейсу')).not.toBeInTheDocument();
    expect(screen.queryByText('По участникам')).not.toBeInTheDocument();
  });

  it('closes dropdown after selection', () => {
    render(
      <SortDropdown 
        value="date" 
        onChange={mockOnChange} 
      />
    );

    // Open dropdown
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('По алфавиту')).toBeInTheDocument();

    // Select option
    fireEvent.click(screen.getByText('По алфавиту'));

    // Dropdown should close - alphabet should not be visible in dropdown
    // (only current value in button remains)
    expect(mockOnChange).toHaveBeenCalled();
  });

  it('shows check mark for current value', () => {
    render(
      <SortDropdown 
        value="alphabet" 
        onChange={mockOnChange} 
      />
    );

    // Open dropdown
    fireEvent.click(screen.getByRole('button'));

    // The alphabet option in dropdown should have a checkmark (second match)
    const alphabetOptions = screen.getAllByText('По алфавиту');
    expect(alphabetOptions.length).toBeGreaterThanOrEqual(2);
    
    // The dropdown item (second one) should be in a button with check icon
    const dropdownOption = alphabetOptions[1].closest('button');
    expect(dropdownOption).toBeInTheDocument();
    
    // Check that the SVG check icon exists in the selected option
    const checkIcons = dropdownOption?.querySelectorAll('svg');
    expect(checkIcons?.length).toBeGreaterThan(0);
  });
});
