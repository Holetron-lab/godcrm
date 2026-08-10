import { useState, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { SpaceModel } from '@/features/spaces/types/space.types';

interface Space extends SpaceModel {
  projects?: Array<{
    id: number;
    name: string;
    icon?: string;
    dashboards?: Array<{ id: number; name: string; icon?: string }>;
    tables?: Array<{ id: number; name: string; icon?: string }>;
    widgets?: Array<{ id: number; name: string; icon?: string }>;
  }>;
}

interface SpaceSidebarProps {
  spaces: Space[];
  activeSpaceId?: number | null;
  activeProjectId?: number | null;
  onSpaceClick: (spaceId: number) => void;
  onProjectClick: (projectId: number) => void;
}

/**
 * Space Sidebar Navigation - правильная иерархия
 * 
 * SPACE (Workspace)
 *   └── PROJECT
 *        ├── Dashboards (страницы с виджетами)
 *        ├── Tables (данные)
 *        └── Modules (модули - 1 модуль = 1 страница)
 */
export const SpaceSidebar = ({
  spaces,
  activeSpaceId,
  activeProjectId,
  onSpaceClick,
  onProjectClick
}: SpaceSidebarProps) => {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const [expandedSpaces, setExpandedSpaces] = useState<Set<number>>(new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<number>>(new Set());

  const toggleSpace = useCallback((spaceId: number) => {
    setExpandedSpaces(prev => {
      const next = new Set(prev);
      if (next.has(spaceId)) {
        next.delete(spaceId);
      } else {
        next.add(spaceId);
      }
      return next;
    });
    onSpaceClick(spaceId);
  }, [onSpaceClick]);

  const toggleProject = useCallback((projectId: number) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
    onProjectClick(projectId);
  }, [onProjectClick]);

  return (
    <div className="space-y-2">
      {spaces.map((space) => {
        const isSpaceExpanded = expandedSpaces.has(space.id);
        const isSpaceActive = space.id === activeSpaceId;

        return (
          <div key={space.id} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)]">
            {/* SPACE Header */}
            <button
              type="button"
              onClick={() => toggleSpace(space.id)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold transition ${
                isSpaceActive
                  ? 'text-[var(--color-primary-600)]'
                  : 'text-gray-900 dark:text-[var(--text-primary)] hover:text-[var(--color-primary-400)]'
              }`}
            >
              <span className="text-base">{space.icon || '📁'}</span>
              <span className="flex-1">{space.name}</span>
              <svg
                className={`h-4 w-4 transition-transform ${isSpaceExpanded ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {/* PROJECTS List */}
            {isSpaceExpanded && space.projects && space.projects.length > 0 && (
              <div className="border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2">
                {space.projects.map((project) => {
                  const isProjectExpanded = expandedProjects.has(project.id);
                  const isProjectActive = project.id === activeProjectId;

                  return (
                    <div key={project.id} className="mb-2 rounded-md border border-[var(--border-secondary)]">
                      {/* PROJECT Header */}
                      <button
                        type="button"
                        onClick={() => toggleProject(project.id)}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium transition ${
                          isProjectActive
                            ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)]'
                            : 'text-gray-900 dark:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                        }`}
                      >
                        <span>{project.icon || '📊'}</span>
                        <span className="flex-1">{project.name}</span>
                        <svg
                          className={`h-3 w-3 transition-transform ${isProjectExpanded ? 'rotate-90' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>

                      {/* PROJECT Content */}
                      {isProjectExpanded && (
                        <div className="space-y-3 p-2">
                          {/* Dashboards Section */}
                          {project.dashboards && project.dashboards.length > 0 && (
                            <div>
                              <p className="mb-1 px-2 text-xs font-medium text-gray-800 dark:text-[var(--text-tertiary)]">📊 Dashboards</p>
                              <div className="space-y-1">
                                {project.dashboards.map((dashboard) => (
                                  <NavLink
                                    key={dashboard.id}
                                    to={`/projects/${project.id}/dashboards/${dashboard.id}`}
                                    className={({ isActive }) =>
                                      `block rounded px-3 py-1.5 text-xs transition ${
                                        isActive
                                          ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)]'
                                          : 'text-gray-900 dark:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                                      }`
                                    }
                                  >
                                    {dashboard.icon || '📄'} {dashboard.name}
                                  </NavLink>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Tables Section */}
                          {project.tables && project.tables.length > 0 && (
                            <div>
                              <p className="mb-1 px-2 text-xs font-medium text-gray-800 dark:text-[var(--text-tertiary)]">📋 Tables</p>
                              <div className="space-y-1">
                                {project.tables.map((table) => (
                                  <NavLink
                                    key={table.id}
                                    to={`/tables/${table.id}`}
                                    className={({ isActive }) =>
                                      `block rounded px-3 py-1.5 text-xs transition ${
                                        isActive
                                          ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)]'
                                          : 'text-gray-900 dark:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                                      }`
                                    }
                                  >
                                    {table.icon || '📊'} {table.name}
                                  </NavLink>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Modules Section (1 модуль = 1 страница) */}
                          {project.widgets && project.widgets.length > 0 && (
                            <div>
                              <p className="mb-1 px-2 text-xs font-medium text-gray-800 dark:text-[var(--text-tertiary)]">🎨 {t('Модули', 'Modules')}</p>
                              <div className="space-y-1">
                                {project.widgets.map((widget) => (
                                  <NavLink
                                    key={widget.id}
                                    to={`/projects/${project.id}/widgets/${widget.id}`}
                                    className={({ isActive }) =>
                                      `block rounded px-3 py-1.5 text-xs transition ${
                                        isActive
                                          ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)]'
                                          : 'text-gray-900 dark:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                                      }`
                                    }
                                  >
                                    {widget.icon || '🎨'} {widget.name}
                                  </NavLink>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
