/**
 * PublicSpacePage — landing page for a public space.
 *
 * ADR-0060-A A3: resolves the space's landing dashboard (`main_dashboard_id`
 * from the A2 payload, or first public dashboard from the tree as Tier-2
 * fallback) and mounts the internal `<DashboardGrid readOnly>` inside a
 * `PublicViewProvider`. No more card-grid; the documents widget surfaces
 * naturally inside the landing dashboard.
 *
 * Resolution chain:
 *   1. `space.main_dashboard_id` (A2 backend, eligible main_project_id)
 *   2. First public project's first dashboard (deterministic from /tree)
 *   3. Empty-state — "no public dashboard yet"
 *
 * Other behaviours preserved:
 *   - Password gate (PasswordPrompt on 401 + requiresPassword)
 *   - SEO meta (usePublicSeo)
 *
 * Card-grid + per-doc tile logic removed (was: ADR-105 AC3/AC12 era).
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Globe, Loader2 } from 'lucide-react';

import {
  publicApi,
  PublicApiError,
  type PublicSpace,
} from './publicApi';
import { PasswordPrompt } from './PasswordPrompt';
import { PublicViewProvider } from './PublicViewContext';
import { usePublicSeo } from './usePublicSeo';
import { DashboardGrid } from '@/features/widgets';

export function PublicSpacePage() {
  const { slug } = useParams<{ slug: string }>();
  const [space, setSpace] = useState<PublicSpace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);

  const publicUrl = slug ? `${window.location.origin}/s/${slug}` : undefined;
  usePublicSeo({
    title: space ? `${space.name} - Public Space` : 'Public Space',
    description: space?.description || undefined,
    ogTitle: space?.name || undefined,
    ogDescription: space?.description || undefined,
    ogType: 'website',
    ogUrl: publicUrl,
    canonicalUrl: publicUrl,
  });

  const fetchSpace = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    setNeedsPassword(false);

    try {
      const spaceRes = await publicApi.getSpace(slug);
      setSpace(spaceRes.data.space);
    } catch (err) {
      if (err instanceof PublicApiError && err.requiresPassword) {
        setNeedsPassword(true);
      } else if (err instanceof PublicApiError && err.status === 404) {
        setError('Space not found.');
      } else {
        setError('Failed to load space. Please try again later.');
      }
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchSpace();
  }, [fetchSpace]);

  // Tier-2 fallback: first public dashboard from the tree. Only queried when
  // the A2 payload didn't surface a `main_dashboard_id` (null when migration
  // 062 not yet on PROD, or when main_project_id resolved to ineligible).
  const needsTreeFallback =
    !!space && (space.main_dashboard_id ?? null) === null;
  const treeQuery = useQuery({
    queryKey: ['publicTree', slug, 'landing-fallback'],
    queryFn: () => publicApi.getTree(slug as string).then((r) => r.data),
    enabled: !!slug && needsTreeFallback,
    staleTime: 60_000,
    retry: false,
  });

  // ---- Password gate ----
  if (needsPassword) {
    return <PasswordPrompt slug={slug || ''} onSuccess={fetchSpace} />;
  }

  // ---- Loading ----
  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // ---- Error ----
  if (error) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <AlertCircle className="h-10 w-10 text-red-400" />
        <p className="text-lg font-medium text-gray-700">{error}</p>
      </div>
    );
  }

  if (!space || !slug) return null;

  // ---- Resolve landing dashboard ----
  // Tier 1: A2 backend payload.
  // Tier 2: first public dashboard in the tree (deterministic order from /tree).
  // Tier 3: empty state (no public dashboard yet).
  const tierOne = space.main_dashboard_id ?? null;
  const tierTwo =
    !tierOne && treeQuery.data
      ? treeQuery.data.projects.find((p) => p.dashboards.length > 0)?.dashboards[0]?.id ?? null
      : null;
  const dashboardId = tierOne ?? tierTwo ?? null;

  // Wait on the fallback query before deciding "no dashboard"; otherwise a
  // brief empty-state flicker happens between Tier-1=null and Tier-2 resolve.
  if (needsTreeFallback && treeQuery.isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // ---- Tier 3: empty state ----
  if (!dashboardId) {
    return (
      <div className="space-y-6">
        <header className="flex items-start gap-3">
          {space.icon ? (
            <span className="text-3xl leading-none">{space.icon}</span>
          ) : (
            <Globe className="h-8 w-8 text-[var(--color-primary-500)]" />
          )}
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)] sm:text-3xl">
              {space.name}
            </h1>
            {space.description && (
              <p className="mt-2 max-w-2xl text-base text-[var(--text-secondary)]">
                {space.description}
              </p>
            )}
          </div>
        </header>
        <div className="rounded-xl border border-dashed border-[var(--border-primary)] bg-[var(--bg-secondary)] p-10 text-center">
          <p className="text-sm text-[var(--text-tertiary)]">
            Нет публичного дашборда для этого пространства.
          </p>
        </div>
      </div>
    );
  }

  // ---- Tier 1 / Tier 2: render internal dashboard read-only ----
  // No own scroll wrapper: PublicLayout's <main> already owns the page scroll
  // (overflow-y-auto). A second `h-full overflow-y-auto` here nested a scroll
  // region AND clamped the grid shorter than its content → double scroll +
  // widget-size mismatch vs the internal space view (SpaceDashboardPage, which
  // also lets the app shell's main scroll handle overflow). Let the grid flow.
  return (
    <PublicViewProvider readOnly publicSlug={slug}>
      <DashboardGrid dashboardId={dashboardId} readOnly />
    </PublicViewProvider>
  );
}
