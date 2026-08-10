import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SpacesList } from '@/features/spaces/components/SpacesList';
import { CreateSpaceModal } from '@/features/spaces/components/CreateSpaceModal';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useSpacesQuery } from '@/features/spaces/hooks/useSpacesQuery';
import { setPageTitle } from '@/shared/utils/pageTitle';
import { DashboardGrid } from '@/features/widgets';
import { AddWidgetModal } from '@/features/widgets/components/AddWidgetModal';
import { apiClient } from '@/shared/utils/apiClient';
import type { SpaceType } from '@/features/spaces/types/space.types';
import { Plus, Edit, X, Search, Columns, Filter, User as UserIcon } from 'lucide-react';

const MAX_COLS_STORAGE_KEY = 'god-crm-spaces-maxcols';
const MAX_COLS_OPTIONS = [4, 5, 6, 7, 8] as const;
const DEFAULT_MAX_COLS = 6;
const TYPE_FILTER_OPTIONS: readonly (SpaceType | 'all')[] = ['all', 'personal', 'business', 'team', 'admin'] as const;

const loadMaxCols = (): number => {
  try {
    const raw = localStorage.getItem(MAX_COLS_STORAGE_KEY);
    if (!raw) return DEFAULT_MAX_COLS;
    const n = Number.parseInt(raw, 10);
    return MAX_COLS_OPTIONS.includes(n as typeof MAX_COLS_OPTIONS[number]) ? n : DEFAULT_MAX_COLS;
  } catch {
    return DEFAULT_MAX_COLS;
  }
};

/**
 * Spaces Page - главная страница после логина
 *
 * Секции:
 * 1. Spaces (workspaces) со статистикой
 * 2. Quick Access widgets
 * 3. Community & Marketplace
 */
const SpacesPage = () => {
  const { t } = useLanguage();
  const { data: spaces = [] } = useSpacesQuery();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isQuickAccessEditable, setIsQuickAccessEditable] = useState(false);
  const [showAddWidgetModal, setShowAddWidgetModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<SpaceType | 'all'>('all');
  const [userFilter, setUserFilter] = useState<number | 'all'>('all');
  const [maxCols, setMaxColsState] = useState<number>(loadMaxCols);

  const setMaxCols = (n: number) => {
    setMaxColsState(n);
    try { localStorage.setItem(MAX_COLS_STORAGE_KEY, String(n)); } catch {}
  };

  // Fetch home dashboard for Quick Access widgets
  const { data: homeDashboard } = useQuery({
    queryKey: ['home-dashboard'],
    queryFn: async () => {
      const response = await apiClient.get<{ success: boolean; data: { id: number; name: string } }>('/user-settings/home-dashboard');
      return response.data;
    },
  });

  // Member dropdown options — built from the union of users that appear
  // in any space's users-table (deduped by system_user_id). This narrows
  // the list to people who actually participate somewhere instead of
  // every system user, and matches the membership filter we apply below.
  const memberOptions = useMemo(() => {
    const byId = new Map<number, string>();
    for (const space of spaces) {
      const users = (space as { users?: { system_user_id?: number | null; name?: string }[] }).users || [];
      for (const u of users) {
        const sid = u.system_user_id;
        if (sid == null || !Number.isFinite(sid)) continue;
        if (!byId.has(sid)) byId.set(sid, u.name || `#${sid}`);
      }
    }
    return Array.from(byId.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [spaces]);

  const stats = useMemo(() => {
    const totalSpaces = spaces.length;
    const totalProjects = spaces.reduce((acc, s) => {
      const count = Number(s.projects_count) || 0;
      return acc + count;
    }, 0);
    const totalDashboards = spaces.reduce((acc, s) => {
      const count = Number(s.dashboards_count) || 0;
      return acc + count;
    }, 0);
    return { totalSpaces, totalProjects, totalDashboards };
  }, [spaces]);

  useEffect(() => {
    setPageTitle(t('spaces.pageTitle') || 'Workspaces');
  }, [t]);

  // Page width tracks maxCols: TARGET_SLOT_PX × N + gaps. Selector resizes
  // the entire page (Spaces grid + Quick Access + sections below).
  const pageMaxWidthPx = maxCols * 220 + (maxCols - 1) * 16;

  return (
    <div className="bg-[var(--bg-primary)] p-4 md:p-6">
      <div className="mx-auto space-y-8" style={{ maxWidth: `${pageMaxWidthPx}px` }}>
        
        {/* === SPACES SECTION === */}
        <section>
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-[0.1em]">
                GOD CRM
              </h1>
              <p className="mt-0.5 text-xs text-[var(--text-tertiary)] tracking-wide">
                Generative Orchestration & Development · Critical Resource Manager
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-2 rounded-lg bg-[var(--color-primary-600)] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[var(--color-primary-700)]"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {t('spaces.createButton') || 'Create'}
            </button>
          </div>

          {/* Stats row - inline */}
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--text-tertiary)]">
            <span>{stats.totalSpaces} {t('spaces.stats.workspaces') || 'workspaces'}</span>
            <span>•</span>
            <span>{stats.totalProjects} {t('spaces.stats.projects') || 'projects'}</span>
            <span>•</span>
            <span>{stats.totalDashboards} {t('spaces.stats.dashboards') || 'dashboards'}</span>
          </div>

          {/* Toolbar: search + filters + max columns selector */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('spaces.toolbar.searchPlaceholder') || 'Search workspaces...'}
                className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] py-1.5 pl-8 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--color-primary-400)] focus:outline-none"
              />
            </div>

            <label className="flex items-center gap-1.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-tertiary)]">
              <Filter className="h-3.5 w-3.5" />
              <span className="sr-only">{t('spaces.toolbar.typeFilter') || 'Type'}</span>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as SpaceType | 'all')}
                className="bg-transparent py-0.5 pr-1 text-xs font-medium text-[var(--text-secondary)] focus:outline-none"
              >
                {TYPE_FILTER_OPTIONS.map((opt) => (
                  <option key={opt} value={opt} className="bg-[var(--bg-secondary)]">
                    {opt === 'all'
                      ? (t('spaces.toolbar.allTypes') || 'All types')
                      : (t(`spaces.types.${opt}`) || opt)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-1.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-tertiary)]">
              <UserIcon className="h-3.5 w-3.5" />
              <span className="sr-only">{t('spaces.toolbar.userFilter') || 'Member'}</span>
              <select
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                className="bg-transparent py-0.5 pr-1 text-xs font-medium text-[var(--text-secondary)] focus:outline-none max-w-[180px]"
              >
                <option value="all" className="bg-[var(--bg-secondary)]">
                  {t('spaces.toolbar.allUsers') || 'All members'}
                </option>
                {memberOptions.map((u) => (
                  <option key={u.id} value={u.id} className="bg-[var(--bg-secondary)]">
                    {u.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-tertiary)]">
              <Columns className="h-3.5 w-3.5" />
              <span>{t('spaces.toolbar.maxCols') || 'Max cols'}:</span>
              <div className="flex items-center gap-0.5">
                {MAX_COLS_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setMaxCols(n)}
                    className={`min-w-[24px] rounded px-1.5 py-0.5 text-xs font-medium transition-colors ${
                      maxCols === n
                        ? 'bg-[var(--color-primary-500)] text-white'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <SpacesList
            searchQuery={searchQuery}
            maxCols={maxCols}
            typeFilter={typeFilter}
            userFilter={userFilter}
          />
        </section>

        {/* === QUICK ACCESS WIDGETS === */}
        <section className="border-t border-[var(--border-primary)] pt-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-medium text-[var(--text-primary)]">
              ⚡ {t('home.quickAccess.title') || 'Quick Access'}
            </h2>
            <div className="flex items-center gap-2">
              {isQuickAccessEditable && (
                <button
                  type="button"
                  onClick={() => setShowAddWidgetModal(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--color-primary-500)] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[var(--color-primary-600)]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('home.quickAccess.addWidget') || 'Add Widget'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsQuickAccessEditable(!isQuickAccessEditable)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  isQuickAccessEditable 
                    ? 'bg-red-500 text-white hover:bg-red-600' 
                    : 'border border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {isQuickAccessEditable ? <X className="h-3.5 w-3.5" /> : <Edit className="h-3.5 w-3.5" />}
                {isQuickAccessEditable ? t('common.done') || 'Done' : t('common.edit') || 'Edit'}
              </button>
            </div>
          </div>
          
          {/* Dashboard Grid for Quick Access widgets */}
          {homeDashboard ? (
            <div className="min-h-[120px]">
              <DashboardGrid
                dashboardId={homeDashboard.id}
                isEditable={isQuickAccessEditable}
                borderRadius={12}
                widgetGap={12}
              />
            </div>
          ) : (
            <div className="rounded-xl border-2 border-dashed border-[var(--border-primary)] bg-[var(--bg-secondary)] p-8 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-tertiary)]">
                <svg className="h-6 w-6 text-[var(--text-tertiary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                </svg>
              </div>
              <p className="text-sm text-[var(--text-tertiary)]">{t('common.loading') || 'Loading...'}</p>
            </div>
          )}
        </section>

        {/* === COMMUNITY & MARKETPLACE === */}
        <section className="border-t border-[var(--border-primary)] pt-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Community */}
            <div className="flex flex-col rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-medium text-[var(--text-primary)]">
                💬 {t('home.community.title') || 'Community'}
              </h2>
              <div className="flex flex-wrap gap-3">
                <a
                  href="https://github.com/holetron"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm transition-colors hover:border-[var(--color-primary-400)]"
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                  GitHub
                </a>
                <a
                  href="https://x.com/god_crm"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm transition-colors hover:border-[var(--color-primary-400)]"
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                  X
                </a>
                <a
                  href="https://t.me/god_crm"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm transition-colors hover:border-[var(--color-primary-400)]"
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                  Telegram
                </a>
              </div>
            </div>

            {/* Marketplace */}
            <div className="flex flex-col rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="flex items-center gap-2 text-lg font-medium text-[var(--text-primary)]">
                  🛒 {t('home.marketplace.title') || 'Marketplace'}
                  <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400">
                    {t('common.comingSoon') || 'Coming Soon'}
                  </span>
                </h2>
                <button
                  disabled
                  className="rounded-lg border border-amber-500/30 px-3 py-1.5 text-sm font-medium text-amber-500/50 cursor-not-allowed"
                >
                  {t('home.marketplace.notify') || 'Notify Me'}
                </button>
              </div>
              <p className="text-sm text-[var(--text-tertiary)] mb-3">
                {t('home.marketplace.comingSoonDescription') || 'Buy and sell widgets, templates and integrations. Earn 90% from sales.'}
              </p>
              <div className="flex flex-wrap gap-2 text-xs text-[var(--text-tertiary)]">
                <span className="rounded border border-[var(--border-primary)] px-2 py-1">🧙 TableWizard</span>
                <span className="rounded border border-[var(--border-primary)] px-2 py-1">Widgets</span>
                <span className="rounded border border-[var(--border-primary)] px-2 py-1">Templates</span>
                <span className="rounded border border-[var(--border-primary)] px-2 py-1">Integrations</span>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-[var(--border-primary)] pt-4 text-center text-xs text-[var(--text-tertiary)]">
          GOD CRM — MIT License — Made with ♥ by community
        </footer>
      </div>

      <CreateSpaceModal 
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onCreated={() => {}}
      />

      {/* Add Widget Modal for Quick Access */}
      {homeDashboard && (
        <AddWidgetModal
          isOpen={showAddWidgetModal}
          onClose={() => setShowAddWidgetModal(false)}
          dashboardId={homeDashboard.id}
          onWidgetCreated={() => setShowAddWidgetModal(false)}
        />
      )}
    </div>
  );
};

export default SpacesPage;
