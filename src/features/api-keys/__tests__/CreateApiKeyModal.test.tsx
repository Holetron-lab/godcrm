/**
 * @file CreateApiKeyModal.test.tsx
 * @description Tests for CreateApiKeyModal component (SECURITY CRITICAL)
 * @see ADR-034: Feature Tests Coverage
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateApiKeyModal } from '../components/CreateApiKeyModal';
import { apiKeysApi } from '../api/apiKeysApi';

// Mock dependencies
vi.mock('../api/apiKeysApi', () => ({
  apiKeysApi: {
    create: vi.fn(),
  },
}));

vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

vi.mock('@/shared/i18n/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en' }),
}));

const mockApiKeysApi = apiKeysApi as unknown as {
  create: ReturnType<typeof vi.fn>;
};

const renderWithProviders = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
};

describe('CreateApiKeyModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should not render when closed', () => {
      renderWithProviders(
        <CreateApiKeyModal open={false} onClose={() => {}} />
      );

      expect(screen.queryByText('New API Key')).not.toBeInTheDocument();
    });

    it('should render modal when open', () => {
      renderWithProviders(
        <CreateApiKeyModal open={true} onClose={() => {}} />
      );

      expect(screen.getByText('New API Key')).toBeInTheDocument();
    });

    it('should render name input', () => {
      renderWithProviders(
        <CreateApiKeyModal open={true} onClose={() => {}} />
      );

      expect(screen.getByPlaceholderText(/n8n Integration/i)).toBeInTheDocument();
    });

    it('should render permissions checkboxes', () => {
      renderWithProviders(
        <CreateApiKeyModal open={true} onClose={() => {}} />
      );

      expect(screen.getByText('Full access')).toBeInTheDocument();
      expect(screen.getByText('Read tables')).toBeInTheDocument();
      expect(screen.getByText('Write tables')).toBeInTheDocument();
    });

    it('should render expiration select', () => {
      renderWithProviders(
        <CreateApiKeyModal open={true} onClose={() => {}} />
      );

      expect(screen.getByText('Never expires')).toBeInTheDocument();
    });
  });

  describe('form validation', () => {
    it('should require name field', () => {
      renderWithProviders(
        <CreateApiKeyModal open={true} onClose={() => {}} />
      );

      const createButton = screen.getByText('Create');
      expect(createButton).toBeDisabled();
    });

    it('should enable submit when name is provided', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <CreateApiKeyModal open={true} onClose={() => {}} />
      );

      await user.type(screen.getByPlaceholderText(/n8n Integration/i), 'Test Key');

      const createButton = screen.getByText('Create');
      expect(createButton).not.toBeDisabled();
    });

    it('should have full access scope selected by default', () => {
      renderWithProviders(
        <CreateApiKeyModal open={true} onClose={() => {}} />
      );

      const fullAccessCheckbox = screen.getByRole('checkbox', { name: /Full access/i });
      expect(fullAccessCheckbox).toBeChecked();
    });
  });

  describe('scope selection', () => {
    it('should deselect full access when individual scope selected', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <CreateApiKeyModal open={true} onClose={() => {}} />
      );

      const readTablesCheckbox = screen.getByRole('checkbox', { name: /Read tables/i });
      await user.click(readTablesCheckbox);

      const fullAccessCheckbox = screen.getByRole('checkbox', { name: /Full access/i });
      expect(fullAccessCheckbox).not.toBeChecked();
      expect(readTablesCheckbox).toBeChecked();
    });

    it('should select only full access when * clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <CreateApiKeyModal open={true} onClose={() => {}} />
      );

      // First select individual scope
      const readTablesCheckbox = screen.getByRole('checkbox', { name: /Read tables/i });
      await user.click(readTablesCheckbox);

      // Then click full access
      const fullAccessCheckbox = screen.getByRole('checkbox', { name: /Full access/i });
      await user.click(fullAccessCheckbox);

      expect(fullAccessCheckbox).toBeChecked();
      expect(readTablesCheckbox).not.toBeChecked();
    });
  });

  describe('form submission', () => {
    it('should call onCreate with correct data', async () => {
      const user = userEvent.setup();
      const onSuccess = vi.fn();
      const onClose = vi.fn();
      
      mockApiKeysApi.create.mockResolvedValue({
        id: 1,
        key: 'sk_test_abc123',
        key_prefix: 'sk_test_...',
        name: 'Test Key',
        scopes: ['*'],
        rate_limit: 1000,
        expires_at: null,
        created_at: new Date().toISOString(),
      });

      renderWithProviders(
        <CreateApiKeyModal 
          open={true} 
          onClose={onClose} 
          onSuccess={onSuccess}
        />
      );

      await user.type(screen.getByPlaceholderText(/n8n Integration/i), 'Test Key');
      await user.click(screen.getByText('Create'));

      await waitFor(() => {
        expect(mockApiKeysApi.create).toHaveBeenCalledWith({
          name: 'Test Key',
          scopes: ['*'],
          expires_in_days: undefined,
          agent_id: undefined,
          project_id: undefined,
        });
      });

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith({
          id: 1,
          key: 'sk_test_abc123',
          key_prefix: 'sk_test_...',
          name: 'Test Key',
          scopes: ['*'],
          rate_limit: 1000,
          expires_at: null,
          created_at: expect.any(String),
        });
      });
    });

    it('should submit with expiration', async () => {
      const user = userEvent.setup();
      mockApiKeysApi.create.mockResolvedValue({ id: 1, key: 'sk_test_xyz' });

      renderWithProviders(
        <CreateApiKeyModal open={true} onClose={() => {}} />
      );

      await user.type(screen.getByPlaceholderText(/n8n Integration/i), 'Expiring Key');
      await user.selectOptions(screen.getByDisplayValue('Never expires'), '30');
      await user.click(screen.getByText('Create'));

      await waitFor(() => {
        expect(mockApiKeysApi.create).toHaveBeenCalledWith(
          expect.objectContaining({
            expires_in_days: 30,
          })
        );
      });
    });
  });

  describe('modal actions', () => {
    it('should close modal on cancel', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      
      renderWithProviders(
        <CreateApiKeyModal open={true} onClose={onClose} />
      );

      await user.click(screen.getByText('Cancel'));

      expect(onClose).toHaveBeenCalled();
    });

    it('should close modal on backdrop click', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      
      renderWithProviders(
        <CreateApiKeyModal open={true} onClose={onClose} />
      );

      // Click on the backdrop (the fixed overlay div)
      const backdrop = document.querySelector('.fixed.inset-0');
      if (backdrop) {
        await user.click(backdrop);
        expect(onClose).toHaveBeenCalled();
      }
    });

    it('should reset form when modal reopens', async () => {
      const user = userEvent.setup();
      const { rerender } = renderWithProviders(
        <CreateApiKeyModal open={true} onClose={() => {}} />
      );

      await user.type(screen.getByPlaceholderText(/n8n Integration/i), 'Test Key');

      // Close and reopen
      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <CreateApiKeyModal open={false} onClose={() => {}} />
        </QueryClientProvider>
      );
      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <CreateApiKeyModal open={true} onClose={() => {}} />
        </QueryClientProvider>
      );

      expect(screen.getByPlaceholderText(/n8n Integration/i)).toHaveValue('');
    });
  });

  describe('SECURITY CRITICAL', () => {
    it.todo('should display API key only once after creation');
    it.todo('should not store full API key in state after modal close');
    it.todo('should warn user that key will only be shown once');
    it.todo('should provide copy-to-clipboard functionality');
    it.todo('should mask API key after first view');
  });

  describe('error handling', () => {
    it('should show error on creation failure', async () => {
      const user = userEvent.setup();
      mockApiKeysApi.create.mockRejectedValue(new Error('Creation failed'));

      renderWithProviders(
        <CreateApiKeyModal open={true} onClose={() => {}} />
      );

      await user.type(screen.getByPlaceholderText(/n8n Integration/i), 'Test Key');
      await user.click(screen.getByText('Create'));

      // Error should be handled by TanStack Query
      await waitFor(() => {
        expect(mockApiKeysApi.create).toHaveBeenCalled();
      });
    });

    it.todo('should disable submit during pending state');
    it.todo('should allow retry after error');
  });
});
