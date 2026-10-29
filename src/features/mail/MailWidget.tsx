import { lazy, Suspense } from 'react';
import type { PresetWidgetProps, Widget } from '@/features/widgets/types/widget.types';
import { useLanguage } from '@/shared/i18n/LanguageContext';

/**
 * Mail dashboard/module preset (ADR-195) — the three-pane inbox embedded in a
 * dashboard cell or opened full-page via `/widgets/:id`.
 *
 * Scope: `widget.space_id ?? current space`. `getWidgetById` joins
 * `projects.space_id` (WidgetService.js:225), so the full-page route is
 * deterministic — the widget shows its own space's mail. `getWidgetsByDashboard`
 * has no such join (WidgetService.js:257), so on a dashboard `space_id` is
 * absent and the tile follows the active space, which is where the board is
 * being browsed anyway. The narrow cast keeps that join field local to this
 * module: core's `Widget` interface declares `project_id` only, and adding
 * `space_id` to it would be a core edit this module must not need.
 *
 * `MailPage` is lazy-loaded so the mail chunk stays out of the dashboard bundle
 * until a board actually renders this preset (mirrors `SimWidget.tsx:27`).
 */
const MailPage = lazy(() => import('./MailPage').then((m) => ({ default: m.MailPage })));

type WidgetWithSpace = Widget & { space_id?: number | null };

export function MailWidget({ widget }: PresetWidgetProps) {
  const spaceId = (widget as WidgetWithSpace).space_id ?? undefined;
  const { t } = useLanguage();

  return (
    <div className="h-full w-full overflow-hidden">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-sm text-[var(--text-tertiary)]">
            {t('mail.widget.loading')}
          </div>
        }
      >
        <MailPage spaceId={spaceId} />
      </Suspense>
    </div>
  );
}
