/**
 * PublicLayout — layout for public (unauthenticated) pages.
 *
 * ADR-105: AC3, AC4 — clean, no auth UI.
 * ADR-0060 P2/P4 polish: theme-aware (sun/moon toggle in header), glass sidebar
 * when public tree has content.
 * ADR-0060-A A1: mounts the internal `<Sidebar mode='public'>` so the public
 * surface inherits the authed sidebar's layout pixel-for-pixel; no parallel
 * `PublicSpaceSidebar` tree.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Globe, Menu, X } from 'lucide-react';

import { publicApi, type PublicTree } from './publicApi';
import { PublicViewProvider } from './PublicViewContext';
import { Sidebar } from '@/shared/components/layout/Sidebar';
import type { ProjectContentWidget } from '@/shared/components/layout/project-content';
import { ThemeToggle } from '@/shared/components/layout/ThemeToggle';
import { LanguageSwitcher } from '@/shared/components/layout/LanguageSwitcher';
import { AIChatStubProvider } from '@/features/ai-chat';

function hasAnyChildren(tree: PublicTree | undefined): tree is PublicTree {
  if (!tree || !Array.isArray(tree.projects) || tree.projects.length === 0) return false;
  // Tables alone don't earn a sidebar — viewer sees only dashboards/widgets.
  return tree.projects.some(
    (p) => p.dashboards.length > 0 || p.widgets.length > 0,
  );
}

export function PublicLayout() {
  const { slug } = useParams<{ slug: string }>();

  // Tree fetched once per slug; silent fallback on any failure (404, network).
  const treeQuery = useQuery({
    queryKey: ['publicTree', slug],
    queryFn: () => publicApi.getTree(slug as string).then((r) => r.data),
    enabled: !!slug,
    staleTime: 60_000,
    retry: false,
  });

  const tree = treeQuery.data;
  const sidebarHidden = tree?.space.public_sidebar?.hidden === true;
  const sidebarDefaultOpen = tree?.space.public_sidebar?.default_open !== false;
  const showSidebar = !sidebarHidden && !!slug && hasAnyChildren(tree);

  // ---- Adapt PublicTree → Sidebar shape ----------------------------------
  const sidebarSpaces = useMemo(() => {
    if (!tree) return [];
    return [
      {
        id: tree.space.id,
        name: tree.space.name,
        icon: tree.space.icon,
        type: 'public',
        projects_count: tree.projects.length,
      },
    ];
  }, [tree]);

  const sidebarProjects = useMemo(() => {
    if (!tree) return [];
    return tree.projects.map((p) => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      logo: null,
      space_id: tree.space.id,
    }));
  }, [tree]);

  const widgetsByProject = useMemo<Record<number, ProjectContentWidget[]>>(() => {
    if (!tree) return {};
    const out: Record<number, ProjectContentWidget[]> = {};
    for (const p of tree.projects) {
      out[p.id] = p.widgets.map((w) => ({
        id: w.id,
        title: w.name,
        icon: w.icon ?? undefined,
      }));
    }
    return out;
  }, [tree]);

  // ---- Local sidebar state (collapsed defaults match PublicSpaceSidebar) -
  const [expandedSpaces, setExpandedSpaces] = useState<Set<number>>(new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!tree) return;
    setExpandedSpaces(new Set([tree.space.id]));
    setExpandedProjects(new Set(tree.projects.map((p) => p.id)));
  }, [tree]);

  const toggleSpace = (spaceId: number) =>
    setExpandedSpaces((prev) => {
      const next = new Set(prev);
      if (next.has(spaceId)) next.delete(spaceId);
      else next.add(spaceId);
      return next;
    });

  const toggleProject = (projectId: number) =>
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });

  // ---- Responsive sidebar visibility (mirrors internal Layout.tsx) -------
  // On desktop: hamburger toggles `isSidebarLocked` (relative, in flow).
  // On mobile: hamburger toggles `isSidebarOpen` (overlay).
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 768,
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 768,
  );
  const [isSidebarLocked, setIsSidebarLocked] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 768,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setIsSidebarOpen(false);
        setIsSidebarLocked(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Seed initial sidebar state from owner prefs once the tree resolves.
  // Mobile always starts collapsed (overlay); desktop honours `default_open`.
  const prefsAppliedRef = useRef(false);
  useEffect(() => {
    if (prefsAppliedRef.current) return;
    if (!tree) return;
    prefsAppliedRef.current = true;
    if (isMobile) return;
    if (!sidebarDefaultOpen) {
      setIsSidebarOpen(false);
      setIsSidebarLocked(false);
    }
  }, [tree, isMobile, sidebarDefaultOpen]);

  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarHoverTimerRef = useRef<number | null>(null);

  return (
    <AIChatStubProvider>
    <PublicViewProvider readOnly publicSlug={slug ?? null}>
    <div className="flex h-screen flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* ---- Header ---- */}
      <header className="sticky top-0 z-30 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]/80 backdrop-blur-sm">
        <div className="flex h-14 items-center justify-between gap-3 px-4 py-2">
          {/* Left: hamburger (always-visible when sidebar exists) + space home link */}
          <div className="flex items-center gap-2 min-w-0">
            {showSidebar && (
              <button
                type="button"
                onClick={() => {
                  if (isMobile) {
                    setIsSidebarOpen((prev) => !prev);
                  } else if (isSidebarLocked) {
                    setIsSidebarLocked(false);
                    setIsSidebarOpen(false);
                  } else {
                    setIsSidebarLocked(true);
                    setIsSidebarOpen(true);
                  }
                }}
                className={`flex-shrink-0 p-2 rounded-lg transition-colors ${
                  (isMobile && isSidebarOpen) || (!isMobile && isSidebarLocked)
                    ? 'bg-[var(--bg-tertiary)]'
                    : 'hover:bg-[var(--bg-tertiary)]'
                }`}
                aria-label={
                  isMobile
                    ? (isSidebarOpen ? 'Hide menu' : 'Show menu')
                    : (isSidebarLocked ? 'Hide sidebar' : 'Show sidebar')
                }
                aria-expanded={isMobile ? isSidebarOpen : isSidebarLocked}
                title={
                  isMobile
                    ? (isSidebarOpen ? 'Hide menu' : 'Show menu')
                    : (isSidebarLocked ? 'Hide sidebar' : 'Show sidebar')
                }
              >
                {(isMobile && isSidebarOpen) || (!isMobile && isSidebarLocked) ? (
                  <X className="h-5 w-5" />
                ) : (
                  <Menu className="h-5 w-5" />
                )}
              </button>
            )}
            <Link
              to={slug ? `/s/${slug}` : '/'}
              className="flex items-center gap-2 min-w-0 text-[var(--text-primary)] transition-colors hover:text-[var(--color-primary-500)]"
            >
              <Globe className="h-5 w-5 flex-shrink-0 text-[var(--color-primary-500)]" />
              <span className="text-sm font-semibold tracking-tight truncate">
                {tree?.space?.name || 'Public Space'}
              </span>
            </Link>
          </div>

          {/* Right: language + theme + powered-by */}
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
            <a
              href="https://godcrm.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
            >
              Powered by <span className="font-medium text-[var(--text-secondary)]">GOD CRM</span>
            </a>
          </div>
        </div>
      </header>

      {/* ---- Body: internal Sidebar (mode='public') + content ---- */}
      {showSidebar && tree ? (
        <div className="flex flex-1 min-h-0 relative overflow-hidden">
          {/* Mobile overlay backdrop — click to close */}
          {isMobile && isSidebarOpen && (
            <div
              className="absolute inset-0 bg-black/50 z-40"
              onClick={() => setIsSidebarOpen(false)}
            />
          )}

          {/* Desktop hover-strip to peek collapsed sidebar (parity with Layout.tsx) */}
          {!isMobile && !isSidebarOpen && !isSidebarLocked && (
            <div
              className="absolute left-0 top-0 bottom-0 w-4 z-[60] hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer"
              onMouseEnter={() => {
                if (sidebarHoverTimerRef.current) {
                  window.clearTimeout(sidebarHoverTimerRef.current);
                }
                sidebarHoverTimerRef.current = window.setTimeout(() => {
                  setIsSidebarOpen(true);
                }, 500);
              }}
              onMouseLeave={() => {
                if (sidebarHoverTimerRef.current) {
                  window.clearTimeout(sidebarHoverTimerRef.current);
                  sidebarHoverTimerRef.current = null;
                }
              }}
              aria-hidden="true"
            />
          )}

          <Sidebar
            spaces={sidebarSpaces}
            projects={sidebarProjects}
            currentProject={null}
            currentSpace={sidebarSpaces[0] ?? null}
            expandedSpaces={expandedSpaces}
            expandedProjects={expandedProjects}
            toggleSpace={toggleSpace}
            toggleProject={toggleProject}
            setExpandedSpaces={setExpandedSpaces}
            setExpandedProjects={setExpandedProjects}
            selectProject={() => undefined}
            isMobile={isMobile}
            isSidebarOpen={isSidebarOpen}
            isSidebarLocked={isSidebarLocked}
            sidebarWidth={300}
            isResizing={false}
            sidebarRef={sidebarRef}
            setIsSidebarOpen={setIsSidebarOpen}
            handleResizeStart={() => undefined}
            mode="public"
            publicSlug={slug as string}
            widgetsByProject={widgetsByProject}
          />
          <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden bg-[var(--bg-primary)] p-[3px] sm:p-[6px] lg:p-[12px]">
            <Outlet />
          </main>
        </div>
      ) : (
        <main className="mx-auto w-full max-w-5xl flex-1 min-h-0 overflow-y-auto px-4 py-8 sm:px-6">
          <Outlet />
        </main>
      )}

      {/* ---- Footer (status-bar thin strip) ---- */}
      <footer className="h-7 flex-shrink-0 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-3 px-4 text-[11px] leading-none text-[var(--text-tertiary)] sm:px-6">
          <span className="truncate">
            &copy; {new Date().getFullYear()} GOD CRM
          </span>
          <div className="flex flex-shrink-0 gap-3">
            <a
              href="https://crm.hltrn.cc/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-[var(--text-secondary)]"
            >
              Privacy
            </a>
            <a
              href="https://crm.hltrn.cc/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-[var(--text-secondary)]"
            >
              Terms
            </a>
          </div>
        </div>
      </footer>
    </div>
    </PublicViewProvider>
    </AIChatStubProvider>
  );
}
