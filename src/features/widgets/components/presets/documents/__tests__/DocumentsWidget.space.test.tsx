import type { ComponentProps } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Widget } from '../../../../types/widget.types';
import type { DocumentsProviderProps } from '../context/types';
import { DocumentsWidget } from '..';

const { request, get } = vi.hoisted(() => ({ request: vi.fn(), get: vi.fn() }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { request, get } }));
// Probe the provider boundary with the real variables hook: verify the endpoint,
// including the public/unknown-space cases, without unrelated document fixtures.
vi.mock('../DocumentsContext', async () => {
  const { useSystemVariables } = await import('@/shared/hooks/useSystemVariables');
  return {
    DocumentsProvider: ({ spaceId }: DocumentsProviderProps) => {
      useSystemVariables({ spaceId, includeSpaceVars: true });
      return <output aria-label="Space">{spaceId}</output>;
    },
    useDocumentsContext: vi.fn(),
  };
});

const widget: Widget = {
  id: 218, dashboard_id: 1, project_id: 138, config: { project_id: 138, id: 218 },
  source_widget_id: null, widget_type: 'preset', preset_name: 'documents',
  code: null, code_version: 0, title: 'Documents', description: null, icon: '',
  position: { x: 0, y: 0, w: 12, h: 8 }, is_visible: true, is_module: true,
  order_index: 0, created_by: null, created_at: '', updated_at: '',
  module_id: null, sidebar_order: null, sidebar_icon: null, access_level: null, is_pinned: null,
};
function mount(props: ComponentProps<typeof DocumentsWidget>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><DocumentsWidget {...props} /></QueryClientProvider>);
  return { ...view, client };
}
beforeEach(() => {
  request.mockReset().mockResolvedValue({ data: { ...widget, space_id: 11 } });
  get.mockReset().mockResolvedValue({ variables: [], computed: {}, computed_at: null });
});
afterEach(cleanup);

it('uses the joined residence space for a standalone widget', async () => {
  mount({ widget: { ...widget, space_id: 11 } });
  await waitFor(() => expect(get).toHaveBeenCalledWith('/spaces/11/variables'));
  expect(request).not.toHaveBeenCalled();
});

it('resolves dashboard/embedded metadata without treating config.project_id as a space', async () => {
  mount({ widget });
  await waitFor(() => expect(get).toHaveBeenCalledWith('/spaces/11/variables'));
  expect(request).toHaveBeenCalledWith('/widgets/218');
  expect(get.mock.calls.map(([url]) => url)).toEqual(['/spaces/11/variables']);
});

it('keeps explicit config-only space context separate from the project', async () => {
  mount({ config: { project_id: 138 }, spaceId: '11' });
  await waitFor(() => expect(get).toHaveBeenCalledWith('/spaces/11/variables'));
  expect(request).not.toHaveBeenCalled();
});

it.each([0, 11])('never fetches private metadata or variables in public mode (space %s)', async spaceId => {
  mount({ widget, dataSource: 'public', publicSlug: 'docs', widgetId: 218, spaceId });
  expect(screen.getByLabelText('Space')).toHaveTextContent(/^0$/);
  expect(request).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
});

it('does not guess a space while metadata is pending', () => {
  request.mockReturnValue(new Promise(() => {}));
  mount({ widget });
  expect(screen.getByLabelText('Space')).toHaveTextContent(/^0$/);
  expect(get).not.toHaveBeenCalled();
});

it.each([null, 'denied'])('does not fall back to a project when residence is %s', async result => {
  if (result === 'denied') request.mockRejectedValue(new Error('Forbidden'));
  else request.mockResolvedValue({ data: { ...widget, space_id: null } });
  const { client } = mount({ widget });
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.getByLabelText('Space')).toHaveTextContent(/^0$/);
  expect(get).not.toHaveBeenCalled();
});

it('does not invent a space or fetch a widget for project-only config', () => {
  mount({ config: { project_id: 138 } });
  expect(screen.getByLabelText('Space')).toHaveTextContent(/^0$/);
  expect(request).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
});
