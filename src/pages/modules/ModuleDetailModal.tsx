// ADR-207 §2.7 — one module as a dialog over the catalog page: `/projects/:projectId/modules/:moduleId`
// (owner, chat 3813, 13.11.2026). The module comes from the catalog the page already holds; the plan of the
// space (§2.6) is the install step of the dialog, and Confirm runs the install. The arrows walk the modules
// the page lists; closing leads back to the catalog with its filters. The table a link brought along
// (`?tableId=`) starts the plan connected. The owner of the module edits its texts in place.
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, type To } from 'react-router-dom';
import { useAuthStore } from '@/features/auth/store/authStore';
import { ModuleDetail, updateModuleMeta, type CatalogModule, type ModuleDetailProps } from '@/features/module-catalog';
import { InstallPlanView, summarizePlan, useInstallPlan, type InstallResult } from '@/features/module-install';
import { useSpaceAccessLevel } from '@/features/spaces/hooks/useSpaceAccessLevel';
import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui/Button';
import { useLanguage } from '@/shared/i18n/LanguageContext';

export interface ModuleDetailModalProps {
  moduleId: string;
  /** The project of the catalog page, once the list knows it. */
  project: { id: number; space_id: number } | undefined;
  /** The whole catalog of the space, every filter off: the module is looked up here, so a link always opens. */
  catalog: CatalogModule[] | undefined;
  /** The modules the page lists, as filtered: the arrows walk these. */
  listed: CatalogModule[] | undefined;
  /** Why there is no project or no catalog, once there is nothing to wait for. */
  failure: unknown;
  onRetry: () => void;
  /** A table the user came from: the plan starts with it connected. */
  connectTable?: { id: number; name: string };
  moduleHref: (module: CatalogModule) => To;
  /** The catalog with its filters: where closing leads. */
  catalogHref: To;
}

type ModuleWithPlanProps = Pick<ModuleDetailProps, 'module' | 'onClose' | 'previous' | 'next' | 'onSave'> & {
  spaceId: number;
  projectId: number;
  connectTable?: { id: number; name: string };
};

/** The module with its plan: a component of its own so the plan state is born with the module. */
function ModuleWithPlan({ module, spaceId, projectId, connectTable, ...rest }: ModuleWithPlanProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const onInstalled = async (result: InstallResult) => {
    // An install adds tables, apps, tiles and menu entries: nothing cached about the space can be trusted.
    await queryClient.invalidateQueries();
    const app = result.widgets?.find(widget => widget.kind === 'app');
    navigate(app ? `/widgets/${app.widget_id}` : `/projects/${projectId}/dashboard`);
  };
  const plan = useInstallPlan({ blueprint: module.blueprint, spaceId, projectId, connectTable, onInstalled: result => { void onInstalled(result); } });
  const ready = Boolean(plan.plan && plan.tree);
  // "View module" opens an app of the module the space already has: the plan reports it as existing.
  const installed = plan.plan?.apps?.find(app => app.action === 'existing' && app.widget_id != null);

  return (
    <ModuleDetail
      {...rest}
      module={module}
      viewHref={installed ? `/widgets/${installed.widget_id}` : undefined}
      onInstall={plan.install}
      installDisabled={!ready || plan.blocked || plan.busy || plan.installing}
      installHint={plan.blocked ? t('moduleInstall.summary.resolve') : plan.installing ? t('moduleInstall.summary.installing') : null}
      // A role the server refuses a plan to sees the blueprint's composition instead; the lock is under Get module.
      plan={plan.loading || plan.allowed ? <InstallPlanView state={plan} withInstall={false} /> : undefined}
      summary={plan.plan ? summarizePlan(plan.plan, module.blueprint) : undefined}
    />
  );
}

export function ModuleDetailModal({ moduleId, project, catalog, listed, failure, onRetry, connectTable, moduleHref, catalogHref }: ModuleDetailModalProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const module = catalog?.find(entry => String(entry.id) === moduleId);
  const onClose = () => navigate(catalogHref);

  // The registry lets the owner of the publisher space change a module (REGISTRY_OWNER_REQUIRED): the same
  // rule decides who gets the pencil. The marketplace pages — the built-in modules — are the platform
  // owner's (owner, chat 3813, 11.11.2026): a global owner or admin edits them from any space. External
  // modules come from another registry and are nobody's to edit here.
  const access = useSpaceAccessLevel(project?.space_id ?? null);
  const owner = access.accessLevel === 'owner' || access.accessLevel === 'owner_owner';
  const role = useAuthStore(state => state.user?.role);
  const platformOwner = role === 'owner' || role === 'admin';
  const editable = Boolean(module && project && (
    (owner && module.origin === 'internal' && module.publisher_space_id === project.space_id)
    || (platformOwner && module.origin === 'default')
  ));

  const problem = failure ?? (catalog && !module ? new Error(t('moduleCatalog.moduleMissing')) : null);
  if (problem || !module || !project) {
    return (
      <Modal open onOpenChange={open => { if (!open) onClose(); }} title={t('moduleCatalog.title')} size="sm">
        {problem ? (
          <div role="alert" className="space-y-3 text-sm text-[var(--text-primary)]">
            <p>{problem instanceof Error ? problem.message : String(problem)}</p>
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" size="sm" onClick={onRetry}>{t('moduleCatalog.retry')}</Button>
              <Link to={catalogHref} className="inline-flex items-center text-sm underline">{t('moduleCatalog.detail.back')}</Link>
            </div>
          </div>
        ) : <p role="status" className="text-sm text-[var(--text-secondary)]">{t('moduleCatalog.loading')}</p>}
      </Modal>
    );
  }

  const onSave: ModuleDetailProps['onSave'] = editable
    ? async patch => {
      await updateModuleMeta(project.space_id, module, patch);
      // Every catalog query holds this module: the grid, the dialog, the other filters.
      await queryClient.invalidateQueries({ queryKey: ['module-catalog'] });
    }
    : undefined;

  const neighbours = listed ?? [];
  const at = neighbours.findIndex(entry => entry.id === module.id);
  const neighbour = (entry: CatalogModule | undefined) => entry && { name: entry.blueprint.title || entry.key, href: moduleHref(entry) };

  return (
    <ModuleWithPlan
      key={module.id}
      module={module}
      spaceId={project.space_id}
      projectId={project.id}
      connectTable={connectTable}
      onClose={onClose}
      previous={at > 0 ? neighbour(neighbours[at - 1]) : undefined}
      next={at >= 0 ? neighbour(neighbours[at + 1]) : undefined}
      onSave={onSave}
    />
  );
}
