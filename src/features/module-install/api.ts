import { apiClient } from '@/shared/utils/apiClient';
import type { InstallBindings, InstallResult, ModuleBlueprint } from './types';

export interface InstallRequest {
  blueprint: ModuleBlueprint;
  spaceId: number;
  /** The route requires a project of the space even when `bindings.projects` places the module elsewhere. */
  projectId: number;
  bindings: InstallBindings;
  dryRun: boolean;
}

/** `POST /modules/install` — with `dry_run` it returns the plan and writes nothing. */
export async function requestInstall({ blueprint, spaceId, projectId, bindings, dryRun }: InstallRequest): Promise<InstallResult> {
  const response = await apiClient.post<{ data: InstallResult }>('/modules/install', {
    blueprint,
    space_id: spaceId,
    project_id: projectId,
    dry_run: dryRun,
    bindings,
  });
  return response.data;
}
