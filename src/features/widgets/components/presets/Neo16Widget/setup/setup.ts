import { apiClient } from '@/shared/utils/apiClient';
import { projectsApi } from '@/features/projects/api/projectsApi';
import { spacesApi } from '@/features/spaces/api/spacesApi';
import { call } from '../learning/transport';

interface PlannedTable {
  name: string;
  action: string;
  columns_added: string[];
}

export interface SetupPlan {
  dry_run: boolean;
  plan: {
    tables: PlannedTable[];
    seed: Array<{ table: string; insert: number; existing: number }>;
    widgets: Array<{ widget_id: number; dashboard_id: number; action: string }>;
    conflicts: unknown[];
  };
  npc_agents: {
    tables: PlannedTable[];
    operator: { action: string; provider: string };
    agents: Array<{ npc_key: string; action: string }>;
  };
}

export async function loadSetupContext(dashboardId: number) {
  const [dashboard, projects, spaces] = await Promise.all([
    apiClient.get<{ data: { space_id: number | null; project_id: number | null } }>(`/dashboards/${dashboardId}`),
    projectsApi.list(),
    spacesApi.list(),
  ]);
  const project = projects.find((item) => item.id === dashboard.data.project_id);
  const spaceId = dashboard.data.space_id ?? project?.space_id;
  const space = spaces.find((item) => item.id === spaceId);
  if (!space) throw new Error('Не удалось определить пространство виджета. Проверьте доступ.');
  return {
    isOwner: space.user_access_level === 'owner_owner' || space.user_access_level === 'owner',
    projectId: dashboard.data.project_id,
    projects: projects.filter((item) => item.space_id === space.id),
  };
}

export async function installNeo16(widgetId: number, projectId: number, dryRun: boolean) {
  return (await call<SetupPlan>('POST', `/widgets/${widgetId}/install`, {
    data: { project_id: projectId, dry_run: dryRun },
  })).body;
}
