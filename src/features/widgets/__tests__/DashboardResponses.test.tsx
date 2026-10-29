import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import type { Widget } from '../types/widget.types';
import { PesDashboardWidget } from '../components/presets/PesDashboardWidget';
import { AutopilotDashboardWidget } from '../components/presets/AutopilotDashboardWidget';

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => ({ isLoading: true })),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({}),
}));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn() } }));
const widget: Widget = {
  id: 1, dashboard_id: 1, source_widget_id: null, widget_type: 'preset',
  preset_name: 'calendar_widget', code: null, code_version: 1, title: 'Calendar',
  description: null, icon: '', config: { calendar: { tableId: '42', dateColumn: 'date', titleColumn: 'title' } },
  position: { x: 0, y: 0, w: 4, h: 4 }, is_visible: true, is_module: false,
  order_index: 0, created_by: null, created_at: '', updated_at: '', module_id: null,
  sidebar_order: null, sidebar_icon: null, access_level: null, is_pinned: null,
};

describe('dashboard response envelopes', () => {
  it.each([
    [PesDashboardWidget, '/api/v3/pes/status'],
    [AutopilotDashboardWidget, '/api/v3/ai/autopilot/dashboard'],
  ] as const)('extracts the data returned by %s', async (Component, endpoint) => {
    const payload = { marker: 'server payload' };
    vi.mocked(apiClient.get).mockResolvedValue({ success: true, data: payload });
    render(<Component widget={widget} data={[]} />);
    const options = vi.mocked(useQuery).mock.lastCall?.[0];
    if (typeof options?.queryFn !== 'function') throw new Error('Missing query function');
    // Invoke the captured request without coupling this check to dashboard markup.
    const request = options.queryFn as () => Promise<unknown>;
    await expect(request()).resolves.toEqual(payload);
    expect(apiClient.get).toHaveBeenLastCalledWith(endpoint);
  });
});
