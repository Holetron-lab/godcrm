// ADR-207 W4.2 — catalog helpers: registry request, one card per module, filters in the URL.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/shared/utils/apiClient';
import { moduleCatalog } from '@/shared/i18n/modules/moduleCatalog';
import { fetchModuleCatalog } from '../api';
import { NO_FILTERS, latestVersions, readFilters, writeFilters } from '../catalog';
import { kanban, modules } from './fixtures';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { request: vi.fn() } }));

beforeEach(() => {
  vi.mocked(apiClient.request).mockReset().mockResolvedValue({ success: true, data: { items: modules } });
});

describe('fetchModuleCatalog', () => {
  it('asks for the whole catalog of the space when no filter is set', async () => {
    await expect(fetchModuleCatalog(11, NO_FILTERS)).resolves.toEqual(modules);
    expect(apiClient.request).toHaveBeenCalledWith('/module-registry?space_id=11');
  });

  it('sends every filter at once', async () => {
    await fetchModuleCatalog(11, { origin: 'internal', components: ['table', 'agent'], category: 'support', canInstall: true, search: '  sla ' });
    const [path] = vi.mocked(apiClient.request).mock.calls[0];
    expect(Object.fromEntries(new URLSearchParams(path.split('?')[1]))).toEqual({
      space_id: '11', origin: 'internal', components: 'table,agent', category: 'support', can_install: 'true', search: 'sla',
    });
  });
});

describe('latestVersions', () => {
  it('keeps the newest version of a module per origin, comparing versions as numbers', () => {
    const older = { ...kanban, id: 10, version: '2.9.0' };
    const newer = { ...kanban, id: 11, version: '2.10.0' };
    const published = { ...kanban, id: 12, origin: 'internal' as const, version: '1.0.0' };
    expect(latestVersions([older, newer, published]).map(module => module.id)).toEqual([11, 12]);
  });
});

describe('filters in the URL', () => {
  it('round-trips the filters and leaves other parameters alone', () => {
    const filters = { origin: 'external' as const, components: ['app' as const, 'tile' as const], category: 'support', canInstall: true, search: 'board' };
    const params = writeFilters(new URLSearchParams('tableId=7'), filters);
    expect(params.get('tableId')).toBe('7');
    expect(readFilters(params)).toEqual(filters);
    expect(writeFilters(params, NO_FILTERS).toString()).toBe('tableId=7');
  });

  it('ignores values the catalog does not know', () => {
    expect(readFilters(new URLSearchParams('origin=market&components=app,widget'))).toEqual({ ...NO_FILTERS, components: ['app'] });
  });
});

describe('terminology (§2.1)', () => {
  it('never names "widget" as a type in the catalog copy', () => {
    expect(JSON.stringify(moduleCatalog)).not.toMatch(/widget|виджет/i);
  });
});
