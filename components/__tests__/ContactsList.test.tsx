/**
 * ContactsList Component Tests (v3)
 * ADR-024: Chat Architecture
 * TASK-042: Subagents Architecture - correct filter logic
 * 
 * Key architecture (v3):
 * - "Контакты" tab: Users with dropdown filter (Все/Люди/AI)
 * - "AI Чат" tab: AI agents (subagents) from agents prop
 * - "Задачи" tab: rows from configured table
 * - Status shown as dot on avatar
 * - User type shown as text label (Человек/AI Агент)
 * - Chat history section (collapsible)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContactsList } from '../ContactsList.v3';
import { AIAgent } from '../../types';

// Mock apiClient - data must be inline in factory
vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({
      success: true,
      data: [
        { id: 1, name: 'User One', email: 'user1@test.com', user_type: 'human' },
        { id: 2, name: 'User Two', email: 'user2@test.com', user_type: 'human' },
        { id: 3, name: 'Dev Agent Worker', email: 'dev@ai.local', user_type: 'agent', managed_by_agent_table_id: 10, managed_by_agent_row_id: 42 },
        { id: 4, name: 'QA Agent Worker', email: 'qa@ai.local', user_type: 'agent', managed_by_agent_table_id: 10, managed_by_agent_row_id: 43 }
      ]
    })
  }
}));

// Subagents (AI agents from table_rows - NOT users)
const mockAgents: AIAgent[] = [
  {
    id: 1,
    name: 'Assistant',
    icon: '🤖',
    description: 'General AI assistant',
    model: 'gpt-4',
    model_name: 'GPT-4',
    provider: 'openai',
    provider_id: 1,
    system_prompt: 'You are a helpful assistant',
    is_active: true
  },
  {
    id: 2,
    name: 'Translator',
    icon: '🌐',
    description: 'Translates text',
    model: 'gpt-4',
    model_name: 'GPT-4',
    provider: 'openai',
    provider_id: 1,
    system_prompt: 'You are a translator',
    is_active: true
  }
];

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

describe('ContactsList v3', () => {
  const mockOnSelectAgent = vi.fn();
  const mockOnSelectUser = vi.fn();
  const mockOnAddToChat = vi.fn();
  const mockOnRemoveFromChat = vi.fn();
  const mockOnStartChatWithUser = vi.fn();
  const mockOnConfigureTasks = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Tabs', () => {
    it('renders 3 tabs: Контакты, AI Чат, Задачи', () => {
      renderWithProviders(
        <ContactsList
          agents={mockAgents}
          onSelectAgent={mockOnSelectAgent}
        />
      );

      expect(screen.getByRole('button', { name: /контакты/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /ai чат/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /задачи/i })).toBeInTheDocument();
    });

    it('Contacts tab is active by default', () => {
      renderWithProviders(
        <ContactsList
          agents={mockAgents}
          onSelectAgent={mockOnSelectAgent}
        />
      );

      const contactsTab = screen.getByRole('button', { name: /контакты/i });
      expect(contactsTab).toHaveClass('text-[var(--color-primary-500)]');
    });
  });

  describe('Contacts Tab', () => {
    it('shows all users by default', async () => {
      renderWithProviders(
        <ContactsList
          agents={mockAgents}
          onSelectAgent={mockOnSelectAgent}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('User One')).toBeInTheDocument();
        expect(screen.getByText('User Two')).toBeInTheDocument();
        expect(screen.getByText('Dev Agent Worker')).toBeInTheDocument();
        expect(screen.getByText('QA Agent Worker')).toBeInTheDocument();
      });
    });

    it('shows user type labels', async () => {
      renderWithProviders(
        <ContactsList
          agents={mockAgents}
          onSelectAgent={mockOnSelectAgent}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('User One')).toBeInTheDocument();
      });

      // Human users should have "Человек" label
      expect(screen.getAllByText('Человек').length).toBeGreaterThanOrEqual(2);
      // AI users should have "AI Агент" label
      expect(screen.getAllByText('AI Агент').length).toBeGreaterThanOrEqual(2);
    });

    it('has filter dropdown to select contact type', async () => {
      renderWithProviders(
        <ContactsList
          agents={mockAgents}
          onSelectAgent={mockOnSelectAgent}
        />
      );

      // Find dropdown with "Все (4)"
      const filterDropdown = screen.getByRole('combobox');
      expect(filterDropdown).toBeInTheDocument();
    });

    it('filters to humans only when "Люди" selected', async () => {
      renderWithProviders(
        <ContactsList
          agents={mockAgents}
          onSelectAgent={mockOnSelectAgent}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('User One')).toBeInTheDocument();
      });

      // Select "Люди" filter
      const filterDropdown = screen.getByRole('combobox');
      fireEvent.change(filterDropdown, { target: { value: 'humans' } });

      await waitFor(() => {
        expect(screen.getByText('User One')).toBeInTheDocument();
        expect(screen.getByText('User Two')).toBeInTheDocument();
      });

      expect(screen.queryByText('Dev Agent Worker')).not.toBeInTheDocument();
      expect(screen.queryByText('QA Agent Worker')).not.toBeInTheDocument();
    });

    it('filters to AI agents only when "AI" selected', async () => {
      renderWithProviders(
        <ContactsList
          agents={mockAgents}
          onSelectAgent={mockOnSelectAgent}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Dev Agent Worker')).toBeInTheDocument();
      });

      // Select "agents" filter
      const filterDropdown = screen.getByRole('combobox');
      fireEvent.change(filterDropdown, { target: { value: 'agents' } });

      await waitFor(() => {
        expect(screen.getByText('Dev Agent Worker')).toBeInTheDocument();
        expect(screen.getByText('QA Agent Worker')).toBeInTheDocument();
      });

      expect(screen.queryByText('User One')).not.toBeInTheDocument();
      expect(screen.queryByText('User Two')).not.toBeInTheDocument();
    });

    it('shows search input for contacts', () => {
      renderWithProviders(
        <ContactsList
          agents={mockAgents}
          onSelectAgent={mockOnSelectAgent}
        />
      );

      expect(screen.getByPlaceholderText(/поиск контактов/i)).toBeInTheDocument();
    });

    it('filters contacts by search query', async () => {
      renderWithProviders(
        <ContactsList
          agents={mockAgents}
          onSelectAgent={mockOnSelectAgent}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('User One')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/поиск контактов/i);
      fireEvent.change(searchInput, { target: { value: 'Dev Agent' } });

      await waitFor(() => {
        expect(screen.getByText('Dev Agent Worker')).toBeInTheDocument();
      });
      expect(screen.queryByText('User One')).not.toBeInTheDocument();
    });

    it('shows "в чате" badge for participants', async () => {
      renderWithProviders(
        <ContactsList
          agents={mockAgents}
          onSelectAgent={mockOnSelectAgent}
          chatParticipantIds={[1]}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('User One')).toBeInTheDocument();
      });

      expect(screen.getByText('в чате')).toBeInTheDocument();
    });

    it('shows empty state when no contacts match search', async () => {
      renderWithProviders(
        <ContactsList
          agents={mockAgents}
          onSelectAgent={mockOnSelectAgent}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('User One')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/поиск контактов/i);
      fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

      await waitFor(() => {
        expect(screen.getByText(/ничего не найдено/i)).toBeInTheDocument();
      });
    });
  });

  describe('AI Chat Tab', () => {
    it('displays AI agents when AI Чат tab clicked', async () => {
      renderWithProviders(
        <ContactsList
          agents={mockAgents}
          onSelectAgent={mockOnSelectAgent}
        />
      );

      const aiChatTab = screen.getByRole('button', { name: /ai чат/i });
      fireEvent.click(aiChatTab);

      await waitFor(() => {
        expect(screen.getByText('Assistant')).toBeInTheDocument();
        expect(screen.getByText('Translator')).toBeInTheDocument();
      });
    });

    it('calls onSelectAgent when agent clicked', async () => {
      renderWithProviders(
        <ContactsList
          agents={mockAgents}
          onSelectAgent={mockOnSelectAgent}
        />
      );

      const aiChatTab = screen.getByRole('button', { name: /ai чат/i });
      fireEvent.click(aiChatTab);

      await waitFor(() => {
        expect(screen.getByText('Assistant')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Assistant'));
      expect(mockOnSelectAgent).toHaveBeenCalledWith(mockAgents[0]);
    });

    it('highlights current agent with "активен" badge', async () => {
      renderWithProviders(
        <ContactsList
          agents={mockAgents}
          onSelectAgent={mockOnSelectAgent}
          currentAgentId={1}
        />
      );

      const aiChatTab = screen.getByRole('button', { name: /ai чат/i });
      fireEvent.click(aiChatTab);

      await waitFor(() => {
        expect(screen.getByText('Assistant')).toBeInTheDocument();
      });

      expect(screen.getByText('активен')).toBeInTheDocument();
    });

    it('shows empty state when no agents', () => {
      renderWithProviders(
        <ContactsList
          agents={[]}
          onSelectAgent={mockOnSelectAgent}
        />
      );

      const aiChatTab = screen.getByRole('button', { name: /ai чат/i });
      fireEvent.click(aiChatTab);

      expect(screen.getByText(/нет доступных агентов/i)).toBeInTheDocument();
    });
  });

  describe('Tasks Tab', () => {
    it('shows setup prompt when no tasksSource configured', () => {
      renderWithProviders(
        <ContactsList
          agents={mockAgents}
          onSelectAgent={mockOnSelectAgent}
          onConfigureTasks={mockOnConfigureTasks}
        />
      );

      const tasksTab = screen.getByRole('button', { name: /задачи/i });
      fireEvent.click(tasksTab);

      expect(screen.getByText(/источник не настроен/i)).toBeInTheDocument();
    });

    it('calls onConfigureTasks when configure button clicked', () => {
      renderWithProviders(
        <ContactsList
          agents={mockAgents}
          onSelectAgent={mockOnSelectAgent}
          onConfigureTasks={mockOnConfigureTasks}
        />
      );

      const tasksTab = screen.getByRole('button', { name: /задачи/i });
      fireEvent.click(tasksTab);

      // Click the "Настроить" button in the empty state
      const buttons = screen.getAllByRole('button');
      const configButton = buttons.find(b => b.textContent?.includes('Настроить'));
      expect(configButton).toBeTruthy();
      
      if (configButton) {
        fireEvent.click(configButton);
        expect(mockOnConfigureTasks).toHaveBeenCalled();
      }
    });
  });

  describe('Chat History', () => {
    it('shows chat history section when conversations provided', () => {
      renderWithProviders(
        <ContactsList
          agents={mockAgents}
          onSelectAgent={mockOnSelectAgent}
          conversations={[
            { id: '1', title: 'Test Chat', agentName: 'Assistant', messageCount: 5 }
          ]}
        />
      );

      expect(screen.getByText('История чатов')).toBeInTheDocument();
    });

    it('hides chat history when conversations empty', () => {
      renderWithProviders(
        <ContactsList
          agents={mockAgents}
          onSelectAgent={mockOnSelectAgent}
          conversations={[]}
        />
      );

      expect(screen.queryByText('История чатов')).not.toBeInTheDocument();
    });

    it('displays conversation titles in history', async () => {
      renderWithProviders(
        <ContactsList
          agents={mockAgents}
          onSelectAgent={mockOnSelectAgent}
          conversations={[
            { id: '1', title: 'Chat 1', agentName: 'Assistant', messageCount: 3 },
            { id: '2', title: 'Chat 2', agentName: 'Translator', messageCount: 7 }
          ]}
        />
      );

      // History is shown by default when conversations exist, but collapsed
      // Click to expand it
      const historyToggle = screen.getByText('История чатов').closest('button');
      expect(historyToggle).toBeInTheDocument();
      
      // Toggle is already expanded when conversations.length > 0, so chats should be visible
      await waitFor(() => {
        expect(screen.getByText('Chat 1')).toBeInTheDocument();
        expect(screen.getByText('Chat 2')).toBeInTheDocument();
      });
    });
  });
});
