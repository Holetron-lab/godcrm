/**
 * PublicDocumentPage — full-page public document viewer.
 *
 * ADR-0060 P6/F — rewritten to mount the internal `DocumentsWidget` in
 * single-doc focus + read-only mode, instead of forking a parallel render
 * tree. "ТОТ ЖЕ" — the rendered React subtree is byte-for-byte the same as
 * what an authed user sees inside the CRM when they open the document.
 *
 * Legacy route: `/s/<spaceSlug>/docs/<docSlug>` (no widget id in the URL).
 *
 * URL-resolution strategy (Option A):
 *   1. Fetch the public space tree (`/public/s/:slug/tree`).
 *   2. Walk every public widget surfaced in the tree.
 *   3. Probe each via `/public/s/:slug/widgets/:wid/documents` — non-documents
 *      widgets 404 (backend gate `preset_name === 'documents'`).
 *   4. Pick the (singleton) widget whose registry contains `docSlug`.
 *      - exactly one match → render
 *      - zero matches → 404 ("Document not found")
 *      - multiple matches → 404 + author message ("disambiguate via
 *        /widgets/:wid/docs/:slug")
 *
 * This avoids a route change + 301 hop on every existing public-doc link.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ChevronLeft, Loader2 } from 'lucide-react';

import { publicApi, PublicApiError } from './publicApi';
import { PasswordPrompt } from './PasswordPrompt';
import { usePublicSeo } from './usePublicSeo';
import { DocumentsWidget } from '@/features/widgets/components/presets/documents';

/**
 * Resolve (publicSlug, docSlug) → widgetId by probing every documents widget
 * in the public tree. Result is cached by React Query so subsequent doc
 * navigations within the same space are instant once the tree is cached.
 */
function useResolveDocumentsWidget(slug: string | undefined, docSlug: string | undefined) {
  return useQuery({
    queryKey: ['publicDocumentsWidgetResolve', slug, docSlug],
    queryFn: async (): Promise<{ widgetId: number } | { error: 'not_found' | 'ambiguous' }> => {
      if (!slug || !docSlug) return { error: 'not_found' };
      const treeRes = await publicApi.getTree(slug);
      const tree = treeRes.data;
      // Every widget surfaced in the public tree could potentially be a
      // documents widget. The tree payload doesn't carry preset names, so we
      // probe `getWidgetDocuments` on each — non-documents widgets 404 there
      // (gated by `preset_name === 'documents'` in `loadPublicDocumentsWidget`).
      const widgetIds = tree.projects.flatMap((p) => p.widgets.map((w) => w.id));

      const matches: number[] = [];
      // Sequential rather than parallel to keep the probe polite to the
      // public surface — most spaces have <5 widgets.
      for (const wid of widgetIds) {
        try {
          const docs = await publicApi.getWidgetDocuments(slug, wid);
          if (docs.data?.rows?.some((row) => row.data?.slug === docSlug)) {
            matches.push(wid);
          }
        } catch (err) {
          // 404 = not a documents widget (or doesn't have a registry). Skip.
          if (err instanceof PublicApiError && err.status === 404) continue;
          // Other errors (network, 500, 401-password) propagate so the page
          // shows an error state / password prompt instead of silently 404-ing.
          throw err;
        }
      }

      if (matches.length === 1) return { widgetId: matches[0] };
      if (matches.length > 1) return { error: 'ambiguous' };
      return { error: 'not_found' };
    },
    enabled: !!slug && !!docSlug,
    staleTime: 60_000,
    retry: false,
  });
}

export function PublicDocumentPage() {
  const { slug, docSlug } = useParams<{ slug: string; docSlug: string }>();

  // Password-gate state — only flips when the resolver's API call signals it.
  // The tree endpoint hits `publicSpaceAccess`, same gate as the legacy code.
  const [needsPassword, setNeedsPassword] = useState(false);

  const resolveQuery = useResolveDocumentsWidget(slug, docSlug);

  // Surface 401+requiresPassword from the resolver.
  useEffect(() => {
    const err = resolveQuery.error;
    if (err instanceof PublicApiError && err.requiresPassword) {
      setNeedsPassword(true);
    }
  }, [resolveQuery.error]);

  // SEO — keep the same shape as the legacy page so existing crawler entries
  // resolve to the same titles. Title gets enriched once the doc loads (via
  // a child effect would be nicer, but we don't have the doc name at this
  // level without an extra fetch — accept a generic title for now).
  const publicUrl =
    slug && docSlug ? `${window.location.origin}/s/${slug}/docs/${docSlug}` : undefined;
  usePublicSeo({
    title: docSlug ? `${docSlug} - Public Document` : 'Public Document',
    ogTitle: docSlug || undefined,
    ogType: 'article',
    ogUrl: publicUrl,
    canonicalUrl: publicUrl,
  });

  // The DocumentsWidget config it needs is mostly metadata-only in public
  // mode (the provider routes through public endpoints anyway). Project /
  // space id stay 0 — the provider keys queries on widgetId+publicSlug.
  const widgetConfig = useMemo(
    () => ({
      project_id: 0,
      folder_path: 'databases/documents/',
    }),
    [],
  );

  if (needsPassword) {
    return <PasswordPrompt slug={slug || ''} onSuccess={() => resolveQuery.refetch()} />;
  }

  if (resolveQuery.isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const result = resolveQuery.data;
  const errKind: 'fetch_error' | 'not_found' | 'ambiguous' | null = !result
    ? 'fetch_error'
    : 'error' in result
      ? result.error
      : null;

  if (errKind) {
    const message =
      errKind === 'ambiguous'
        ? 'Multiple documents widgets contain this slug — author must disambiguate by linking via /widgets/<id>/docs/<slug>.'
        : errKind === 'not_found'
          ? 'Document not found.'
          : 'Failed to load document. Please try again later.';
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <AlertCircle className="h-10 w-10 text-red-400" />
        <p className="max-w-md text-lg font-medium text-[var(--text-primary)]">{message}</p>
        <Link
          to={`/s/${slug}`}
          className="mt-2 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to space
        </Link>
      </div>
    );
  }

  // ✓ resolved — mount the internal widget in single-doc focus + public mode.
  // The page chrome (header, sidebar, footer) is provided by PublicLayout;
  // we only render the document body here. The widget itself handles its own
  // toolbar visibility (hidden in singleDocFocus) and loader.
  const { widgetId } = result as { widgetId: number };

  return (
    <div className="flex h-full min-h-[60vh] flex-col">
      {/* Small breadcrumb above the widget so the user has a "back" affordance.
          Kept minimal — the widget itself prints the doc title/icon. */}
      <div className="mb-3 px-1">
        <Link
          to={`/s/${slug}`}
          className="inline-flex items-center gap-1 text-sm text-[var(--text-tertiary)] transition-colors hover:text-[var(--color-primary-500)]"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to space
        </Link>
      </div>

      <div className="min-h-[60vh] flex-1">
        <DocumentsWidget
          config={widgetConfig}
          spaceId={0}
          isEditMode={false}
          dataSource="public"
          publicSlug={slug}
          widgetId={widgetId}
          initialDocSlug={docSlug}
          singleDocFocus
        />
      </div>
    </div>
  );
}
