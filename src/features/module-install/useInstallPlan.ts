// ADR-207 §2.5–2.6 — the data of the install plan: the space tree, the dry-run plan for the current
// bindings, and the install itself. The dry-run is the only source of what InstallPlanTree shows.
// The hook is shared by the plan screen and by the module page, whose own Install button runs the install.
import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { useSpaceAccessLevel } from '@/features/spaces/hooks/useSpaceAccessLevel';
import { transformApiNodeToNavNode, type TreeApiNode } from '@/features/schema-editor/store/navTreeHelpers';
import type { NavTreeNode } from '@/features/schema-editor/types/schema-editor.types';
import type { TargetColumnLike } from '@/shared/column-mapping';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { requestInstall } from './api';
import { connectCandidate, examplesOffByDefault } from './bindings';
import type { InstallBindings, InstallPlan, InstallResult, InstallRole, ModuleBlueprint } from './types';

export interface UseInstallPlanOptions {
  blueprint: ModuleBlueprint;
  spaceId: number;
  /** Project the module goes to until the user chooses another one in the plan. */
  projectId: number;
  /** A table the user came from: the plan starts with it connected, and the dry-run judges the fit. */
  connectTable?: { id: number; name: string };
  onInstalled: (result: InstallResult) => void;
}

export interface InstallPlanState {
  blueprint: ModuleBlueprint;
  role: InstallRole;
  /** The access level is still unknown. */
  loading: boolean;
  /** This role may ask for the plan at all. */
  allowed: boolean;
  /** Sections only an administrator installs; non-empty is what refuses a member. */
  adminOnly: ('agents' | 'automations' | 'services')[];
  tree: NavTreeNode[] | undefined;
  plan: InstallPlan | undefined;
  /** Why there is no plan on screen yet, once there is nothing to wait for. */
  error: unknown;
  retry: () => void;
  bindings: InstallBindings;
  setBindings: (next: InstallBindings) => void;
  targetColumns: Record<number, TargetColumnLike[]>;
  /** A dry-run is on its way; the plan on screen is the previous one. */
  busy: boolean;
  installing: boolean;
  /** The plan has a blocking conflict. */
  blocked: boolean;
  /** The last request that failed, in words. */
  failure: string | null;
  /** What became of the table the user came from, as the plan has it. */
  linked: string | null;
  install: () => void;
}

const ADMIN_SECTIONS = ['agents', 'automations', 'services'] as const;
const NO_TABLE = ['TABLE_NOT_FOUND', 'TABLE_NOT_IN_SPACE'];

interface ColumnRow { name: string; display_name?: string | null; column_type: string }

const installRole = (level: string): InstallRole =>
  level === 'owner_owner' || level === 'owner' || level === 'admin' ? 'admin' : level === 'editor' ? 'member' : 'viewer';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function useInstallPlan({ blueprint, spaceId, projectId, connectTable, onInstalled }: UseInstallPlanOptions): InstallPlanState {
  const { t } = useLanguage();
  const access = useSpaceAccessLevel(spaceId);
  const role = installRole(access.accessLevel);
  const [bindings, setBindings] = useState<InstallBindings>(() => connectCandidate(blueprint, connectTable?.id));

  // Agents, automations and services are for administrators (§2.2 axis C): the server refuses even a
  // dry-run to anyone else, so those roles get the reason instead of a request that is bound to fail.
  const adminOnly = ADMIN_SECTIONS.filter((section) => (blueprint[section]?.length ?? 0) > 0);
  const allowed = !access.loading && (role === 'admin' || (role === 'member' && adminOnly.length === 0));

  const tree = useQuery({
    queryKey: ['module-install-tree', spaceId],
    queryFn: async () => {
      const response = await apiClient.request<{ data: TreeApiNode[] }>(`/spaces/${spaceId}/tree`);
      return response.data.map((node) => transformApiNodeToNavNode(node, null));
    },
    enabled: allowed,
  });
  const request = { blueprint, spaceId, projectId, bindings };
  const dryRun = useQuery({
    queryKey: ['module-install-plan', spaceId, projectId, blueprint.key, blueprint.version, bindings],
    queryFn: () => requestInstall({ ...request, dryRun: true }),
    enabled: allowed,
    // The previous plan stays on screen while the next one is on its way.
    placeholderData: keepPreviousData,
  });
  const install = useMutation({
    mutationFn: () => requestInstall({ ...request, dryRun: false }),
    onSuccess: onInstalled,
    // A refused install usually means the space changed under the plan: show what it looks like now.
    onError: () => { void dryRun.refetch(); },
  });

  const plan = dryRun.data?.plan;

  // Example rows are off until asked for (owner, chat 3813, 13.11.2026). The server reads the choice off the
  // table binding, and a binding needs the action the plan decides: so the first plan writes the "no", and
  // one more dry-run follows. A module without example groups never gets here.
  // ponytail: goes once the server defaults example groups off by the blueprint mark itself.
  useEffect(() => {
    if (!plan) return;
    const next = examplesOffByDefault(bindings, blueprint, plan);
    if (next !== bindings) setBindings(next);
  }, [plan, bindings, blueprint]);

  const connected = [...new Set((plan?.tables ?? []).flatMap((table) => (table.columns && table.table_id != null ? [table.table_id] : [])))];
  const columns = useQueries({
    queries: connected.map((tableId) => ({
      queryKey: ['module-install-columns', tableId],
      queryFn: async (): Promise<TargetColumnLike[]> => {
        const response = await apiClient.request<{ data: ColumnRow[] }>(`/tables/${tableId}/columns`);
        return response.data.map((column) => ({ id: column.name, name: column.name, displayName: column.display_name, type: column.column_type }));
      },
    })),
  });
  const targetColumns = Object.fromEntries(connected.map((tableId, index) => [tableId, columns[index]?.data ?? []]));

  const failure = install.error ? `${t('moduleInstall.installFailed')}: ${message(install.error)}`
    : dryRun.error ? `${t('moduleInstall.planFailed')}: ${message(dryRun.error)}`
    : null;

  // Silent once the user chooses another table for the one they came from.
  const linkedNote = () => {
    if (!connectTable || !plan) return null;
    const table = connectTable.name;
    if (plan.tables.length === 0) return t('moduleInstall.linkedTable.unused', { table });
    const offered = plan.tables.find((entry) => entry.action === 'connect' && entry.table_id === connectTable.id);
    if (!offered) return null;
    if (plan.conflicts.some((conflict) => conflict.table === offered.key && NO_TABLE.includes(conflict.kind))) {
      return t('moduleInstall.linkedTable.unavailable', { table });
    }
    const declared = [...(blueprint.tables ?? []), ...(blueprint.requires?.tables ?? [])].find((entry) => entry.key === offered.key);
    return t('moduleInstall.linkedTable.offered', { table, name: declared?.display_name || offered.name || offered.key });
  };

  return {
    blueprint,
    role,
    loading: access.loading,
    allowed,
    adminOnly,
    tree: tree.data,
    plan,
    error: plan && tree.data ? null : dryRun.error ?? tree.error,
    retry: () => { void tree.refetch(); void dryRun.refetch(); },
    bindings,
    setBindings,
    targetColumns,
    busy: dryRun.isFetching,
    installing: install.isPending,
    blocked: plan?.conflicts.some((conflict) => conflict.blocking) ?? false,
    failure,
    linked: linkedNote(),
    install: () => install.mutate(),
  };
}
