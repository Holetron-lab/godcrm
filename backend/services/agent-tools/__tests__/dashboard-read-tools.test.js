// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbAll = vi.fn();
const dbGet = vi.fn();
const dbRun = vi.fn();

vi.mock('../../../database/connection.js', () => ({
  dbAll: (...args) => dbAll(...args),
  dbGet: (...args) => dbGet(...args),
  dbRun: (...args) => dbRun(...args),
  sqlNow: () => 'CURRENT_TIMESTAMP',
}));
vi.mock('../data-tools.js', () => ({ parseRowData: JSON.parse }));
vi.mock('../../DashboardService.js', () => ({ createDashboard: vi.fn() }));
vi.mock('../../WidgetService.js', () => ({ createWidget: vi.fn() }));
vi.mock('../../audit/writeAudit.js', () => ({ writeAudit: vi.fn() }));

const { dashboardToolHandlers } = await import('../dashboard-tools.js');
const { buildToolList } = await import('../../mcp/buildToolList.js');
const { AUDIT_EXEMPT_TOOLS } = await import('../../audit/toolAudit.js');

beforeEach(() => {
  dbAll.mockReset();
  dbGet.mockReset();
  dbRun.mockReset();
});

describe('dashboard read tools', () => {
  it('lists dashboards with their parent IDs', async () => {
    dbAll.mockResolvedValueOnce([
      { id: 26, name: 'Delivery', project_id: 8406, space_id: null, is_default: 1 },
    ]);

    const result = await dashboardToolHandlers.list_dashboards({});

    expect(result).toEqual({
      dashboards: [expect.objectContaining({ id: 26, project_id: 8406, space_id: null })],
      total: 1,
    });
    expect(dbAll.mock.calls[0][0]).toContain('FROM dashboards d');
    expect(dbAll.mock.calls[0][1]).toEqual([]);
  });

  it('filters dashboards by project', async () => {
    dbAll.mockResolvedValueOnce([]);

    await dashboardToolHandlers.list_dashboards({ project_id: 8406 });

    expect(dbAll.mock.calls[0][0]).toContain('WHERE d.project_id = ?');
    expect(dbAll.mock.calls[0][1]).toEqual([8406]);
  });

  it('includes project dashboards when filtering by space', async () => {
    dbAll.mockResolvedValueOnce([]);

    await dashboardToolHandlers.list_dashboards({ space_id: 7819 });

    expect(dbAll.mock.calls[0][0]).toContain('(d.space_id = ? OR p.space_id = ?)');
    expect(dbAll.mock.calls[0][1]).toEqual([7819, 7819]);
  });

  it('rejects simultaneous project and space filters', async () => {
    const result = await dashboardToolHandlers.list_dashboards({ project_id: 1, space_id: 2 });

    expect(result).toEqual({ error: 'Pass either project_id or space_id, not both' });
    expect(dbAll).not.toHaveBeenCalled();
  });

  it('gets a dashboard by ID including its project parent', async () => {
    dbGet.mockResolvedValueOnce({ id: 26, name: 'Delivery', project_id: 8406, space_id: null });

    const result = await dashboardToolHandlers.get_dashboard({ dashboard_id: 26 });

    expect(result).toEqual({
      dashboard: expect.objectContaining({ id: 26, project_id: 8406 }),
    });
    expect(dbGet).toHaveBeenCalledWith(expect.stringContaining('FROM dashboards d'), [26]);
  });

  it('returns a structured not-found error', async () => {
    dbGet.mockResolvedValueOnce(null);

    expect(await dashboardToolHandlers.get_dashboard({ dashboard_id: 999999 })).toEqual({
      error: 'Dashboard 999999 not found',
    });
  });

  it('advertises both read-only tools through MCP and exempts them from mutation audit', () => {
    const tools = buildToolList();
    const list = tools.find(tool => tool.name === 'list_dashboards');
    const get = tools.find(tool => tool.name === 'get_dashboard');

    expect(list?.inputSchema.properties).toHaveProperty('project_id');
    expect(list?.inputSchema.properties).toHaveProperty('space_id');
    expect(get?.inputSchema.required).toEqual(['dashboard_id']);
    expect(AUDIT_EXEMPT_TOOLS).toContain('list_dashboards');
    expect(AUDIT_EXEMPT_TOOLS).toContain('get_dashboard');
  });
});
