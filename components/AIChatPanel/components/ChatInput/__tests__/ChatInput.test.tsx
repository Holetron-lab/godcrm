import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatInput } from '../ChatInput';
import type { ChatPartner, BoundRow, FilesSource } from '../../../types';

// Test wrapper with QueryClientProvider
const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

const renderWithProviders = (ui: React.ReactElement) => {
  const testQueryClient = createTestQueryClient();
  const result = render(
    <QueryClientProvider client={testQueryClient}>
      {ui}
    </QueryClientProvider>
  );
  return {
    ...result,
    rerender: (newUi: React.ReactElement) =>
      result.rerender(
        <QueryClientProvider client={testQueryClient}>
          {newUi}
        </QueryClientProvider>
      ),
  };
};

// Mock components
vi.mock('@/features/ai-chat/components/RowBindingV2', () => ({
  RowBindingV2: ({ onClose, onBind, onUnbind }: {
    onClose?: () => void;
    onBind?: (row: { table_id: number; row_id: number; table_name: string; row_title: string }) => void;
    onUnbind?: (tableId: number, rowId: number) => void;
  }) => (
    <div data-testid="row-binding">
      <button onClick={onClose}>Close Binding</button>
      <button onClick={() => onBind?.({ table_id: 1, row_id: 1, table_name: 'Test', row_title: 'Test Row' })}>
        Bind Row
      </button>
      <button onClick={() => onUnbind?.(1, 1)}>Unbind Row</button>
    </div>
  )
}));

vi.mock('@/features/ai-chat/components/FilesSourceInlineSelector', () => ({
  FilesSourceInlineSelector: ({ onSelect }: {
    onSelect?: (source: { tableId: number; tableName: string; tableIcon: string }) => void;
  }) => (
    <div data-testid="files-source-selector">
      <button onClick={() => onSelect?.({ tableId: 1, tableName: 'Files', tableIcon: '📁' })}>
        Select Files Source
      </button>
    </div>
  )
}));

vi.mock('@/features/ai-chat/components/MentionInput', () => ({
  MentionInput: ({ value, onChange, onSubmit, placeholder, disabled, onMention }: {
    value?: string;
    onChange?: (value: string) => void;
    onSubmit?: () => void;
    placeholder?: string;
    disabled?: boolean;
    onMention?: (user: { id: number; name: string; type: string }) => void;
  }) => (
    <textarea
      data-testid="mention-input"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onSubmit?.();
        }
        if (e.key === '@') {
          onMention?.({ id: 1, name: 'Test User', type: 'user' });
        }
      }}
      placeholder={placeholder}
      disabled={disabled}
    />
  )
}));

// Mock icons
vi.mock('lucide-react', () => ({
  Link2: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="link2-icon" {...props} />,
  Eye: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="eye-icon" {...props} />,
  EyeOff: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="eye-off-icon" {...props} />,
  Brain: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="brain-icon" {...props} />,
  Zap: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="zap-icon" {...props} />,
  Plus: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="plus-icon" {...props} />,
  Paperclip: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="paperclip-icon" {...props} />,
  Mic: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="mic-icon" {...props} />,
  Send: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="send-icon" {...props} />,
  Loader2: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="loader-icon" {...props} />,
  X: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="x-icon" {...props} />,
  Square: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="square-icon" {...props} />,
  FolderOpen: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="folder-open-icon" {...props} />,
  Search: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="search-icon" {...props} />,
  Settings: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="settings-icon" {...props} />
}));

// Mock utilities
vi.mock('@/shared/utils/cn', () => ({
  cn: (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(' ')
}));

vi.mock('@/shared/utils/fileHelpers', () => ({
  getFileIcon: vi.fn((type: string) => '📎'),
  formatFileSize: vi.fn((size: number) => `${size} bytes`)
}));

vi.mock('@/shared/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}));

describe('ChatInput', () => {
  const mockAgentPartner: ChatPartner = {
    type: 'agent',
    id: 1,
    name: 'Test Agent',
    icon: '🤖'
  };

  const mockUserPartner: ChatPartner = {
    type: 'user',
    id: 1,
    name: 'John Doe',
    email: 'john@example.com'
  };

  const mockBoundRows: BoundRow[] = [
    {
      table_id: 1,
      row_id: 1,
      table_name: 'Test Table',
      table_icon: '📋',
      row_title: 'Test Row 1'
    },
    {
      table_id: 2,
      row_id: 2,
      table_name: 'Another Table',
      table_icon: '📊',
      row_title: 'Test Row 2'
    }
  ];

  const mockFilesSource: FilesSource = {
    tableId: 1,
    tableName: 'Files Table',
    tableIcon: '📁',
    projectId: 1
  };

  const mockProjectFiles = [
    {
      id: 1,
      name: 'document.pdf',
      type: 'application/pdf',
      mimeType: 'application/pdf',
      size: 1024,
      url: '/files/1/document.pdf',
      created_at: '2024-01-20T10:00:00Z'
    },
    {
      id: 2,
      name: 'image.jpg',
      type: 'image/jpeg',
      mimeType: 'image/jpeg',
      size: 2048,
      url: '/files/2/image.jpg',
      created_at: '2024-01-21T10:00:00Z'
    }
  ];

  const defaultProps = {
    chatPartner: mockAgentPartner,
    inputValue: '',
    isLoading: false,
    showRowBinding: false,
    showFilePicker: false,
    showBoundRowsBar: false,
    boundRows: [],
    filesSource: mockFilesSource,
    filesSearch: '',
    isLoadingFiles: false,
    projectFiles: mockProjectFiles,
    thinkingEnabled: false,
    agentMode: 'ask' as const,
    markdownEnabled: true,
    isRecording: false,
    isTranscribing: false,
    recordingDuration: 0,
    voiceMode: 'webSpeech' as const,
    voiceError: null,
    attachments: [],
    availableMentionUsers: [],
    mentionedUsers: [],
    currentSpace: { id: 1, name: 'Test Space' },
    fileInputRef: { current: null },
    setInputValue: vi.fn(),
    setShowRowBinding: vi.fn(),
    setShowFilePicker: vi.fn(),
    setShowBoundRowsBar: vi.fn(),
    setBoundRows: vi.fn(),
    setFilesSource: vi.fn(),
    setFilesSearch: vi.fn(),
    setThinkingEnabled: vi.fn(),
    setAgentMode: vi.fn(),
    setMarkdownEnabled: vi.fn(),
    setMentionedUsers: vi.fn(),
    handleSubmit: vi.fn(),
    handleFileSelect: vi.fn(),
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    cancelRecording: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Row Binding', () => {
    it('should show row binding panel when enabled', () => {
      renderWithProviders(<ChatInput {...defaultProps} showRowBinding={true} />);

      expect(screen.getByTestId('row-binding')).toBeInTheDocument();
    });

    it('should hide row binding panel when disabled', () => {
      renderWithProviders(<ChatInput {...defaultProps} showRowBinding={false} />);

      expect(screen.queryByTestId('row-binding')).not.toBeInTheDocument();
    });

    it('should toggle row binding when button clicked', () => {
      renderWithProviders(<ChatInput {...defaultProps} />);

      fireEvent.click(screen.getByText('Привязать'));
      expect(defaultProps.setShowRowBinding).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should show bound rows count', () => {
      renderWithProviders(<ChatInput {...defaultProps} boundRows={mockBoundRows} />);

      expect(screen.getByText('Привязать (2)')).toBeInTheDocument();
    });

    it('should handle row binding', () => {
      renderWithProviders(<ChatInput {...defaultProps} showRowBinding={true} />);

      fireEvent.click(screen.getByText('Bind Row'));
      expect(defaultProps.setBoundRows).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should handle row unbinding', () => {
      renderWithProviders(<ChatInput {...defaultProps} showRowBinding={true} />);

      fireEvent.click(screen.getByText('Unbind Row'));
      expect(defaultProps.setBoundRows).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should close row binding panel', () => {
      renderWithProviders(<ChatInput {...defaultProps} showRowBinding={true} />);

      fireEvent.click(screen.getByText('Close Binding'));
      expect(defaultProps.setShowRowBinding).toHaveBeenCalledWith(false);
    });
  });

  describe('Bound Rows Bar', () => {
    it('should show bound rows bar when enabled and has rows', () => {
      renderWithProviders(<ChatInput {...defaultProps} showBoundRowsBar={true} boundRows={mockBoundRows} />);

      expect(screen.getByText('Test Row 1')).toBeInTheDocument();
      expect(screen.getByText('(Test Table)')).toBeInTheDocument();
      expect(screen.getByText('Test Row 2')).toBeInTheDocument();
      expect(screen.getByText('(Another Table)')).toBeInTheDocument();
    });

    it('should not show bound rows bar when no rows', () => {
      renderWithProviders(<ChatInput {...defaultProps} showBoundRowsBar={true} boundRows={[]} />);

      // The bound rows bar should not be visible, but the link2 icon in the input area will still be there
      expect(screen.queryByText('Test Row 1')).not.toBeInTheDocument();
    });

    it('should toggle bound rows bar visibility', () => {
      renderWithProviders(<ChatInput {...defaultProps} boundRows={mockBoundRows} />);

      const eyeButton = screen.getByTestId('eye-icon').closest('button')!;
      fireEvent.click(eyeButton);

      expect(defaultProps.setShowBoundRowsBar).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should show eye-off icon when bar is visible', () => {
      renderWithProviders(<ChatInput {...defaultProps} boundRows={mockBoundRows} showBoundRowsBar={true} />);

      expect(screen.getByTestId('eye-off-icon')).toBeInTheDocument();
    });
  });

  describe('File Picker', () => {
    it('should show file picker when enabled', () => {
      renderWithProviders(<ChatInput {...defaultProps} showFilePicker={true} />);

      // The text is split by emoji and space, so we need to check for the table name part
      expect(screen.getByText(/Files Table/)).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Поиск...')).toBeInTheDocument();
    });

    it('should show files source selector when no source configured', () => {
      renderWithProviders(<ChatInput {...defaultProps} showFilePicker={true} filesSource={undefined} />);

      expect(screen.getByTestId('files-source-selector')).toBeInTheDocument();
      expect(screen.getByText('Выберите источник файлов')).toBeInTheDocument();
    });

    it('should display project files', () => {
      renderWithProviders(<ChatInput {...defaultProps} showFilePicker={true} />);

      expect(screen.getByText('document.pdf')).toBeInTheDocument();
      expect(screen.getByText('image.jpg')).toBeInTheDocument();
    });

    it('should show loading state', () => {
      renderWithProviders(<ChatInput {...defaultProps} showFilePicker={true} isLoadingFiles={true} />);

      expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
    });

    it('should show empty state when no files', () => {
      renderWithProviders(<ChatInput {...defaultProps} showFilePicker={true} projectFiles={[]} />);

      expect(screen.getByText('Нет файлов в проекте')).toBeInTheDocument();
    });

    it('should filter files by search', () => {
      renderWithProviders(<ChatInput {...defaultProps} showFilePicker={true} filesSearch="pdf" />);

      expect(screen.getByText('document.pdf')).toBeInTheDocument();
      expect(screen.queryByText('image.jpg')).not.toBeInTheDocument();
    });

    it('should update search value', () => {
      renderWithProviders(<ChatInput {...defaultProps} showFilePicker={true} />);

      const searchInput = screen.getByPlaceholderText('Поиск...');
      fireEvent.change(searchInput, { target: { value: 'test' } });

      expect(defaultProps.setFilesSearch).toHaveBeenCalledWith('test');
    });

    it('should close file picker', () => {
      renderWithProviders(<ChatInput {...defaultProps} showFilePicker={true} />);

      const closeButtons = screen.getAllByTestId('x-icon');
      fireEvent.click(closeButtons[0].closest('button')!);

      expect(defaultProps.setShowFilePicker).toHaveBeenCalledWith(false);
      expect(defaultProps.setFilesSearch).toHaveBeenCalledWith('');
    });

    it('should select file and bind to rows', () => {
      renderWithProviders(<ChatInput {...defaultProps} showFilePicker={true} />);

      fireEvent.click(screen.getByText('document.pdf'));

      expect(defaultProps.setBoundRows).toHaveBeenCalledWith(expect.any(Function));
      expect(defaultProps.setShowFilePicker).toHaveBeenCalledWith(false);
    });
  });

  describe('Agent Mode Controls', () => {
    it('should show agent controls for agent chat', () => {
      renderWithProviders(<ChatInput {...defaultProps} chatPartner={mockAgentPartner} />);

      expect(screen.getByTestId('brain-icon')).toBeInTheDocument();
      expect(screen.getByText('ask')).toBeInTheDocument();
    });

    it('should not show agent controls for user chat', () => {
      renderWithProviders(<ChatInput {...defaultProps} chatPartner={mockUserPartner} />);

      expect(screen.queryByTestId('brain-icon')).not.toBeInTheDocument();
      expect(screen.queryByText('ask')).not.toBeInTheDocument();
    });

    it('should toggle thinking mode', () => {
      renderWithProviders(<ChatInput {...defaultProps} chatPartner={mockAgentPartner} />);

      fireEvent.click(screen.getByTestId('brain-icon').closest('button')!);
      expect(defaultProps.setThinkingEnabled).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should cycle through agent modes', () => {
      renderWithProviders(<ChatInput {...defaultProps} chatPartner={mockAgentPartner} />);

      fireEvent.click(screen.getByText('ask'));
      expect(defaultProps.setAgentMode).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should show correct agent mode colors', () => {
      const { rerender } = renderWithProviders(<ChatInput {...defaultProps} chatPartner={mockAgentPartner} agentMode="agent" />);
      expect(screen.getByText('agent')).toHaveClass('bg-orange-500/20');

      rerender(<ChatInput {...defaultProps} chatPartner={mockAgentPartner} agentMode="read" />);
      expect(screen.getByText('read')).toHaveClass('bg-green-500/20');
    });
  });

  describe('Markdown Toggle', () => {
    it('should toggle markdown mode', () => {
      renderWithProviders(<ChatInput {...defaultProps} />);

      fireEvent.click(screen.getByText('MD'));
      expect(defaultProps.setMarkdownEnabled).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should show active state when markdown enabled', () => {
      renderWithProviders(<ChatInput {...defaultProps} markdownEnabled={true} />);

      expect(screen.getByText('MD')).toHaveClass('text-[var(--color-primary-500)]');
    });
  });

  describe('Input and Submit', () => {
    it('should render mention input', () => {
      renderWithProviders(<ChatInput {...defaultProps} />);

      expect(screen.getByTestId('mention-input')).toBeInTheDocument();
    });

    it('should show correct placeholder for agent chat', () => {
      renderWithProviders(<ChatInput {...defaultProps} chatPartner={mockAgentPartner} />);

      expect(screen.getByPlaceholderText('Спросить Test Agent... (@ для вызова агента)')).toBeInTheDocument();
    });

    it('should show correct placeholder for user chat', () => {
      renderWithProviders(<ChatInput {...defaultProps} chatPartner={mockUserPartner} />);

      expect(screen.getByPlaceholderText('Введите сообщение... (@ для вызова агента)')).toBeInTheDocument();
    });

    it('should update input value', () => {
      renderWithProviders(<ChatInput {...defaultProps} />);

      const input = screen.getByTestId('mention-input');
      fireEvent.change(input, { target: { value: 'test message' } });

      expect(defaultProps.setInputValue).toHaveBeenCalledWith('test message');
    });

    it('should handle form submission', () => {
      renderWithProviders(<ChatInput {...defaultProps} inputValue="test message" />);

      const form = screen.getByTestId('mention-input').closest('form')!;
      fireEvent.submit(form);

      expect(defaultProps.handleSubmit).toHaveBeenCalled();
    });

    it('should disable submit when loading', () => {
      renderWithProviders(<ChatInput {...defaultProps} isLoading={true} />);

      const submitButton = screen.getByTestId('loader-icon').closest('button')!;
      expect(submitButton).toBeDisabled();
    });

    it('should disable submit when no input and no attachments', () => {
      renderWithProviders(<ChatInput {...defaultProps} inputValue="" attachments={[]} />);

      const submitButton = screen.getByTestId('send-icon').closest('button')!;
      expect(submitButton).toBeDisabled();
    });

    it('should enable submit with input', () => {
      renderWithProviders(<ChatInput {...defaultProps} inputValue="test" />);

      const submitButton = screen.getByTestId('send-icon').closest('button')!;
      expect(submitButton).not.toBeDisabled();
    });

    it('should enable submit with attachments', () => {
      renderWithProviders(<ChatInput {...defaultProps} inputValue="" attachments={[{ name: 'file.txt', type: 'text/plain' }]} />);

      const submitButton = screen.getByTestId('send-icon').closest('button')!;
      expect(submitButton).not.toBeDisabled();
    });
  });

  describe('File Attachment', () => {
    it('should trigger file input when paperclip clicked', () => {
      // Create a spy on the file input click method
      const mockClick = vi.fn();

      renderWithProviders(<ChatInput {...defaultProps} />);

      // Get the actual file input and spy on its click method
      const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
      fileInput.click = mockClick;

      const paperclipButton = screen.getByTestId('paperclip-icon').closest('button')!;
      fireEvent.click(paperclipButton);

      expect(mockClick).toHaveBeenCalled();
    });

    it('should handle file selection', () => {
      renderWithProviders(<ChatInput {...defaultProps} />);

      // Target the hidden file input directly using data-testid
      const fileInput = screen.getByTestId('file-input');
      const file = new File(['content'], 'test.txt', { type: 'text/plain' });

      fireEvent.change(fileInput, { target: { files: [file] } });
      expect(defaultProps.handleFileSelect).toHaveBeenCalled();
    });
  });

  describe('Voice Recording', () => {
    it('should show mic button when not recording', () => {
      renderWithProviders(<ChatInput {...defaultProps} />);

      expect(screen.getByTestId('mic-icon')).toBeInTheDocument();
    });

    it('should start recording when mic clicked', () => {
      renderWithProviders(<ChatInput {...defaultProps} />);

      fireEvent.click(screen.getByTestId('mic-icon').closest('button')!);
      expect(defaultProps.startRecording).toHaveBeenCalled();
    });

    it('should show recording controls when recording', () => {
      renderWithProviders(<ChatInput {...defaultProps} isRecording={true} recordingDuration={65} />);

      expect(screen.getByText('1:05')).toBeInTheDocument();
      expect(screen.getByTestId('x-icon')).toBeInTheDocument();
      expect(screen.getByTestId('square-icon')).toBeInTheDocument();
    });

    it('should cancel recording', () => {
      renderWithProviders(<ChatInput {...defaultProps} isRecording={true} />);

      fireEvent.click(screen.getByTestId('x-icon').closest('button')!);
      expect(defaultProps.cancelRecording).toHaveBeenCalled();
    });

    it('should stop recording', () => {
      renderWithProviders(<ChatInput {...defaultProps} isRecording={true} />);

      fireEvent.click(screen.getByTestId('square-icon').closest('button')!);
      expect(defaultProps.stopRecording).toHaveBeenCalled();
    });

    it('should show transcribing state', () => {
      renderWithProviders(<ChatInput {...defaultProps} isTranscribing={true} />);

      expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
    });

    it('should show voice error state', () => {
      renderWithProviders(<ChatInput {...defaultProps} voiceError="Microphone not available" />);

      const micButton = screen.getByTestId('mic-icon').closest('button')!;
      expect(micButton).toHaveClass('text-red-400');
    });
  });

  describe('Plus Button', () => {
    it('should toggle file picker when plus clicked', () => {
      renderWithProviders(<ChatInput {...defaultProps} />);

      fireEvent.click(screen.getByTestId('plus-icon').closest('button')!);
      expect(defaultProps.setShowFilePicker).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should show active state when file picker open', () => {
      renderWithProviders(<ChatInput {...defaultProps} showFilePicker={true} />);

      const plusButton = screen.getByTestId('plus-icon').closest('button')!;
      expect(plusButton).toHaveClass('text-[var(--color-primary-500)]');
    });
  });

  describe('Mention Handling', () => {
    it('should handle mentions', () => {
      renderWithProviders(<ChatInput {...defaultProps} />);

      const input = screen.getByTestId('mention-input');
      fireEvent.keyDown(input, { key: '@' });

      expect(defaultProps.setMentionedUsers).toHaveBeenCalledWith(expect.any(Function));
    });
  });
});
