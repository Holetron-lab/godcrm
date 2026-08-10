/**
 * PublicSpaceSidebar — read-only sidebar for public spaces (ADR-0060 P2 / P4 polish).
 *
 * Visual parity with the main app's `Sidebar.tsx`:
 *  - glass `aside` container (var(--sidebar-glass-bg/border))
 *  - space card with `var(--sidebar-card-bg/header)`
 *  - ▼/▶ chevron toggles (not SVG)
 *  - project card per project; inside: dashboards + widgets only
 *
 * Viewer scope: like a non-privileged user in the main app, public viewers
 * see Dashboards and Modules (widgets) — not raw data tables. Tables stay
 * reachable directly via /s/:slug/tables/:id (deep links work) but are not
 * surfaced in the navigation tree.
 *
 * Mobile (<768 px): collapses behind a hamburger; drawer overlays, never pushes.
 */

import { useCallback, useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import type { PublicTree, PublicTreeProject } from './publicApi';

interface PublicSpaceSidebarProps {
  tree: PublicTree;
  slug: string;
}

const SIDEBAR_WIDTH_CLASS = 'w-[300px]';

function ProjectSection({
  project,
  slug,
  expanded,
  onToggle,
}: {
  project: PublicTreeProject;
  slug: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onToggle}
          className="p-1 hover:bg-[rgba(255,255,255,0.1)] rounded transition"
        >
          <span className="text-xs text-[var(--text-tertiary)]">
            {expanded ? '▼' : '▶'}
          </span>
        </button>
        <NavLink
          to={`/s/${slug}/projects/${project.id}`}
          className={({ isActive }) =>
            cn(
              'flex-1 flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors',
              isActive
                ? 'bg-[var(--color-primary-500)]/15 text-[var(--color-primary-500)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]',
            )
          }
        >
          <span className="text-base">{project.icon || '📁'}</span>
          <span className="flex-1 truncate">{project.name}</span>
        </NavLink>
      </div>

      {expanded && (
        <div className="pl-6 space-y-3">
          {project.dashboards.length > 0 && (
            <div>
              <p className="mb-1 px-2 text-xs font-medium text-[var(--text-tertiary)]">
                📊 Dashboards
              </p>
              <div className="space-y-1">
                {project.dashboards.map((dashboard) => (
                  <NavLink
                    key={dashboard.id}
                    to={`/s/${slug}/dashboards/${dashboard.id}`}
                    className={({ isActive }) =>
                      cn(
                        'block rounded px-3 py-1.5 text-xs transition',
                        isActive
                          ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]',
                      )
                    }
                  >
                    {dashboard.icon || '📄'} {dashboard.name}
                  </NavLink>
                ))}
              </div>
            </div>
          )}

          {project.widgets.length > 0 && (
            <div>
              <p className="mb-1 px-2 text-xs font-medium text-[var(--text-tertiary)]">
                🎨 Модули
              </p>
              <div className="space-y-1">
                {project.widgets.map((widget) => (
                  <NavLink
                    key={widget.id}
                    to={`/s/${slug}/widgets/${widget.id}`}
                    className={({ isActive }) =>
                      cn(
                        'block rounded px-3 py-1.5 text-xs transition',
                        isActive
                          ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]',
                      )
                    }
                  >
                    {widget.icon || '🎨'} {widget.name}
                  </NavLink>
                ))}
              </div>
            </div>
          )}

          {project.dashboards.length === 0 && project.widgets.length === 0 && (
            <p className="px-2 py-1 text-[10px] italic text-[var(--text-tertiary)]">
              Пусто
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SidebarBody({
  tree,
  slug,
  onNavigate,
}: {
  tree: PublicTree;
  slug: string;
  onNavigate?: () => void;
}) {
  const [spaceExpanded, setSpaceExpanded] = useState(true);
  const [expandedProjects, setExpandedProjects] = useState<Set<number>>(
    () => new Set(tree.projects.map((p) => p.id)),
  );

  const toggleProject = useCallback((projectId: number) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  return (
    <div className="flex-1 space-y-3 p-4 pb-0 overflow-y-auto sidebar-scroll">
      <div className="rounded-xl border border-[var(--sidebar-glass-border)] overflow-hidden backdrop-blur-sm bg-[var(--sidebar-card-bg)] shadow-sm">
        {/* Space Header */}
        <div className="flex items-center bg-[var(--sidebar-card-header)]">
          <button
            type="button"
            onClick={() => setSpaceExpanded((v) => !v)}
            className="p-3 hover:bg-[var(--bg-tertiary)] transition-colors"
            aria-label={spaceExpanded ? 'Collapse space' : 'Expand space'}
          >
            <span className="text-xs text-[var(--text-tertiary)]">
              {spaceExpanded ? '▼' : '▶'}
            </span>
          </button>
          <NavLink
            to={`/s/${slug}`}
            end
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex-1 py-3 pr-2 text-sm font-semibold transition-colors flex items-center gap-1',
                isActive
                  ? 'text-[var(--color-primary-400)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
              )
            }
          >
            {tree.space.icon && <span className="mr-1">{tree.space.icon}</span>}
            <span className="flex-1 truncate">{tree.space.name}</span>
          </NavLink>
        </div>

        {/* Divider */}
        <div className="h-px bg-white/20 dark:bg-white/10" />

        {/* Projects */}
        {spaceExpanded && (
          <div className="space-y-1 p-3 bg-white/10 dark:bg-black/10">
            {tree.projects.length === 0 ? (
              <p className="px-2 py-1 text-xs italic text-[var(--text-tertiary)]">
                Нет публичных проектов
              </p>
            ) : (
              tree.projects.map((project) => (
                <div key={project.id} onClick={onNavigate}>
                  <ProjectSection
                    project={project}
                    slug={slug}
                    expanded={expandedProjects.has(project.id)}
                    onToggle={() => toggleProject(project.id)}
                  />
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function PublicSpaceSidebar({ tree, slug }: PublicSpaceSidebarProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setDrawerOpen(false);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return (
    <>
      {/* Mobile hamburger toggle */}
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        className="fixed left-3 top-3 z-40 flex h-9 w-9 items-center justify-center rounded-md border border-[var(--sidebar-glass-border)] bg-[var(--bg-primary)] shadow-sm md:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-4 w-4 text-[var(--text-secondary)]" />
      </button>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden shrink-0 border-r border-[var(--sidebar-glass-border)] backdrop-blur-2xl backdrop-saturate-150 bg-[var(--sidebar-glass-bg)] shadow-[0_8px_32px_rgba(0,0,0,0.1)] md:flex md:flex-col',
          SIDEBAR_WIDTH_CLASS,
        )}
      >
        <SidebarBody tree={tree} slug={slug} />
      </aside>

      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <aside
            className={cn(
              'fixed left-0 top-0 z-50 h-full w-[80vw] max-w-[320px] flex flex-col border-r border-[var(--sidebar-glass-border)] backdrop-blur-2xl backdrop-saturate-150 bg-[var(--sidebar-glass-bg)] shadow-xl md:hidden',
            )}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex h-12 items-center justify-end px-3">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--bg-tertiary)]"
                aria-label="Close navigation"
              >
                <X className="h-4 w-4 text-[var(--text-secondary)]" />
              </button>
            </div>
            <SidebarBody tree={tree} slug={slug} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </>
      )}
    </>
  );
}
