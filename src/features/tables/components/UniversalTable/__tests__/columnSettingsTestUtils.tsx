import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnModel } from '@/features/tables/types/table.types';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';

// =============================================================================
// CUSTOM QUERY HELPERS (since Input component has label without htmlFor in some cases)
// =============================================================================

export const getInputByLabel = (labelText: string): HTMLInputElement => {
  const label = screen.getByText(labelText);
  const container = label.closest('div.flex.w-full.flex-col') || label.closest('div');
  if (!container) throw new Error(`Container for label "${labelText}" not found`);
  const input = container.querySelector('input');
  if (!input) throw new Error(`Input for label "${labelText}" not found`);
  return input as HTMLInputElement;
};

export const queryInputByLabel = (labelText: string): HTMLInputElement | null => {
  try {
    return getInputByLabel(labelText);
  } catch {
    return null;
  }
};

export const getSwitchByLabel = (labelText: string): HTMLButtonElement => {
  const label = screen.getByText(labelText);
  const container = label.closest('div.flex.items-center');
  if (!container) throw new Error(`Container for switch label "${labelText}" not found`);
  const button = container.querySelector('button[role="switch"]');
  if (!button) throw new Error(`Switch button for label "${labelText}" not found`);
  return button as HTMLButtonElement;
};

// =============================================================================
// TEST FIXTURES
// =============================================================================

export const createMockColumn = (overrides: Partial<ColumnModel> = {}): ColumnModel => ({
  id: 'col-1',
  tableId: 'table-1',
  name: 'email',
  displayName: 'Email',
  type: 'email',
  config: {
    appearance: { align: 'left', indicator: { type: 'emoji', value: '📧' } }
  },
  isRequired: false,
  isReadonly: false,
  orderIndex: 0,
  width: 150,
  isVisible: true,
  is_from_source: false,
  is_locked: false,
  is_primary_key: false,
  ...overrides
});

export const createExternalColumn = (overrides: Partial<ColumnModel> = {}): ColumnModel =>
  createMockColumn({
    id: 'col-external',
    name: 'external_status',
    displayName: 'External Status',
    type: 'text',
    is_from_source: true,
    is_locked: false,
    ...overrides
  });

export const createLockedColumn = (overrides: Partial<ColumnModel> = {}): ColumnModel =>
  createMockColumn({
    id: 'col-locked',
    name: 'primary_id',
    displayName: 'Primary ID',
    type: 'text',
    is_from_source: true,
    is_locked: true,
    is_primary_key: true,
    ...overrides
  });

export const createSelectColumn = (overrides: Partial<ColumnModel> = {}): ColumnModel =>
  createMockColumn({
    id: 'col-select',
    name: 'status',
    displayName: 'Status',
    type: 'select',
    config: {
      options: [
        { label: 'Active', value: 'active', color: '#22c55e' },
        { label: 'Inactive', value: 'inactive', color: '#ef4444' }
      ],
      appearance: { align: 'left' }
    },
    ...overrides
  });

// =============================================================================
// TEST UTILITIES
// =============================================================================

export const renderWithProviders = (ui: React.ReactNode): RenderResult => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        {ui}
      </LanguageProvider>
    </QueryClientProvider>
  );
};

export const openTab = async (tabName: string) => {
  const tab = screen.getByRole('button', { name: tabName });
  await userEvent.click(tab);
};

// =============================================================================
// TAB NAMES (English - fallback language)
// =============================================================================
export const TABS = {
  COLUMN: 'Column',
  SOURCE: 'Data Source',
  TYPE: 'Type',
  CELL: 'Cell',
  SUMMARY: 'Summary',
  BACKLINK: 'Back Link',
  AUTOMATION: 'Automation',
  ACCESS: 'Access'
};
