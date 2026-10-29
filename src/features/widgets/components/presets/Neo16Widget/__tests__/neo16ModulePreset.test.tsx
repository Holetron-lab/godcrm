/**
 * Neo16 W1 slice 2 — entry-surface contract for the `16neo` preset after it moved
 * from core `switch` cases to the autonomous-module registry (MODULE-CONTRACT v1,
 * doc 239900 §Module Integration).
 *
 * Lives inside the module directory (`owns_dirs`) so it leaves with the module —
 * the removal invariant keeps `tsc`/vitest green with no core test naming `16neo`.
 *
 * Existing `16neo` widget rows on the masters have `config: {}`; they must keep
 * rendering through the registry fallback on BOTH render paths (dashboard card and
 * the full-page `/widgets/:id` route) with no core edit.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Gamepad2 } from 'lucide-react';
import { WidgetRenderer } from '@/features/widgets/components/WidgetRenderer';
import { WidgetViewPage } from '@/pages/widgets/WidgetViewPage';
import { getModulePresetIcons, getWidgetPreset } from '@/features/widgets/registry/modulePresetRegistry';
import { WIDGET_PRESETS } from '@/features/widgets/config/widget-presets.config';
import type { Widget } from '@/features/widgets/types/widget.types';

const legacyRow: Widget = {
  id: 1,
  dashboard_id: 1,
  source_widget_id: null,
  code: null,
  code_version: 1,
  description: null,
  is_module: false,
  module_id: null,
  sidebar_order: null,
  sidebar_icon: null,
  access_level: null,
  is_pinned: null,
  widget_type: 'preset',
  preset_name: '16neo',
  title: '16Neo',
  icon: '🎮',
  config: {},
  position: { x: 0, y: 0, w: 12, h: 8 },
  is_visible: true,
  order_index: 0,
  created_by: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

// Mock the component file itself so the registrar's import is what gets replaced.
vi.mock('@/features/widgets/components/presets/Neo16Widget/setup/Neo16Setup', () => ({
  Neo16Setup: ({ widget }: { widget: Widget }) => (
    <output aria-label="Neo16">{JSON.stringify(widget.config)}</output>
  ),
}));
// Full-page route scaffolding: the page resolves its widget through useTicketData.
vi.mock('@/features/widgets/hooks/useTicketData', () => ({
  useTicketData: () => ({
    widget: legacyRow, widgetData: [], tableColumns: [], columnsInfo: [],
    relationData: new Map(), kanbanColumnOptions: [], refetchData: vi.fn(),
  }),
}));
vi.mock('@/features/ai-chat', () => ({
  useAIChat: () => ({ openTaskChat: vi.fn(), openChat: vi.fn(), attachRowToChat: vi.fn(), attachRowToMessage: vi.fn() }),
}));
vi.mock('@/shared/i18n/LanguageContext', () => ({
  useLanguage: () => ({ language: 'ru', t: (ru: string) => ru }),
}));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn() } }));

const withProviders = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
);

describe('16neo as an autonomous-module preset', () => {
  it('is registered through the module registry with its own icon', () => {
    expect(getWidgetPreset('16neo')).toBeDefined();
    expect(getModulePresetIcons()['16neo']).toBe(Gamepad2);
  });

  it('reaches the palette through the module fragment, not core JSON', () => {
    expect(WIDGET_PRESETS['16neo']).toMatchObject({ id: '16neo', icon: Gamepad2 });
  });

  it('renders a legacy row with empty config on the dashboard path', () => {
    render(withProviders(<WidgetRenderer widget={legacyRow} data={[]} />));
    expect(screen.getByLabelText('Neo16')).toHaveTextContent('{}');
    expect(screen.queryByText(/Unknown preset/)).not.toBeInTheDocument();
  });

  it('renders a legacy row with empty config on the full-page /widgets/:id path', () => {
    render(withProviders(<WidgetViewPage />));
    expect(screen.getByLabelText('Neo16')).toHaveTextContent('{}');
    expect(screen.queryByText(/Неизвестный тип модуля/)).not.toBeInTheDocument();
  });
});
