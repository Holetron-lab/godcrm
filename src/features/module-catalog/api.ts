import { filesApi } from '@/features/files/api/filesApi';
import { apiClient } from '@/shared/utils/apiClient';
import { latestVersions } from './catalog';
import type { CatalogFilters, CatalogModule, ModuleMedia, ModuleMetaPatch } from './types';

/** `PATCH /module-registry/:key` — publisher-space owners edit internal modules; platform owners edit defaults. */
export async function updateModuleMeta(spaceId: number, module: CatalogModule, patch: ModuleMetaPatch): Promise<void> {
  await apiClient.patch(`/module-registry/${module.key}`, { space_id: spaceId, version: module.version, blueprint: patch });
}

/**
 * Uploads screenshots and videos of the module page as internal files — any logged-in user may browse
 * the catalog — and turns them into gallery items captioned by the file name.
 */
export async function uploadModuleMedia(files: File[]): Promise<ModuleMedia[]> {
  const result = await filesApi.upload(files, { visibility: 'internal' });
  return (Array.isArray(result) ? result : [result]).map(file => ({
    type: (file.mimeType || file.mime_type || '').startsWith('video/') ? 'video' : 'image',
    url: file.url,
    title: (file.originalName || file.original_name || file.name).replace(/\.[^.]+$/, '') || undefined,
  }));
}

/** `GET /module-registry` — the catalog of a space, filtered by the server. */
export async function fetchModuleCatalog(spaceId: number, filters: CatalogFilters): Promise<CatalogModule[]> {
  const query = new URLSearchParams({ space_id: String(spaceId) });
  if (filters.origin) query.set('origin', filters.origin);
  if (filters.components.length) query.set('components', filters.components.join(','));
  if (filters.category) query.set('category', filters.category);
  if (filters.canInstall) query.set('can_install', 'true');
  if (filters.search.trim()) query.set('search', filters.search.trim());
  const response = await apiClient.request<{ data: { items: CatalogModule[] } }>(`/module-registry?${query}`);
  return latestVersions(response.data.items);
}

/** The query every catalog screen shares: the same key for the same space and filters, idle until the space is known. */
export function moduleCatalogQuery(spaceId: number | undefined, filters: CatalogFilters) {
  return {
    queryKey: ['module-catalog', spaceId, filters] as const,
    queryFn: () => fetchModuleCatalog(spaceId as number, filters),
    enabled: spaceId != null,
  };
}
