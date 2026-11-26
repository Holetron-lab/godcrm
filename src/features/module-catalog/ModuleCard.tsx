// ADR-207 §2.7 — one module of the catalog, drawn like a space card (owner, chat 3813, 11.11.2026): the icon,
// the name that leads to the module page, the origin as a badge, a short description, and a line of
// counters — tables, apps, the market rating and installs — with one Install at its end. The first
// screenshot shows through the card, blurred. A module the user may not install stays visible, says
// which role is needed and keeps Install disabled (§2.2 axis C).
import { useId } from 'react';
import { Download, LayoutGrid, Lock, Package, Star, Table2, type LucideIcon } from 'lucide-react';
import { Link, type To } from 'react-router-dom';
import { Button } from '@/shared/components/ui/Button';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { categoryName } from './catalog';
import { composition, type CompositionKind } from './composition';
import type { CatalogModule, ModuleOrigin } from './types';

const UNPUBLISHED = ['draft', 'submitted', 'rejected'] as const;
const badgeClass = 'rounded-full px-1.5 py-0.5 text-[11px] font-medium';
const originClass: Record<ModuleOrigin, string> = {
  default: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  internal: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  external: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
};

/** A counter of the bottom line: the icon shows, the label reads. */
function Counter({ icon: Icon, label, value, filled = false }: { icon: LucideIcon; label: string; value: number; filled?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1" title={label}>
      <Icon className={`h-3.5 w-3.5 ${filled ? 'fill-current' : ''}`} aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="font-medium">{value}</span>
    </span>
  );
}

export function ModuleCard({ module, href, onInstall }: { module: CatalogModule; href: To; onInstall: (module: CatalogModule) => void }) {
  const { t } = useLanguage();
  const id = useId();
  const { blueprint } = module;
  const name = blueprint.title || module.key;
  const unpublished = UNPUBLISHED.find(status => status === module.status);
  // Ratings and install counts belong to the market: never on an instance-internal module (§2.7).
  const counters = module.origin !== 'internal';
  const groups = composition(blueprint);
  const count = (kind: CompositionKind) => groups.find(group => group.kind === kind)?.items.length ?? 0;
  const tables = count('tables');
  const apps = count('apps');
  const picture = blueprint.media?.find(item => item.type === 'image' || item.thumbnail_url);
  const backdrop = picture && (picture.thumbnail_url || picture.url);
  const gate = `${id}-gate`;

  return (
    <article aria-labelledby={`${id}-name`}
      className="group relative flex h-full min-h-[8.75rem] flex-col gap-2 overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 transition-all hover:border-[var(--color-primary-300)] hover:shadow-md focus-within:border-[var(--color-primary-500)]">
      {backdrop && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 scale-110 bg-cover bg-center opacity-25 blur-xl" style={{ backgroundImage: `url("${backdrop}")` }} />
      )}

      <div className="relative flex items-start gap-2.5">
        <span aria-hidden="true" className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--bg-tertiary)] text-lg transition-transform duration-300 group-hover:scale-110">
          {blueprint.icon || <Package className="h-5 w-5 text-[var(--text-secondary)]" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-name`} className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {/* The link covers the card (after:inset-0); the counters line sits above it (relative z-10). */}
            <Link to={href} className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none">{name}</Link>
          </h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
            <span className={`${badgeClass} ${originClass[module.origin]}`}>{t(`moduleCatalog.originBadge.${module.origin}`)}</span>
            {unpublished && <span className={`${badgeClass} bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400`}>{t(`moduleCatalog.status.${unpublished}`)}</span>}
            <span>{categoryName(t, module.category)} · {t('moduleCatalog.card.version', { version: module.version })}</span>
          </p>
        </div>
      </div>

      <p className="relative line-clamp-2 flex-1 text-xs leading-relaxed text-[var(--text-secondary)]">{blueprint.description || ' '}</p>

      <div className="relative z-10 mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-[var(--text-tertiary)]">
        <Counter icon={Table2} label={t('moduleCatalog.card.tables', { count: tables })} value={tables} />
        <Counter icon={LayoutGrid} label={t('moduleCatalog.card.apps', { count: apps })} value={apps} />
        {counters && module.rating != null && <Counter icon={Star} filled label={t('moduleCatalog.card.rating', { value: module.rating })} value={module.rating} />}
        {counters && module.installs != null && <Counter icon={Download} label={t('moduleCatalog.card.installs', { count: module.installs })} value={module.installs} />}
        <Button size="sm" className="ml-auto" disabled={!module.can_install} aria-label={t('moduleCatalog.card.installNamed', { name })}
          aria-describedby={module.can_install ? undefined : gate} onClick={() => onInstall(module)}>
          {t('moduleCatalog.card.install')}
        </Button>
      </div>
      {!module.can_install && (
        <p id={gate} className="relative flex items-start gap-1.5 text-[11px] text-[var(--text-primary)]">
          <Lock className="mt-px h-3 w-3 flex-shrink-0" aria-hidden="true" />
          {module.required_role === 'admin'
            ? <span title={t('moduleCatalog.card.adminHint')}><strong className="font-medium">{t('moduleCatalog.card.adminRequired')}</strong><span className="sr-only"> {t('moduleCatalog.card.adminHint')}</span></span>
            : <strong className="font-medium">{t('moduleCatalog.card.memberRequired')}</strong>}
        </p>
      )}
    </article>
  );
}
