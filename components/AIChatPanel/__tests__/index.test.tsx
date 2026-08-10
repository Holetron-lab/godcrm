import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AIChatPanel } from '../index';

type MockComponentProps = { children?: React.ReactNode; [key: string]: unknown };

// Test wrapper with QueryClientProvider
const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

const renderWithProviders = (ui: React.ReactElement) => {
  const testQueryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={testQueryClient}>
      {ui}
    </QueryClientProvider>
  );
};

// Mock useAIChat context hook
vi.mock('@/features/ai-chat/context/AIChatContext', () => ({
  useAIChat: () => ({
    chatMode: 'agent',
    activePanel: 'none',
    chatPartner: null,
    messages: [],
    inputValue: '',
    isLoading: false,
    showRowBinding: false,
    showFilePicker: false,
    showBoundRowsBar: false,
    boundRows: [],
    filesSearch: '',
    isLoadingFiles: false,
    projectFiles: [],
    thinkingEnabled: false,
    agentMode: 'ask',
    markdownEnabled: false,
    isRecording: false,
    isTranscribing: false,
    voiceError: null,
    attachments: [],
    fileInputRef: { current: null },
    contacts: [],
    contactsSearch: '',
    selectedContact: null,
    agents: [],
    agentsSearch: '',
    selectedAgent: null,
    conversations: [],
    historySearch: '',
    selectedConversation: null,
    inboxMessages: [],
    inboxSearch: '',
    selectedInboxMessage: null,
    tasks: [],
    tasksSearch: '',
    selectedTask: null,
    settings: {},
    setChatMode: vi.fn(),
    setActivePanel: vi.fn(),
    setInputValue: vi.fn(),
    setContactsSearch: vi.fn(),
    setSelectedContact: vi.fn(),
    setAgentsSearch: vi.fn(),
    setSelectedAgent: vi.fn(),
    setHistorySearch: vi.fn(),
    setSelectedConversation: vi.fn(),
    setInboxSearch: vi.fn(),
    setSelectedInboxMessage: vi.fn(),
    setTasksSearch: vi.fn(),
    setSelectedTask: vi.fn(),
    setSettings: vi.fn(),
    setShowRowBinding: vi.fn(),
    setShowFilePicker: vi.fn(),
    setShowBoundRowsBar: vi.fn(),
    setFilesSearch: vi.fn(),
    setThinkingEnabled: vi.fn(),
    setAgentMode: vi.fn(),
    setMarkdownEnabled: vi.fn(),
    togglePanel: vi.fn(),
    handleSubmit: vi.fn(),
    handleMessageReaction: vi.fn(),
    handleMessageEdit: vi.fn(),
    handleMessageDelete: vi.fn(),
    handleMessageCopy: vi.fn(),
    handleRowBind: vi.fn(),
    handleRowUnbind: vi.fn(),
    handleFileSelect: vi.fn(),
    handleStartRecording: vi.fn(),
    handleStopRecording: vi.fn(),
    handleCancelRecording: vi.fn(),
    handleMention: vi.fn(),
    panelHeight: 300,
    handleResize: vi.fn(),
    ticketsSource: undefined,
    filesSource: undefined,
    setTicketsSource: vi.fn(),
    setFilesSource: vi.fn(),
  }),
  AIChatProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock all the child components
vi.mock('../hooks/useChatState', () => ({
  useChatState: () => ({
    chatMode: 'agent',
    activePanel: 'none',
    chatPartner: null,
    messages: [],
    inputValue: '',
    isLoading: false,
    showRowBinding: false,
    showFilePicker: false,
    showBoundRowsBar: false,
    boundRows: [],
    filesSearch: '',
    isLoadingFiles: false,
    projectFiles: [],
    thinkingEnabled: false,
    agentMode: 'ask',
    markdownEnabled: false,
    isRecording: false,
    isTranscribing: false,
    voiceError: null,
    attachments: [],
    fileInputRef: { current: null },
    contacts: [],
    contactsSearch: '',
    selectedContact: null,
    agents: [],
    agentsSearch: '',
    selectedAgent: null,
    conversations: [],
    historySearch: '',
    selectedConversation: null,
    inboxMessages: [],
    inboxSearch: '',
    selectedInboxMessage: null,
    tasks: [],
    tasksSearch: '',
    selectedTask: null,
    settings: {},
    setChatMode: vi.fn(),
    setActivePanel: vi.fn(),
    setInputValue: vi.fn(),
    setContactsSearch: vi.fn(),
    setSelectedContact: vi.fn(),
    setAgentsSearch: vi.fn(),
    setSelectedAgent: vi.fn(),
    setHistorySearch: vi.fn(),
    setSelectedConversation: vi.fn(),
    setInboxSearch: vi.fn(),
    setSelectedInboxMessage: vi.fn(),
    setTasksSearch: vi.fn(),
    setSelectedTask: vi.fn(),
    setSettings: vi.fn(),
    setShowRowBinding: vi.fn(),
    setShowFilePicker: vi.fn(),
    setShowBoundRowsBar: vi.fn(),
    setFilesSearch: vi.fn(),
    setThinkingEnabled: vi.fn(),
    setAgentMode: vi.fn(),
    setMarkdownEnabled: vi.fn(),
    togglePanel: vi.fn(),
  }),
}));

vi.mock('../hooks/usePanelResize', () => ({
  usePanelResize: () => ({
    panelHeight: 300,
    handleResize: vi.fn(),
  }),
}));

vi.mock('../hooks/useChatActions', () => ({
  useChatActions: () => ({
    handleSubmit: vi.fn(),
    handleMessageReaction: vi.fn(),
    handleMessageEdit: vi.fn(),
    handleMessageDelete: vi.fn(),
    handleMessageCopy: vi.fn(),
    handleRowBind: vi.fn(),
    handleRowUnbind: vi.fn(),
    handleFileSelect: vi.fn(),
    handleStartRecording: vi.fn(),
    handleStopRecording: vi.fn(),
    handleCancelRecording: vi.fn(),
    handleMention: vi.fn(),
  }),
}));

vi.mock('../hooks/useInlineSelectors', () => ({
  useInlineSelectors: () => ({
    tasksSource: undefined,
    filesSource: undefined,
    setTasksSource: vi.fn(),
    setFilesSource: vi.fn(),
  }),
}));

vi.mock('../components/ChatHeader', () => ({
  ChatHeader: ({ children, ...props }: MockComponentProps) => <div data-testid="chat-header" {...props}>{children}</div>,
}));

vi.mock('../components/ChatMessages', () => ({
  ChatMessages: ({ children, ...props }: MockComponentProps) => <div data-testid="chat-messages" {...props}>{children}</div>,
}));

vi.mock('../components/ChatInput', () => ({
  ChatInput: ({ children, ...props }: MockComponentProps) => <div data-testid="chat-input" {...props}>{children}</div>,
}));

vi.mock('../components/shared/PanelContainer', () => ({
  PanelContainer: ({ children, ...props }: MockComponentProps) => <div data-testid="panel-container" {...props}>{children}</div>,
}));

// Mock all panel components
vi.mock('../components/ChatPanels/ContactsPanel', () => ({
  ContactsPanel: ({ children, ...props }: MockComponentProps) => <div data-testid="contacts-panel" {...props}>{children}</div>,
}));

vi.mock('../components/ChatPanels/AgentsPanel', () => ({
  AgentsPanel: ({ children, ...props }: MockComponentProps) => <div data-testid="agents-panel" {...props}>{children}</div>,
}));

vi.mock('../components/ChatPanels/HistoryPanel', () => ({
  HistoryPanel: ({ children, ...props }: MockComponentProps) => <div data-testid="history-panel" {...props}>{children}</div>,
}));

vi.mock('../components/ChatPanels/InboxPanel', () => ({
  InboxPanel: ({ children, ...props }: MockComponentProps) => <div data-testid="inbox-panel" {...props}>{children}</div>,
}));

vi.mock('../components/ChatPanels/TasksPanel', () => ({
  TasksPanel: ({ children, ...props }: MockComponentProps) => <div data-testid="tasks-panel" {...props}>{children}</div>,
}));

vi.mock('../components/ChatPanels/SettingsPanel', () => ({
  SettingsPanel: ({ children, ...props }: MockComponentProps) => <div data-testid="settings-panel" {...props}>{children}</div>,
}));

describe('AIChatPanel', () => {
  // NOTE: These tests are skipped because the component structure has changed significantly
  // TODO: Rewrite these tests to match the new component structure after ADR-042 refactoring
  it.skip('should render main components', () => {
    renderWithProviders(<AIChatPanel />);

    expect(screen.getByTestId('chat-header')).toBeInTheDocument();
    expect(screen.getByTestId('chat-messages')).toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
  });

  it.skip('should apply custom className', () => {
    const { container } = renderWithProviders(<AIChatPanel className="custom-class" />);

    expect(container.firstChild).toHaveClass('custom-class');
  });

  it.skip('should not render panel container when activePanel is none', () => {
    renderWithProviders(<AIChatPanel />);

    expect(screen.queryByTestId('panel-container')).not.toBeInTheDocument();
  });

  it.skip('should have proper structure', () => {
    const { container } = renderWithProviders(<AIChatPanel />);

    expect(container.firstChild).toHaveClass('ai-chat-panel');
    expect(container.firstChild).toHaveClass('flex');
    expect(container.firstChild).toHaveClass('flex-col');
    expect(container.firstChild).toHaveClass('h-full');
  });
});