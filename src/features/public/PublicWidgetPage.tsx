/**
 * PublicWidgetPage — read-only viewer for a single public widget (ADR-0060).
 *
 * Route: `/s/:slug/widgets/:widgetId`
 *
 * Replaces the previous direct mount of the internal `WidgetViewPage` on this
 * path, which had no public-mode awareness and rendered editing affordances
 * (create / upload / filter buttons) to anonymous visitors. We now:
 *
 *   1. Fetch the widget through `publicApi.getWidget` (404 when not public).
 *   2. Wrap the render tree in `PublicViewProvider` so internal hooks
 *      (`useTicketData`, `useWidgets`, …) auto-route through `publicApi`.
 *   3. Branch on the preset:
 *      - `documents` / `documents_v4` → mount `DocumentsWidget` with the
 *        public-mode props (`dataSource="public"`, `publicSlug`, `widgetId`,
 *        `isEditMode={false}`). The provider then short-circuits all
 *        mutation methods, hides the toolbar create/upload row, and reads
 *        documents via `/public/s/:slug/widgets/:widgetId/documents`.
 *      - everything else → mount the internal `WidgetViewPage` under the
 *        provider. Data flows through the public API via per-hook branches;
 *        editing controls are belt-and-braces guarded by the
 *        `guardMutation` wrapper in `useRowMutations` etc.
 */

import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ChevronLeft, Loader2 } from 'lucide-react';

import { publicApi } from './publicApi';
import { PublicViewProvider } from './PublicViewContext';
import { usePublicSeo } from './usePublicSeo';
import { DocumentsWidget } from '@/features/widgets/components/presets/documents';
import { WidgetViewPage } from '@/pages/widgets/WidgetViewPage';

function PublicWidgetMissing({ slug }: { slug: string | undefined }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <AlertCircle className="h-10 w-10 text-red-400" />
      <p className="max-w-md text-lg font-medium text-[var(--text-primary)]">
        Модуль не найден или не открыт для публичного просмотра.
      </p>
      {slug && (
        <Link
          to={`/s/${slug}`}
          className="mt-2 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
        >
          <ChevronLeft className="h-4 w-4" />
          Назад к публичному пространству
        </Link>
      )}
    </div>
  );
}

export function PublicWidgetPage() {
  const { slug, widgetId } = useParams<{ slug: string; widgetId: string }>();
  const numericWidgetId = Number(widgetId);

  const widgetQ = useQuery({
    queryKey: ['publicWidget', slug, numericWidgetId],
    queryFn: () =>
      publicApi.getWidget(slug as string, numericWidgetId).then((r) => r.data.widget),
    enabled: !!slug && Number.isFinite(numericWidgetId) && numericWidgetId > 0,
    retry: false,
  });

  usePublicSeo({
    title: widgetQ.data?.name ? `${widgetQ.data.name} — public` : 'Public widget',
    canonicalUrl: typeof window !== 'undefined' ? window.location.href : undefined,
  });

  if (!slug || !Number.isFinite(numericWidgetId) || numericWidgetId <= 0) {
    return <PublicWidgetMissing slug={slug} />;
  }

  if (widgetQ.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-[var(--text-tertiary)]">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (widgetQ.isError || !widgetQ.data) {
    return <PublicWidgetMissing slug={slug} />;
  }

  const widget = widgetQ.data;
  const isDocuments = widget.type === 'documents' || widget.type === 'documents_v4';

  return (
    <PublicViewProvider readOnly publicSlug={slug}>
      <div className="flex h-full min-h-[60vh] flex-col">
        {isDocuments ? (
          <div className="flex-1 min-h-0 min-h-[60vh] overflow-hidden border-[var(--border-primary)] rounded-2xl border">
            <DocumentsWidget
              config={(widget.view_config || {}) as Parameters<typeof DocumentsWidget>[0]['config']}
              spaceId={0}
              isEditMode={false}
              dataSource="public"
              publicSlug={slug}
              widgetId={numericWidgetId}
            />
          </div>
        ) : (
          // Per-preset public hardening will land alongside the widget-specific
          // public scrubbers. For now the internal page reads through
          // `useTicketData` / `useWidgets` public branches; mutation buttons
          // that slip through are no-ops via `guardMutation`.
          <WidgetViewPage />
        )}
      </div>
    </PublicViewProvider>
  );
}

export default PublicWidgetPage;
