// ADR-207 §2.7 — the module catalog of a project's space. A card and its Install both open the module as
// a dialog over the catalog (`/modules/:moduleId`, owner, chat 3813, 13.11.2026), where the plan (§2.6)
// is; the filters and the table a link brought along live in the URL. The breadcrumbs are the header's
// (HeaderBreadcrumbs). The width of the page follows "Max cols" the way the workspaces page does (owner,
// chat 3813, 11.11.2026): one card slot per column, so the grid never shows more columns than chosen.
import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ModuleCatalog, NO_FILTERS, moduleCatalogQuery, readFilters, writeFilters, type CatalogModule } from '@/features/module-catalog';
import { useProjectsQuery } from '@/features/projects/hooks/useProjectsQuery';
import { useTableById } from '@/features/tables/hooks/useTableById';
import { maxColsWidth, useMaxCols } from '@/shared/components/ui/MaxColsSelector';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { ModuleDetailModal } from './ModuleDetailModal';

const SEARCH_DELAY_MS = 250;
const MAX_COLS_STORAGE_KEY = 'god-crm-modules-maxcols';
/** The narrowest card of the grid (`minmax(17rem, 1fr)`): `maxCols` of them side by side fit exactly. */
const CARD_SLOT_PX = 272;

/** `/projects/:projectId/widgets/create` was the create surface ADR-163 reworked; its links land in the catalog. */
export function WidgetCreateRedirect() {
  const { projectId } = useParams<{ projectId: string }>();
  const { search } = useLocation();
  return <Navigate to={`/projects/${projectId}/modules${search}`} replace />;
}

export function ModuleCatalogPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { projectId: projectParam, moduleId } = useParams<{ projectId: string; moduleId: string }>();
  const projectId = Number(projectParam);
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const [maxCols, setMaxCols] = useMaxCols(MAX_COLS_STORAGE_KEY);

  // The registry is asked once the typing pauses, not on every keystroke.
  const [search, setSearch] = useState(filters.search);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(filters.search), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [filters.search]);

  // The v3 API has no single-project route: the space comes from the project list the sidebar already holds.
  const projects = useProjectsQuery();
  const project = projects.data?.find(item => item.id === projectId);
  const spaceId = project?.space_id;
  // The whole catalog names the categories whatever the filters are.
  const all = useQuery(moduleCatalogQuery(spaceId, NO_FILTERS));
  const found = useQuery({ ...moduleCatalogQuery(spaceId, { ...filters, search }), placeholderData: keepPreviousData });

  // "Create on this table" links carry `?tableId=`: the plan of the module the user opens starts with
  // that table connected. Whether it fits is the dry-run's call, so nothing is checked here.
  const tableParam = params.get('tableId') ?? '';
  const tableId = /^[1-9]\d*$/.test(tableParam) ? Number(tableParam) : undefined;
  const table = useTableById(tableId === undefined ? undefined : tableParam);
  const linkedTable = tableId === undefined ? undefined : { id: tableId, name: table.data?.name ?? `#${tableId}` };
  const withoutTable = new URLSearchParams(params);
  withoutTable.delete('tableId');
  withoutTable.delete('type');

  const moduleHref = (module: CatalogModule) => ({ pathname: `/projects/${projectId}/modules/${module.id}`, search: params.toString() });
  const catalogHref = { pathname: `/projects/${projectId}/modules`, search: params.toString() };

  // `?install=` opened the plan here before the module had a dialog: such links open it.
  const install = params.get('install') ?? '';
  if (/^[1-9]\d*$/.test(install)) {
    const rest = new URLSearchParams(params);
    rest.delete('install');
    return <Navigate to={{ pathname: `/projects/${projectId}/modules/${install}`, search: rest.toString() }} replace />;
  }

  const missing = projects.error ?? (projects.data && !project ? new Error(t('moduleCatalog.projectMissing')) : null);
  const failure = missing ?? found.error;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--bg-primary)]">
      {moduleId && (
        <ModuleDetailModal
          moduleId={moduleId}
          project={project}
          catalog={all.data}
          listed={found.data}
          failure={missing ?? all.error}
          onRetry={() => { void (project ? all.refetch() : projects.refetch()); }}
          connectTable={linkedTable}
          moduleHref={moduleHref}
          catalogHref={catalogHref}
        />
      )}
      <div className="mx-auto w-full space-y-4 px-4 pb-6 lg:px-6" style={{ maxWidth: `${maxColsWidth(maxCols, CARD_SLOT_PX) + 48}px` }}>
        {linkedTable && (
          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--text-primary)]">
            <span>{t('moduleCatalog.linkedTable.note', { table: linkedTable.name })}</span>
            <Link to={{ search: withoutTable.toString() }} replace className="underline hover:text-[var(--text-secondary)]">{t('moduleCatalog.linkedTable.clear')}</Link>
          </p>
        )}
        <ModuleCatalog
          modules={found.data}
          categories={[...new Set((all.data ?? []).map(module => module.category))].sort()}
          filters={filters}
          onFiltersChange={next => setParams(writeFilters(params, next), { replace: true })}
          onInstall={module => navigate(moduleHref(module))}
          moduleHref={moduleHref}
          maxCols={maxCols}
          onMaxColsChange={setMaxCols}
          error={failure ? (failure instanceof Error ? failure.message : String(failure)) : null}
          onRetry={() => { void (project ? found.refetch() : projects.refetch()); }}
        />
      </div>
    </div>
  );
}
