/**
 * AgentsPanel Component Tests
 * TDD: RED -> GREEN -> REFACTOR
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentsPanel } from '../AgentsPanel';

// Mock dependencies
vi.mock('@/shared/utils/cn', () => ({
  cn: (...classes: string[]) => classes.filter(Boolean).join(' ')
}));

vi.mock('@/shared/utils/logger', () => ({
  logger: {
    debug: vi.fn()
  }
}));

const mockAgent = {
  id: 1,
  name: 'Test Agent',
  description: 'Test description',
  icon: '🤖',
  model: 'gpt-4',
  system_prompt: 'You are a test agent',
  provider: 'openai',
  is_active: true,
};

const mockProps = {
  agentsSearch: '',
  setAgentsSearch: vi.fn(),
  showFavoriteAgents: false,
  setShowFavoriteAgents: vi.fn(),
  isVectorSearching: false,
  vectorSearchResults: null,
  setVectorSearchResults: vi.fn(),
  agents: [],
  currentAgent: null,
  favoriteAgents: [],
  setFavoriteAgents: vi.fn(),
  onVectorSearch: vi.fn(),
  onAgentSelect: vi.fn(),
  onClearMessages: vi.fn(),
  onCreateTables: vi.fn(),
  setActivePanel: vi.fn(),
  isCreatingTables: false,
  createTablesError: null,
  isAdminOrOwner: false,
  operators: [],
  models: [],
  currentOperatorId: undefined,
  onOperatorChange: vi.fn()
};

describe('AgentsPanel', () => {
  it('should render agents panel with search input', () => {
    render(<AgentsPanel {...mockProps} />);
    
    expect(screen.getByPlaceholderText('Поиск агентов...')).toBeInTheDocument();
  });

  it('should call setAgentsSearch when search input changes', () => {
    const setAgentsSearch = vi.fn();
    render(<AgentsPanel {...mockProps} setAgentsSearch={setAgentsSearch} />);
    
    const searchInput = screen.getByPlaceholderText('Поиск агентов...');
    fireEvent.change(searchInput, { target: { value: 'test search' } });
    
    expect(setAgentsSearch).toHaveBeenCalledWith('test search');
  });

  it('should show clear button when search has value', () => {
    render(<AgentsPanel {...mockProps} agentsSearch="test" />);
    
    const clearButton = screen.getByRole('button', { name: /clear/i });
    expect(clearButton).toBeInTheDocument();
  });

  it('should call setShowFavoriteAgents when favorites button is clicked', () => {
    const setShowFavoriteAgents = vi.fn();
    render(<AgentsPanel {...mockProps} setShowFavoriteAgents={setShowFavoriteAgents} />);
    
    const favoritesButton = screen.getByTitle('Только избранные');
    fireEvent.click(favoritesButton);
    
    expect(setShowFavoriteAgents).toHaveBeenCalled();
  });

  it('should call onVectorSearch when AI search button is clicked', () => {
    const onVectorSearch = vi.fn();
    render(<AgentsPanel {...mockProps} agentsSearch="test" onVectorSearch={onVectorSearch} />);
    
    const aiSearchButton = screen.getByTitle('Семантический поиск');
    fireEvent.click(aiSearchButton);
    
    expect(onVectorSearch).toHaveBeenCalled();
  });

  it('should disable AI search button when no search text', () => {
    render(<AgentsPanel {...mockProps} agentsSearch="" />);
    
    const aiSearchButton = screen.getByTitle('Семантический поиск');
    expect(aiSearchButton).toBeDisabled();
  });

  it('should show loading spinner when vector searching', () => {
    render(<AgentsPanel {...mockProps} isVectorSearching={true} agentsSearch="test" />);
    
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('should show empty state when no agents', () => {
    render(<AgentsPanel {...mockProps} agents={[]} />);
    
    expect(screen.getByText('AI агенты не настроены')).toBeInTheDocument();
    expect(screen.getByText('Создать AI таблицы')).toBeInTheDocument();
  });

  it('should show "not found" message when search has no results', () => {
    render(<AgentsPanel {...mockProps} agents={[]} agentsSearch="nonexistent" />);
    
    expect(screen.getByText('Не найдено')).toBeInTheDocument();
  });

  it('should render agent list when agents are provided', () => {
    const agents = [mockAgent];
    render(<AgentsPanel {...mockProps} agents={agents} />);
    
    expect(screen.getByText('Test Agent')).toBeInTheDocument();
    expect(screen.getByText('Test description')).toBeInTheDocument();
  });

  it('should call onAgentSelect when agent is clicked', () => {
    const onAgentSelect = vi.fn();
    const agents = [mockAgent];
    render(<AgentsPanel {...mockProps} agents={agents} onAgentSelect={onAgentSelect} />);
    
    const agentButton = screen.getByText('Test Agent').closest('button');
    fireEvent.click(agentButton!);
    
    expect(onAgentSelect).toHaveBeenCalledWith(mockAgent);
  });

  it('should toggle favorite when favorite button is clicked', () => {
    const setFavoriteAgents = vi.fn();
    const agents = [mockAgent];
    render(<AgentsPanel {...mockProps} agents={agents} setFavoriteAgents={setFavoriteAgents} />);
    
    const favoriteButton = screen.getByTitle('В избранное');
    fireEvent.click(favoriteButton);
    
    expect(setFavoriteAgents).toHaveBeenCalled();
  });

  it('should show active badge for current agent', () => {
    const agents = [mockAgent];
    render(<AgentsPanel {...mockProps} agents={agents} currentAgent={mockAgent} />);
    
    expect(screen.getByText('активен')).toBeInTheDocument();
  });

  it('should call onCreateTables when create tables button is clicked', () => {
    const onCreateTables = vi.fn();
    render(<AgentsPanel {...mockProps} agents={[]} onCreateTables={onCreateTables} />);
    
    const createButton = screen.getByText('Создать AI таблицы');
    fireEvent.click(createButton);
    
    expect(onCreateTables).toHaveBeenCalled();
  });

  it('should start new chat when new chat button is clicked', () => {
    const onAgentSelect = vi.fn();
    const onClearMessages = vi.fn();
    const setActivePanel = vi.fn();
    const agents = [mockAgent];
    render(<AgentsPanel {...mockProps} agents={agents} onAgentSelect={onAgentSelect} onClearMessages={onClearMessages} setActivePanel={setActivePanel} />);

    const newChatButton = screen.getByTitle('Новый чат');
    fireEvent.click(newChatButton);

    expect(onAgentSelect).toHaveBeenCalledWith(mockAgent);
    expect(onClearMessages).toHaveBeenCalled();
    expect(setActivePanel).toHaveBeenCalledWith('none');
  });
});