import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsPanel } from '../SettingsPanel';

type MockIconProps = { className?: string; [key: string]: unknown };

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
import type { 
  Agent, 
  Operator, 
  Model, 
  TicketsSource, 
  FilesSource, 
  Space,
  Conversation 
} from '../../../types';

// Mock components
vi.mock('@/features/ai-chat/components/TicketsSourceInlineSelector', () => ({
  TicketsSourceInlineSelector: ({ onSelect, onCancel }: { onSelect: (source: { tableId: string; tableName: string; tableIcon: string }) => void; onCancel: () => void }) => (
    <div data-testid="tickets-source-selector">
      <button onClick={() => onSelect({ tableId: 'table1', tableName: 'Test Table', tableIcon: '📋' })}>
        Select Tickets Table
      </button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  )
}));

vi.mock('@/features/ai-chat/components/FilesSourceInlineSelector', () => ({
  FilesSourceInlineSelector: ({ onSelect, onCancel }: { onSelect: (source: { tableId: string; tableName: string; tableIcon: string }) => void; onCancel: () => void }) => (
    <div data-testid="files-source-selector">
      <button onClick={() => onSelect({ tableId: 'table2', tableName: 'Files Table', tableIcon: '📁' })}>
        Select Files Table
      </button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  )
}));


vi.mock('../ContextSettingsSection', () => ({
  ContextSettingsSection: ({ contextSettings, onChange, onSave, isSaving, disabled }: {
    contextSettings: unknown;
    onChange: (s: unknown) => void;
    onSave: (s: unknown) => void;
    isSaving: boolean;
    disabled: boolean;
  }) => (
    <div data-testid="context-settings-section">Context Settings</div>
  )
}));

// Mock icons
vi.mock('lucide-react', () => ({
  Bot: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="bot-icon" {...props} />,
  Users: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="users-icon" {...props} />,
  Settings: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="settings-icon" {...props} />,
  User: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="user-icon" {...props} />,
  Loader2: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="loader-icon" {...props} />,
  Save: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="save-icon" {...props} />,
  Trash2: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="trash-icon" {...props} />,
  Inbox: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="inbox-icon" {...props} />,
  AlertCircle: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="alert-circle-icon" {...props} />
}));

// Mock cn utility
vi.mock('@/shared/utils/cn', () => ({
  cn: (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(' ')
}));

describe('SettingsPanel', () => {
  const mockCurrentAgent: Agent = {
    id: 1,
    name: 'Test Agent',
    icon: '🤖',
    system_prompt: 'Test system prompt',
    model: 'gpt-4',
    provider_id: 1,
    operator_id: 1
  };

  const mockOperators: Operator[] = [
    { id: 1, name: 'OpenAI' },
    { id: 2, name: 'Anthropic' }
  ];

  const mockModels: Model[] = [
    { id: 1, model_id: 'gpt-4', name: 'GPT-4' },
    { id: 2, model_id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' }
  ];

  const mockAgents: Agent[] = [
    mockCurrentAgent,
    { id: 2, name: 'Another Agent', icon: '🤖', system_prompt: '', model: '', provider_id: 1, operator_id: 1 }
  ];

  const mockTicketsSource: TicketsSource = {
    tableId: 1,
    tableName: 'Tasks Table',
    tableIcon: '📋'
  };

  const mockFilesSource: FilesSource = {
    tableId: 2,
    tableName: 'Files Table',
    tableIcon: '📁'
  };

  const mockInboxConversations: Conversation[] = [
    { id: 1, title: 'Chat 1', type: 'ai', updatedAt: '2024-01-20T10:00:00Z' },
    { id: 2, title: 'Chat 2', type: 'ai', updatedAt: '2024-01-21T10:00:00Z' }
  ];

  const defaultProps = {
    settingsTab: 'ai' as const,
    currentAgent: mockCurrentAgent,
    operators: mockOperators,
    models: mockModels,
    agents: mockAgents,
    chatOperatorId: 1,
    chatModelId: 'gpt-4',
    chatSystemPrompt: 'Test system prompt',
    isAdminOrOwner: true,
    isSavingAgentSettings: false,
    messages: [{ id: '1', content: 'test', role: 'user' as const, timestamp: new Date() }],
    availableAgents: [
      { row_id: 1, name: 'Agent 1', icon: null, description: 'Test agent' },
      { row_id: 2, name: 'Agent 2', icon: null, description: 'Another agent' },
    ],
    chatPartner: { type: 'user' as const, id: 1, name: 'John Doe', email: 'john@example.com' },
    totalUnreadCount: 5,
    inboxConversations: mockInboxConversations,
    ticketsSource: mockTicketsSource,
    filesSource: mockFilesSource,
    currentSpace: { id: 1, name: 'Test Space' },
    defaultAgentId: 1,
    isSavingDefaultAgent: false,
    quickEmojis: ['😊', '👍', '❤️'],
    isSavingEmojis: false,
    voiceMode: 'webSpeech' as const,
    webSpeechAvailable: true,
    voiceError: null,
    setSettingsTab: vi.fn(),
    setChatOperatorId: vi.fn(),
    setChatModelId: vi.fn(),
    setChatSystemPrompt: vi.fn(),
    saveAgentSettings: vi.fn(),
    clearMessages: vi.fn(),
    setChatMode: vi.fn(),
    setActivePanel: vi.fn(),
    refetchInbox: vi.fn(),
    setTicketsSource: vi.fn(),
    setFilesSource: vi.fn(),
    saveDefaultAgent: vi.fn(),
    setQuickEmojis: vi.fn(),
    saveQuickEmojis: vi.fn(),
    setVoiceMode: vi.fn(),
    // ADR-110: Context settings
    contextSettings: undefined,
    isSavingContextSettings: false,
    onContextSettingsChange: vi.fn(),
    onContextSettingsSave: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Settings Tabs', () => {
    it('should render all three tabs', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} />);
      
      expect(screen.getByText('AI')).toBeInTheDocument();
      expect(screen.getByText('Люди')).toBeInTheDocument();
      expect(screen.getByText('Виджет')).toBeInTheDocument();
    });

    it('should highlight active tab', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="people" />);
      
      const peopleTab = screen.getByText('Люди').closest('button');
      expect(peopleTab).toHaveClass('text-blue-500', 'border-blue-500');
    });

    it('should switch tabs when clicked', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} />);
      
      fireEvent.click(screen.getByText('Люди'));
      expect(defaultProps.setSettingsTab).toHaveBeenCalledWith('people');
      
      fireEvent.click(screen.getByText('Виджет'));
      expect(defaultProps.setSettingsTab).toHaveBeenCalledWith('widget');
    });
  });

  describe('AI Settings Tab', () => {
    it('should display current agent info', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} />);
      
      expect(screen.getByText('Test Agent')).toBeInTheDocument();
      expect(screen.getByText('🤖')).toBeInTheDocument();
      expect(screen.getByText('AI Агент')).toBeInTheDocument();
    });

    it('should show "Не выбран" when no current agent', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} currentAgent={null} />);
      
      expect(screen.getByText('Не выбран')).toBeInTheDocument();
    });

    it('should render operator and model selectors', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} />);
      
      expect(screen.getByDisplayValue('OpenAI')).toBeInTheDocument();
      expect(screen.getByDisplayValue('GPT-4')).toBeInTheDocument();
    });

    it('should disable selectors for non-admin users', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} isAdminOrOwner={false} />);
      
      const operatorSelect = screen.getByDisplayValue('OpenAI');
      const modelSelect = screen.getByDisplayValue('GPT-4');
      
      expect(operatorSelect).toBeDisabled();
      expect(modelSelect).toBeDisabled();
    });

    it('should render system prompt textarea', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} />);
      
      const textarea = screen.getByDisplayValue('Test system prompt');
      expect(textarea).toBeInTheDocument();
    });

    it('should show save button when settings changed', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} chatModelId="gpt-3.5-turbo" />);
      
      expect(screen.getByText('Сохранить в агента')).toBeInTheDocument();
    });

    it('should call saveAgentSettings when save button clicked', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} chatModelId="gpt-3.5-turbo" />);
      
      fireEvent.click(screen.getByText('Сохранить в агента'));
      expect(defaultProps.saveAgentSettings).toHaveBeenCalled();
    });

    it('should render clear messages button', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} />);
      
      expect(screen.getByText('Очистить AI историю')).toBeInTheDocument();
    });

    it('should disable clear button when no messages', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} messages={[]} />);
      
      const clearButton = screen.getByText('Очистить AI историю');
      expect(clearButton).toBeDisabled();
    });

  });

  describe('People Settings Tab', () => {
    beforeEach(() => {
      defaultProps.setSettingsTab.mockClear();
    });

    it('should display chat partner info', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="people" />);
      
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('john@example.com')).toBeInTheDocument();
    });

    it('should show "Не выбран" when no chat partner', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="people" chatPartner={null} />);
      
      expect(screen.getByText('Не выбран')).toBeInTheDocument();
      expect(screen.getByText('Выберите контакт')).toBeInTheDocument();
    });

    it('should display unread count and active conversations', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="people" />);
      
      expect(screen.getByText('5')).toBeInTheDocument(); // unread count
      expect(screen.getByText('2')).toBeInTheDocument(); // active conversations
    });

    it('should render notifications toggle', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="people" />);
      
      expect(screen.getByText('Уведомления')).toBeInTheDocument();
      expect(screen.getByText('Звук при новых сообщениях')).toBeInTheDocument();
    });

    it('should open contacts when button clicked', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="people" />);
      
      fireEvent.click(screen.getByText('Открыть контакты'));
      
      expect(defaultProps.setChatMode).toHaveBeenCalledWith('people');
      expect(defaultProps.setActivePanel).toHaveBeenCalledWith('contacts');
    });

    it('should open inbox when button clicked', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="people" />);
      
      fireEvent.click(screen.getByText('Открыть входящие'));
      
      expect(defaultProps.setChatMode).toHaveBeenCalledWith('people');
      expect(defaultProps.setActivePanel).toHaveBeenCalledWith('inbox');
      expect(defaultProps.refetchInbox).toHaveBeenCalled();
    });
  });

  describe('Widget Settings Tab', () => {
    it('should display tasks source configuration', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="widget" />);
      
      expect(screen.getByText('Источник тикетов')).toBeInTheDocument();
      expect(screen.getByText('Tasks Table')).toBeInTheDocument();
    });

    it('should show tasks source selector when not configured', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="widget" ticketsSource={undefined} />);
      
      expect(screen.getByTestId('tickets-source-selector')).toBeInTheDocument();
    });

    it('should remove tasks source when delete clicked', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="widget" />);
      
      // Find the tasks source section and click its delete button
      const tasksSection = screen.getByText('Источник тикетов').closest('div');
      const deleteButton = tasksSection?.querySelector('button');
      fireEvent.click(deleteButton!);
      
      expect(defaultProps.setTicketsSource).toHaveBeenCalledWith(undefined);
    });

    it('should display files source configuration', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="widget" />);
      
      expect(screen.getByText('Источник файлов')).toBeInTheDocument();
      expect(screen.getByText('Files Table')).toBeInTheDocument();
    });

    it('should show files source selector when not configured', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="widget" filesSource={undefined} />);
      
      expect(screen.getByTestId('files-source-selector')).toBeInTheDocument();
    });

    it('should display default agent selector', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="widget" />);
      
      expect(screen.getByText('Агент по умолчанию')).toBeInTheDocument();
      expect(screen.getByDisplayValue('🤖 Test Agent')).toBeInTheDocument();
    });

    it('should save default agent when changed', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="widget" />);
      
      const select = screen.getByDisplayValue('🤖 Test Agent');
      fireEvent.change(select, { target: { value: '2' } });
      
      expect(defaultProps.saveDefaultAgent).toHaveBeenCalledWith(2);
    });

    it('should display quick emojis section', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="widget" />);
      
      expect(screen.getByText('Быстрые реакции')).toBeInTheDocument();
      expect(screen.getByDisplayValue('😊')).toBeInTheDocument();
      expect(screen.getByDisplayValue('👍')).toBeInTheDocument();
      expect(screen.getByDisplayValue('❤️')).toBeInTheDocument();
    });

    it('should add new emoji when plus button clicked', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="widget" quickEmojis={['😊']} />);
      
      fireEvent.click(screen.getByText('+'));
      expect(defaultProps.setQuickEmojis).toHaveBeenCalledWith(['😊', '😊']);
    });

    it('should save emojis when save button clicked', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="widget" />);
      
      fireEvent.click(screen.getByText('Сохранить'));
      expect(defaultProps.saveQuickEmojis).toHaveBeenCalledWith(['😊', '👍', '❤️']);
    });

    it('should display voice input settings', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="widget" />);
      
      expect(screen.getByText('Голосовой ввод')).toBeInTheDocument();
      expect(screen.getByText('Web Speech API')).toBeInTheDocument();
      expect(screen.getByText('OpenAI Whisper')).toBeInTheDocument();
    });

    it('should show voice availability status', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="widget" />);
      
      expect(screen.getByText('Доступен')).toBeInTheDocument();
    });

    it('should show unavailable status when web speech not available', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="widget" webSpeechAvailable={false} />);
      
      expect(screen.getByText('Недоступен')).toBeInTheDocument();
    });

    it('should change voice mode when radio button clicked', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="widget" />);
      
      const whisperRadio = screen.getByDisplayValue('whisper');
      fireEvent.click(whisperRadio);
      
      expect(defaultProps.setVoiceMode).toHaveBeenCalledWith('whisper');
    });

    it('should display voice error when present', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="widget" voiceError="Test error" />);
      
      expect(screen.getByText('Test error')).toBeInTheDocument();
    });
  });

  describe('Loading states', () => {
    it('should show loading spinner when saving agent settings', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} isSavingAgentSettings={true} chatModelId="gpt-3.5-turbo" />);
      
      expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
    });

    it('should show loading spinner when saving default agent', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="widget" isSavingDefaultAgent={true} />);
      
      expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
    });

    it('should show loading spinner when saving emojis', () => {
      renderWithProviders(<SettingsPanel {...defaultProps} settingsTab="widget" isSavingEmojis={true} />);
      
      expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
    });
  });
});