// ADR-207 §2.7 — the one catalog page that replaces the ADR-163 tabs. Laid out like a store front
// (owner, chat 3813, 06.11.2026): categories as a top menu next to the search, the title below, then the
// filter chips (origin, components, "I can install") and the grid of cards. Data and filters come through props.
import type { ReactNode } from 'react';
import { Check, Search } from 'lucide-react';
import type { To } from 'react-router-dom';
import { Button } from '@/shared/components/ui/Button';
import { Input } from '@/shared/components/ui/Input';
import { MaxColsSelector, type MaxCols } from '@/shared/components/ui/MaxColsSelector';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { NO_FILTERS, categoryName } from './catalog';
import { ModuleCard } from './ModuleCard';
import { MODULE_COMPONENTS, MODULE_ORIGINS, type CatalogFilters, type CatalogModule } from './types';

export interface ModuleCatalogProps {
  /** Undefined until the first answer of the registry. */
  modules: CatalogModule[] | undefined;
  /** Categories of the whole catalog, not of the filtered result. */
  categories: string[];
  filters: CatalogFilters;
  onFiltersChange: (filters: CatalogFilters) => void;
  onInstall: (module: CatalogModule) => void;
  /** Where a card leads: the page of the module. */
  moduleHref: (module: CatalogModule) => To;
  /** The most columns the grid shows — the "Max cols" of the workspaces page; the page sets its width by it. */
  maxCols: MaxCols;
  onMaxColsChange: (next: MaxCols) => void;
  error?: string | null;
  onRetry: () => void;
}

const chipClass = 'inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[var(--border-primary)] px-3 text-sm text-[var(--text-secondary)] '
  + 'peer-checked:border-[var(--color-primary-500)] peer-checked:bg-[var(--bg-secondary)] peer-checked:text-[var(--text-primary)] '
  + 'peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-primary-500)] peer-checked:[&>svg]:block';

/** A native radio or checkbox drawn as a chip: the check mark carries the state, not the colour alone. */
function Chip({ type, name, checked, onChange, children }: { type: 'radio' | 'checkbox'; name?: string; checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className="cursor-pointer">
      <input type={type} name={name} checked={checked} onChange={onChange} className="peer sr-only" />
      <span className={chipClass}><Check className="hidden h-3.5 w-3.5" aria-hidden="true" />{children}</span>
    </label>
  );
}

const tabClass = 'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] transition-colors '
  + 'hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)] '
  + 'aria-[current=page]:bg-[var(--bg-tertiary)] aria-[current=page]:text-[var(--text-primary)]';

const groupClass = 'flex flex-wrap items-center gap-2';
// `float-left` keeps the legend on the chips' line; a legend ignores flex layout.
const legendClass = 'float-left mr-1 text-xs font-medium text-[var(--text-secondary)]';

export function ModuleCatalog({ modules, categories, filters, onFiltersChange, onInstall, moduleHref, maxCols, onMaxColsChange, error, onRetry }: ModuleCatalogProps) {
  const { t } = useLanguage();
  const change = (patch: Partial<CatalogFilters>) => onFiltersChange({ ...filters, ...patch });
  const filtered = filters.origin !== undefined || filters.components.length > 0 || filters.category !== undefined || filters.canInstall || filters.search !== '';

  return (
    <div className="flex flex-col gap-5">
      {/* Above the cards' Install buttons (z-10), which otherwise paint over the bar while scrolling. */}
      <form role="search" className="sticky top-0 z-20 flex flex-col gap-3 border-b border-[var(--border-primary)] bg-[var(--bg-primary)] pb-3" onSubmit={event => event.preventDefault()}>
        <div className="flex flex-wrap items-center gap-3">
          <nav aria-label={t('moduleCatalog.categories.label')} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            <button type="button" className={tabClass} aria-current={filters.category === undefined ? 'page' : undefined} onClick={() => change({ category: undefined })}>
              {t('moduleCatalog.categories.all')}
            </button>
            {categories.map(category => (
              <button key={category} type="button" className={tabClass} aria-current={filters.category === category ? 'page' : undefined} onClick={() => change({ category })}>
                {categoryName(t, category)}
              </button>
            ))}
          </nav>
          <div className="w-full sm:w-80">
            <Input type="search" name="module-search" aria-label={t('moduleCatalog.search')} placeholder={t('moduleCatalog.search')} maxLength={200}
              value={filters.search} onChange={event => change({ search: event.target.value })} leftAddon={<Search className="h-4 w-4" aria-hidden="true" />} />
          </div>
          <MaxColsSelector value={maxCols} onChange={onMaxColsChange} />
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <fieldset className={groupClass}>
            <legend className={legendClass}>{t('moduleCatalog.origin.legend')}</legend>
            <Chip type="radio" name="module-origin" checked={filters.origin === undefined} onChange={() => change({ origin: undefined })}>{t('moduleCatalog.origin.all')}</Chip>
            {MODULE_ORIGINS.map(origin => (
              <Chip key={origin} type="radio" name="module-origin" checked={filters.origin === origin} onChange={() => change({ origin })}>{t(`moduleCatalog.origin.${origin}`)}</Chip>
            ))}
          </fieldset>

          <fieldset className={groupClass}>
            <legend className={legendClass}>{t('moduleCatalog.components.legend')}</legend>
            {MODULE_COMPONENTS.map(component => {
              const checked = filters.components.includes(component);
              return (
                <Chip key={component} type="checkbox" checked={checked}
                  onChange={() => change({ components: checked ? filters.components.filter(entry => entry !== component) : [...filters.components, component] })}>
                  {t(`moduleCatalog.components.${component}`)}
                </Chip>
              );
            })}
          </fieldset>

          <Chip type="checkbox" checked={filters.canInstall} onChange={() => change({ canInstall: !filters.canInstall })}>{t('moduleCatalog.canInstall')}</Chip>
        </div>
      </form>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">{filters.category === undefined ? t('moduleCatalog.title') : categoryName(t, filters.category)}</h1>
        {modules && <p role="status" className="text-sm text-[var(--text-secondary)]">{t('moduleCatalog.found', { count: modules.length })}</p>}
      </div>

      {error ? (
        <div role="alert" className="space-y-3 text-sm text-[var(--text-primary)]">
          <p>{t('moduleCatalog.failed')}: {error}</p>
          <Button variant="secondary" size="sm" onClick={onRetry}>{t('moduleCatalog.retry')}</Button>
        </div>
      ) : !modules ? (
        <p role="status" className="text-sm text-[var(--text-secondary)]">{t('moduleCatalog.loading')}</p>
      ) : modules.length === 0 ? (
        <div className="space-y-3 py-8 text-center text-sm text-[var(--text-secondary)]">
          <p>{filtered ? t('moduleCatalog.noMatch') : t('moduleCatalog.empty')}</p>
          {filtered && <Button variant="secondary" size="sm" onClick={() => onFiltersChange(NO_FILTERS)}>{t('moduleCatalog.reset')}</Button>}
        </div>
      ) : (
        <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(17rem,1fr))]">
          {modules.map(module => <li key={module.id}><ModuleCard module={module} href={moduleHref(module)} onInstall={onInstall} /></li>)}
        </ul>
      )}
    </div>
  );
}
