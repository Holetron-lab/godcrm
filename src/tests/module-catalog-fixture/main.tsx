import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { NO_FILTERS } from '@/features/module-catalog/catalog';
import { ModuleCatalog } from '@/features/module-catalog/ModuleCatalog';
import { modules } from '@/features/module-catalog/__tests__/fixtures';
import type { CatalogFilters, CatalogModule } from '@/features/module-catalog/types';
import type { MaxCols } from '@/shared/components/ui/MaxColsSelector';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
document.documentElement.lang = params.get('lang') || 'en';
localStorage.setItem('god-crm-language', document.documentElement.lang);

// Stands in for the registry: the same filters the server applies (ModuleRegistryService.listModuleRegistry).
const registry = (filters: CatalogFilters): CatalogModule[] => modules.filter(module =>
  (!filters.origin || module.origin === filters.origin)
  && filters.components.every(component => module.components.includes(component))
  && (!filters.category || module.category === filters.category)
  && (!filters.canInstall || module.can_install)
  && (module.blueprint.title ?? module.key).toLowerCase().includes(filters.search.trim().toLowerCase()));

function Fixture() {
  const [filters, setFilters] = useState<CatalogFilters>(NO_FILTERS);
  const [installed, setInstalled] = useState('');
  const [maxCols, setMaxCols] = useState<MaxCols>(6);
  return <main className="min-h-screen bg-[var(--bg-primary)] p-4">
    <ModuleCatalog modules={registry(filters)} categories={['general', 'support']} filters={filters} onFiltersChange={setFilters}
      onInstall={module => setInstalled(module.key)} moduleHref={module => `/modules/${module.id}`} maxCols={maxCols} onMaxColsChange={setMaxCols} onRetry={() => undefined} />
    <output aria-label="Filters" className="sr-only">{JSON.stringify(filters)}</output>
    <output aria-label="Installed" className="sr-only">{installed}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<MemoryRouter><LanguageProvider><Fixture /></LanguageProvider></MemoryRouter>);
