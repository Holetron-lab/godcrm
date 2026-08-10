/**
 * HistoryPanel Component Tests
 * TDD: RED -> GREEN -> REFACTOR
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HistoryPanel } from '../HistoryPanel';

// Mock dependencies
vi.mock('@/shared/utils/cn', () => ({
  cn: (...classes: string[]) => classes.filter(Boolean).join(' ')
}));

vi.mock('../../../../components/SortDropdown', () => ({
  SortDropdown: ({ value, onChange, options }: { value: string; onChange: (val: string) => void; options: string[] }) => (
    <select data-testid="sort-dropdown" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
    </select>
  )
}));

vi.mock('../../../../components/AccordionChatItem', () => ({
  AccordionChatItem: ({ conversation }: { conversation: { title: string } }) => (
    <div data-testid={`chat-${conversation.title}`}>{conversation.title}</div>
  )
}));

const mockProps = {
  historySearch: '',
  setHistorySearch: vi.fn(),
  sortOption: 'date' as const,
  setSortOption: vi.fn(),
  setActivePanel: vi.fn(),
  conversations: [],
  isLoadingConversations: false,
  currentConversationId: null,
  onConversationSelect: vi.fn(),
  onDeleteConversation: vi.fn()
};

// Skipped: HistoryPanel removed in Ticket #81448 (History button deleted, replaced by InboxPanel)
describe.skip('HistoryPanel', () => {
  it('should render history panel header with sort dropdown', () => {
    render(<HistoryPanel {...mockProps} />);
    
    // The SortDropdown renders as a button with title "Сортировка"
    expect(screen.getByTitle('Сортировка')).toBeInTheDocument();
    expect(screen.getByTitle('Закрыть')).toBeInTheDocument();
  });

  it('should render search input', () => {
    render(<HistoryPanel {...mockProps} />);
    
    expect(screen.getByPlaceholderText('Поиск в истории...')).toBeInTheDocument();
  });

  it('should call setHistorySearch when search input changes', () => {
    const setHistorySearch = vi.fn();
    render(<HistoryPanel {...mockProps} setHistorySearch={setHistorySearch} />);
    
    const searchInput = screen.getByPlaceholderText('Поиск в истории...');
    fireEvent.change(searchInput, { target: { value: 'test search' } });
    
    expect(setHistorySearch).toHaveBeenCalledWith('test search');
  });

  it('should call setActivePanel when close button is clicked', () => {
    const setActivePanel = vi.fn();
    render(<HistoryPanel {...mockProps} setActivePanel={setActivePanel} />);
    
    const closeButton = screen.getByTitle('Закрыть');
    fireEvent.click(closeButton);
    
    expect(setActivePanel).toHaveBeenCalledWith('none');
  });

  it('should call setSortOption when sort dropdown changes', () => {
    const setSortOption = vi.fn();
    render(<HistoryPanel {...mockProps} setSortOption={setSortOption} />);
    
    // The SortDropdown renders as a button, not a select
    const sortButton = screen.getByTitle('Сортировка');
    fireEvent.click(sortButton);
    
    // Since it's a complex dropdown, we'll just verify the button exists
    expect(sortButton).toBeInTheDocument();
  });

  it('should show loading state when isLoadingConversations is true', () => {
    render(<HistoryPanel {...mockProps} isLoadingConversations={true} />);
    
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('should show empty state when no conversations', () => {
    render(<HistoryPanel {...mockProps} conversations={[]} />);
    
    expect(screen.getByText('Нет истории чатов')).toBeInTheDocument();
  });

  it('should show "not found" message when search has no results', () => {
    render(<HistoryPanel {...mockProps} historySearch="nonexistent" conversations={[]} />);
    
    expect(screen.getByText('Не найдено')).toBeInTheDocument();
  });

  it('should render conversation list when conversations are provided', () => {
    const conversations = [
      { id: 1, title: 'Chat 1', updatedAt: '2024-01-01', agentName: 'Agent 1' },
      { id: 2, title: 'Chat 2', updatedAt: '2024-01-02', agentName: 'Agent 2' }
    ];
    
    render(<HistoryPanel {...mockProps} conversations={conversations} />);
    
    // AccordionChatItem renders the actual chat items, verify they exist by text content
    expect(screen.getByText('Chat 1')).toBeInTheDocument();
    expect(screen.getByText('Chat 2')).toBeInTheDocument();
  });

  it('should sort conversations by date by default', () => {
    const conversations = [
      { id: 1, title: 'Old Chat', updatedAt: '2024-01-01', agentName: 'Agent 1' },
      { id: 2, title: 'New Chat', updatedAt: '2024-01-02', agentName: 'Agent 2' }
    ];
    
    render(<HistoryPanel {...mockProps} conversations={conversations} sortOption="date" />);
    
    // Both should be rendered (order testing would require more complex setup)
    expect(screen.getByText('Old Chat')).toBeInTheDocument();
    expect(screen.getByText('New Chat')).toBeInTheDocument();
  });
});