import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SelectionContainer } from '@/features/tables/components/UniversalTable/SelectionContainer';
import { DateEditor } from '@/features/tables/components/cells/DateEditor';
import { FieldRenderer } from '@/features/tables/components/modals/FieldRenderer';
import { RateLimitSettings } from '@/pages/settings/components/RateLimitSettings';
import type { ColumnModel } from '@/features/tables/types/table.types';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  user: { role: 'member' },
}));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { request: mocks.request } }));
vi.mock('@/features/auth/store/authStore', () => ({
  useAuthStore: (selector: (state: { user: { role: string } }) => unknown) => selector({ user: mocks.user }),
}));
vi.mock('@/shared/i18n/LanguageContext', () => ({
  useLanguage: () => ({ language: 'ru', t: (key: string) => key }),
}));
vi.mock('@/features/tables/components/modals/FileUploaderField', () => ({ FileUploaderField: () => null }));

function withQueries({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mocks.request.mockReset();
  mocks.user = { role: 'member' };
});

describe('Hook order across conditional views', () => {
  it('preserves selection controls when selection is added, cleared, and added again', () => {
    const props = {
      selectedCount: 0, selectionSort: 'default' as const,
      onSortChange: vi.fn(), onClearSelection: vi.fn(), onSelectAllFiltered: vi.fn(),
      totalCount: 2, filteredCount: 2,
    };
    const { rerender } = render(<SelectionContainer {...props} />);
    expect(screen.queryByTestId('selection-container')).not.toBeInTheDocument();
    rerender(<SelectionContainer {...props} selectedCount={1} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText(/Снять выделение/));
    expect(props.onClearSelection).toHaveBeenCalledOnce();
    rerender(<SelectionContainer {...props} />);
    rerender(<SelectionContainer {...props} selectedCount={2} />);
    expect(screen.getByTestId('selection-container')).toBeInTheDocument();
  });

  it('changes date modes without retaining the calendar keyboard handler', () => {
    const props = { value: '2026-09-14', onChange: vi.fn(), onCommit: vi.fn(), onCancel: vi.fn() };
    const { rerender } = render(<DateEditor {...props} mode="date" />);
    rerender(<DateEditor {...props} mode="month" />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onCancel).toHaveBeenCalledOnce();
    expect(props.onCommit).not.toHaveBeenCalled();
    rerender(<DateEditor {...props} mode="date" />);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(props.onCommit).toHaveBeenCalledOnce();
  });

  it('loads relation options only for select fields when the column type changes', async () => {
    mocks.request.mockResolvedValue({ data: { rows: [{ id: 1, data: { title: 'First' } }] } });
    const column: ColumnModel = {
      id: 'choice', tableId: '123', name: 'choice', displayName: 'Choice', type: 'text',
      isRequired: false, isReadonly: false, orderIndex: 0, width: 120, isVisible: true,
      config: { relation: { enabled: true, tableId: '123', valueColumn: 'id', labelColumn: 'title' } },
    };
    const props = { column, value: '', onChange: vi.fn() };
    const { rerender } = render(<FieldRenderer {...props} />, { wrapper: withQueries });
    expect(mocks.request).not.toHaveBeenCalled();
    rerender(<FieldRenderer {...props} column={{ ...column, type: 'select' }} />);
    expect(await screen.findByRole('option', { name: 'First' })).toHaveValue('1');
    rerender(<FieldRenderer {...props} column={{ ...column, type: 'multi-select' }} />);
    expect(screen.getByText('First')).toBeInTheDocument();
    rerender(<FieldRenderer {...props} column={{ ...column, type: 'relation' }} />);
    expect(await screen.findByRole('option', { name: 'First' })).toHaveValue('1');
    rerender(<FieldRenderer {...props} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('does not request owner settings until the user becomes an owner', async () => {
    mocks.request.mockResolvedValue({ data: { auth_max_attempts: 10, auth_window_minutes: 15, global_max_requests: 1000, global_window_minutes: 15 } });
    const { rerender, container } = render(<RateLimitSettings />, { wrapper: withQueries });
    expect(container).toBeEmptyDOMElement();
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.user = { role: 'owner' };
    rerender(<RateLimitSettings />);
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('/system/rate-limit-config'));
    expect(await screen.findByText('Rate Limiting')).toBeInTheDocument();
    mocks.user = { role: 'member' };
    rerender(<RateLimitSettings />);
    expect(container).toBeEmptyDOMElement();
  });
});
