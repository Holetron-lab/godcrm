import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock hooks
vi.mock('../api/useWebhooks', () => ({
  useWebhooks: vi.fn(() => ({
    data: [],
    isLoading: false,
    error: null,
  })),
  useCreateWebhook: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useUpdateWebhook: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useDeleteWebhook: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useWebhookLogs: vi.fn(() => ({
    data: [],
    isLoading: false,
  })),
}));

vi.mock('@/shared/i18n/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en' }),
}));

vi.mock('@/features/projects/hooks/useProjectTables', () => ({
  useProjectTables: vi.fn(() => ({ data: [], isLoading: false })),
}));

vi.mock('@/shared/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const renderWithProviders = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{ui}</BrowserRouter>
    </QueryClientProvider>
  );
};

describe('WebhooksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it.todo('should render webhooks list');
    it.todo('should render empty state when no webhooks');
    it.todo('should show loading skeleton while fetching');
    it.todo('should display webhook name and URL');
    it.todo('should show active/inactive badge');
    it.todo('should display last triggered time');
    it.todo('should show total calls count');
  });

  describe('create webhook', () => {
    it.todo('should open create modal on button click');
    it.todo('should allow creating with new table');
    it.todo('should allow creating with existing table');
    it.todo('should validate webhook name');
    it.todo('should close modal after creation');
  });

  describe('webhook URL', () => {
    it.todo('should display full webhook URL');
    it.todo('should copy URL to clipboard');
    it.todo('should show copy success feedback');
    it.todo('should open URL in new tab');
  });

  describe('webhook settings', () => {
    it.todo('should toggle auto create columns');
    it.todo('should toggle flatten payload');
    it.todo('should toggle active state');
  });

  describe('delete webhook', () => {
    it.todo('should show confirmation dialog');
    it.todo('should delete webhook on confirm');
    it.todo('should cancel on dismiss');
  });

  describe('logs section', () => {
    it.todo('should expand log section');
    it.todo('should display recent logs');
    it.todo('should show log status icons');
    it.todo('should show log payload on expand');
    it.todo('should show error messages');
    it.todo('should link to created row');
  });

  describe('test webhook', () => {
    it.todo('should trigger test request');
    it.todo('should show test result');
    it.todo('should display sample payload');
  });
});

describe('CreateWebhookModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('form validation', () => {
    it.todo('should require webhook name');
    it.todo('should require table selection');
    it.todo('should validate new table name');
  });

  describe('table options', () => {
    it.todo('should toggle between new and existing table');
    it.todo('should show table selector for existing');
    it.todo('should show name input for new table');
  });
});
