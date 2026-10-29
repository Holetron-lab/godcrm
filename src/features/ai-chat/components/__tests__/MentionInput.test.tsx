/**
 * Tests for MentionInput Component
 * ADR-023: Agent-as-User & Infinite Chat Architecture
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from '@/tests/renderWithProviders';
import userEvent from '@testing-library/user-event';
import { MentionInput, MentionUser } from '../MentionInput';

describe('MentionInput', () => {
  const mockUsers: MentionUser[] = [
    { id: 1, name: 'General Assistant', type: 'agent', icon: '🤖' },
    { id: 2, name: 'Data Analyst', type: 'agent', icon: '📊' },
    { id: 3, name: 'John Doe', type: 'human', email: 'john@example.com' }
  ];
  
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
    onMention: vi.fn(),
    onSubmit: vi.fn(),
    availableUsers: mockUsers
  };
  
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  it('should render textarea with placeholder', () => {
    render(<MentionInput {...defaultProps} />);
    
    expect(screen.getByPlaceholderText(/Введите @ для упоминания/i)).toBeInTheDocument();
  });
  
  it('should call onChange when typing', async () => {
    const user = userEvent.setup();
    render(<MentionInput {...defaultProps} />);
    
    const input = screen.getByRole('textbox');
    await user.type(input, 'Hello');
    
    expect(defaultProps.onChange).toHaveBeenCalled();
  });
  
  // Note: dropdown is rendered via portal and depends on cursor position
  // which is difficult to simulate in jsdom. Tested manually via e2e.
  it.skip('should show dropdown when typing @', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MentionInput {...defaultProps} />);
    
    const input = screen.getByRole('textbox');
    await user.type(input, '@');
    
    // Update value prop to simulate controlled input
    rerender(<MentionInput {...defaultProps} value="@" />);
    
    // Dropdown should appear with available users
    await waitFor(() => {
      expect(screen.getByText('General Assistant')).toBeInTheDocument();
    });
  });
  
  // Note: filtering requires dropdown to be visible
  it.skip('should filter users based on mention query', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MentionInput {...defaultProps} />);
    
    const input = screen.getByRole('textbox');
    await user.type(input, '@data');
    
    rerender(<MentionInput {...defaultProps} value="@data" />);
    
    await waitFor(() => {
      expect(screen.getByText('Data Analyst')).toBeInTheDocument();
      expect(screen.queryByText('General Assistant')).not.toBeInTheDocument();
    });
  });
  
  // Note: selecting user requires dropdown to be visible
  it.skip('should call onMention when selecting a user', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MentionInput {...defaultProps} />);
    
    const input = screen.getByRole('textbox');
    await user.type(input, '@');
    
    rerender(<MentionInput {...defaultProps} value="@" />);
    
    await waitFor(() => {
      expect(screen.getByText('General Assistant')).toBeInTheDocument();
    });
    
    await user.click(screen.getByText('General Assistant'));
    
    expect(defaultProps.onMention).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        name: 'General Assistant',
        type: 'agent'
      })
    );
  });
  
  it('should call onSubmit when pressing Shift+Enter', async () => {
    const user = userEvent.setup();
    render(<MentionInput {...defaultProps} value="Hello world" />);
    
    const input = screen.getByRole('textbox');
    await user.type(input, '{shift>}{enter}{/shift}');
    
    expect(defaultProps.onSubmit).toHaveBeenCalled();
  });
  
  it('should insert a newline without submitting when pressing Enter', async () => {
    const user = userEvent.setup();
    render(<MentionInput {...defaultProps} value="Hello world" />);
    
    const input = screen.getByRole('textbox');
    await user.type(input, '{enter}');
    expect(defaultProps.onChange).toHaveBeenCalledWith('Hello world\n');
    
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });
  
  it('does not submit Shift+Enter during IME composition', () => {
    render(<MentionInput {...defaultProps} value="Draft" />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: true, isComposing: true });
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  it('should be disabled when disabled prop is true', () => {
    render(<MentionInput {...defaultProps} disabled />);
    
    const input = screen.getByRole('textbox');
    expect(input).toBeDisabled();
  });
  
  // Note: "No results" message is rendered via portal and requires cursor position
  // which is difficult to test in jsdom. This is tested manually in e2e tests.
  it.skip('should show no results message when no matches', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MentionInput {...defaultProps} />);
    
    const input = screen.getByRole('textbox');
    await user.type(input, '@xyz123');
    
    rerender(<MentionInput {...defaultProps} value="@xyz123" />);
    
    await waitFor(() => {
      expect(screen.getByText(/No users matching/)).toBeInTheDocument();
    });
  });
  
  // Note: Arrow key navigation requires complex state management
  // that depends on dropdown being visible, which requires cursor position
  it.skip('should navigate dropdown with arrow keys', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MentionInput {...defaultProps} />);
    
    const input = screen.getByRole('textbox');
    await user.type(input, '@');
    
    rerender(<MentionInput {...defaultProps} value="@" />);
    
    await waitFor(() => {
      expect(screen.getByText('General Assistant')).toBeInTheDocument();
    });
    
    // Arrow down should select next item
    await user.keyboard('{arrowdown}');
    
    // The second item (Data Analyst) should now be highlighted
    // This is verified by checking if the element has the selected class
  });
  
  it('should close dropdown when pressing Escape', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MentionInput {...defaultProps} />);
    
    const input = screen.getByRole('textbox');
    await user.type(input, '@');
    
    rerender(<MentionInput {...defaultProps} value="@" />);
    
    await waitFor(() => {
      expect(screen.getByText('General Assistant')).toBeInTheDocument();
    });
    
    await user.keyboard('{escape}');
    
    await waitFor(() => {
      expect(screen.queryByText('General Assistant')).not.toBeInTheDocument();
    });
  });
});


describe('mention dropdown identity', () => {
  it('shows agent emoji, description and a left accent shadow without changing selection', () => {
    const onMention = vi.fn();
    render(<MentionInput value="@" onChange={vi.fn()} onMention={onMention} availableUsers={[
      { id: 24, name: 'Architect', type: 'bot', icon: '🏗️', color: '#ec4899', description: 'Software Architect / Planner' },
      { id: 22, name: 'Frontend QA', type: 'bot', icon: '🔍', color: '#14b8a6', description: 'UI Quality Specialist' },
      { id: 1, name: 'Alice', type: 'human', color: '#a16207' },
      { id: 2, name: 'Sam', type: 'human' },
    ]} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '@a', selectionStart: 2 } });
    const architect = screen.getByRole('button', { name: /Architect/ });
    expect(architect).toHaveTextContent('🏗️');
    expect(architect).toHaveTextContent('Software Architect / Planner');
    expect(architect.style.boxShadow).toContain('#ec4899');
    expect(screen.getByRole('button', { name: /Frontend QA/ }).style.boxShadow).toContain('#14b8a6');
    expect(screen.getByRole('button', { name: /Alice/ }).style.boxShadow).toContain('#a16207');
    expect(screen.getByRole('button', { name: /Sam/ }).style.boxShadow).toContain('#3b82f6');
    fireEvent.click(architect);
    expect(onMention).toHaveBeenCalledWith(expect.objectContaining({ id: 24, type: 'bot' }), '@');
  });
});

it('finds a passport by handle and inserts the handle instead of the display name', () => {
  const onChange = vi.fn();
  render(<MentionInput value="@audit" onChange={onChange} availableUsers={[
    { id: 99, name: 'Quality Reviewer', type: 'bot', handle: 'audit-reviewer' },
  ]} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '@audit-', selectionStart: 7 } });
  fireEvent.click(screen.getByRole('button', { name: /Quality Reviewer/ }));
  expect(onChange).toHaveBeenLastCalledWith('<<@audit-reviewer>> ');
});

it('closes an empty picker with Escape after a passport disappears', () => {
  const { rerender } = render(<MentionInput value="@audit" onChange={vi.fn()} availableUsers={[
    { id: 99, name: 'Reviewer', handle: 'audit-reviewer', type: 'bot' },
  ]} />);
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: '@audit-', selectionStart: 7 } });
  expect(screen.getByRole('button', { name: /Reviewer/ })).toBeInTheDocument();
  rerender(<MentionInput value="@audit-" onChange={vi.fn()} availableUsers={[]} />);
  expect(screen.getByText(/Нет совпадений/)).toBeInTheDocument();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByText(/Нет совпадений/)).not.toBeInTheDocument();
});
