/**
 * PublicProjectPage — read-only viewer for a single public project (ADR-0060 P5b / §"ТОТ ЖЕ" rewire).
 *
 * Route: `/s/:slug/projects/:projectId`
 *
 * Mounts the **internal** `<DashboardGrid>` wrapped in `PublicViewProvider`
 * so the public surface renders the exact same React tree the auth-side
 * dashboard does — header, layout, widget cards, presets. Public-mode data
 * fetching is achieved by per-hook branches inside `useWidgets`,
 * `useTicketData` and `DashboardWidgetCard` that route through `publicApi`
 * when a `publicSlug` is present in context (instead of the separate
 * `Public*WidgetCard` fork this page previously maintained).
 */

import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, FileQuestion } from 'lucide-react';

import { publicApi } from './publicApi';
import { PublicViewProvider } from './PublicViewContext';
import { usePublicSeo } from './usePublicSeo';
import { DashboardGrid } from '@/features/widgets';

function PublicProjectMissing() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <FileQuestion className="h-10 w-10 text-[var(--text-tertiary)]" />
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">
        Проект не найден
      </h2>
      <p className="max-w-md text-sm text-[var(--text-secondary)]">
        Этот проект либо не существует, либо не открыт для публичного просмотра.
      </p>
    </div>
  );
}

export function PublicProjectPage() {
  const { slug, projectId } = useParams<{ slug: string; projectId: string }>();
  const numericProjectId = Number(projectId);

  const projectQ = useQuery({
    queryKey: ['publicProject', slug, numericProjectId],
    queryFn: () =>
      publicApi.getProject(slug as string, numericProjectId).then((r) => r.data),
    enabled: !!slug && Number.isFinite(numericProjectId) && numericProjectId > 0,
    retry: false,
  });

  usePublicSeo({
    title: projectQ.data?.project?.name
      ? `${projectQ.data.project.name} — public`
      : 'Public project',
    description: projectQ.data?.project?.description ?? undefined,
    canonicalUrl: typeof window !== 'undefined' ? window.location.href : undefined,
  });

  if (!slug || !Number.isFinite(numericProjectId) || numericProjectId <= 0) {
    return <PublicProjectMissing />;
  }

  if (projectQ.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-[var(--text-tertiary)]">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (projectQ.isError || !projectQ.data) {
    return <PublicProjectMissing />;
  }

  const { project, dashboard_id } = projectQ.data;

  return (
    <PublicViewProvider readOnly publicSlug={slug}>
      {/* Header + grid flow in normal document order; the single scroll
          container is PublicLayout's <main> (overflow-y-auto). No inner
          overflow wrapper — a second scroll container produced a double
          scrollbar (see PublicSpacePage same-fix). */}
      <div className="flex flex-col gap-4">
        <header className="flex items-start gap-3">
          <span className="text-3xl leading-none">{project.icon || '📁'}</span>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-[var(--text-primary)] truncate">
              {project.name}
            </h1>
            {project.description && (
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                {project.description}
              </p>
            )}
            <p className="mt-2 text-xs text-[var(--text-tertiary)]">
              <Link to={`/s/${slug}`} className="hover:underline">
                ← Назад к публичному пространству
              </Link>
            </p>
          </div>
        </header>

        {dashboard_id != null ? (
          <DashboardGrid dashboardId={dashboard_id} readOnly />
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--border-primary)] p-8 text-center text-sm text-[var(--text-tertiary)]">
            У проекта нет публичной панели.
          </div>
        )}
      </div>
    </PublicViewProvider>
  );
}
