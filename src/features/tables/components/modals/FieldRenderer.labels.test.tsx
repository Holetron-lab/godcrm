import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FieldRenderer } from './FieldRenderer';
import { AddRowModal } from './AddRowModal';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
vi.mock('../../hooks/useFormConfig', () => ({ useFormConfig: () => ({ data: null }), useSaveFormConfig: () => ({ mutate: vi.fn() }) }));
import type { ColumnModel } from '../../types/table.types';
describe('form field labels', () => {
  it.each(['number', 'date', 'select', 'text'] as const)('associates %s controls with their labels', type => {
    const column: ColumnModel = { id: '1', tableId: '5', name: 'value', displayName: 'Поле', type, config: {}, isVisible: true, isReadonly: false, isRequired: false, orderIndex: 0, width: 150 };
    render(<QueryClientProvider client={new QueryClient()}><FieldRenderer column={column} value="" onChange={() => undefined} /></QueryClientProvider>);
    expect(screen.getByLabelText('Поле')).toBeInTheDocument();
  });
});

it('keeps an accessible required label in the real create form', () => {
  const column: ColumnModel = { id: '1', tableId: '5', name: 'order', displayName: 'Заказ', type: 'text', config: {}, isVisible: true, isReadonly: false, isRequired: true, orderIndex: 0, width: 150 };
  render(<QueryClientProvider client={new QueryClient()}><LanguageProvider><AddRowModal isOpen onClose={() => undefined} onConfirm={() => undefined} columns={[column]} tableId="5" /></LanguageProvider></QueryClientProvider>);
  expect(screen.getByLabelText(/^Заказ/)).toHaveAttribute('aria-required', 'true');
});
