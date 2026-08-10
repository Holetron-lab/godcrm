import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock hooks and API
vi.mock('../api/projectsApi', () => ({
  projectsApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/shared/i18n/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en' }),
}));

const renderWithProviders = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
};

describe('CreateProjectModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it.todo('should render modal');
    it.todo('should show name input');
    it.todo('should show description input');
    it.todo('should show icon selector');
    it.todo('should show space selector');
  });

  describe('validation', () => {
    it.todo('should require project name');
    it.todo('should validate name length');
    it.todo('should show error messages');
  });

  describe('creation', () => {
    it.todo('should create project on submit');
    it.todo('should close modal on success');
    it.todo('should show loading state');
    it.todo('should handle errors');
  });
});

describe('EditProjectModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it.todo('should prefill form with project data');
    it.todo('should show current icon');
    it.todo('should show current theme');
  });

  describe('editing', () => {
    it.todo('should update project on submit');
    it.todo('should handle partial updates');
  });
});

describe('DeleteProjectModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('confirmation', () => {
    it.todo('should show project name in warning');
    it.todo('should require typing project name to confirm');
    it.todo('should disable delete until confirmed');
  });

  describe('deletion', () => {
    it.todo('should delete project on confirm');
    it.todo('should close modal on success');
    it.todo('should handle errors');
  });
});
