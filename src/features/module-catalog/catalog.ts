// ADR-207 §2.7 — catalog helpers: one card per module, filters as URL state.
import { MODULE_COMPONENTS, MODULE_ORIGINS, type CatalogFilters, type CatalogModule, type ModuleComponent, type ModuleOrigin } from './types';

export const NO_FILTERS: CatalogFilters = { components: [], canInstall: false, search: '' };

/** Categories are free-form registry slugs; only the default one has a translation. */
export const categoryName = (t: (key: string) => string, category: string) =>
  (category === 'general' ? t('moduleCatalog.category.general') : category);

const isOrigin = (value: string | null): value is ModuleOrigin => (MODULE_ORIGINS as readonly (string | null)[]).includes(value);
const isComponent = (value: string): value is ModuleComponent => (MODULE_COMPONENTS as readonly string[]).includes(value);

const newer = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true }) > 0;

/** The registry lists every version; the catalog shows the newest one per module and origin. */
export function latestVersions(modules: CatalogModule[]): CatalogModule[] {
  const latest = new Map<string, CatalogModule>();
  for (const module of modules) {
    const id = `${module.origin}:${module.key}`;
    const known = latest.get(id);
    if (!known || newer(module.version, known.version)) latest.set(id, module);
  }
  return [...latest.values()];
}

export function readFilters(params: URLSearchParams): CatalogFilters {
  const origin = params.get('origin');
  return {
    origin: isOrigin(origin) ? origin : undefined,
    components: (params.get('components') ?? '').split(',').filter(isComponent),
    category: params.get('category') || undefined,
    canInstall: params.get('mine') === '1',
    search: params.get('q') ?? '',
  };
}

/** Writes the filters over `params`, leaving every other parameter as it was. */
export function writeFilters(params: URLSearchParams, filters: CatalogFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  const values = {
    origin: filters.origin,
    components: filters.components.join(','),
    category: filters.category,
    mine: filters.canInstall ? '1' : '',
    q: filters.search,
  };
  for (const [name, value] of Object.entries(values)) {
    if (value) next.set(name, value);
    else next.delete(name);
  }
  return next;
}
