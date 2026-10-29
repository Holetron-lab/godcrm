import { apiClient } from '@/shared/utils/apiClient';

/** Server-side maximum for GET /ai/agents and /ai/agents/:spaceId. */
const PAGE_SIZE = 200;

/**
 * The agents endpoints page at 50 by default and cap at 200. Walk every page so
 * a space with more agents than one page never shows a truncated directory.
 */
export async function fetchAllAgents<T>(path: string): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const separator = path.includes('?') ? '&' : '?';
    const response = await apiClient.get<{ success: boolean; data: { agents: T[]; total: number } }>(
      `${path}${separator}limit=${PAGE_SIZE}&offset=${offset}`
    );
    if (!response.success) throw new Error('Unable to load agents');
    const page = response.data?.agents ?? [];
    result.push(...page);
    if (!page.length || result.length >= response.data.total) return result;
  }
}
