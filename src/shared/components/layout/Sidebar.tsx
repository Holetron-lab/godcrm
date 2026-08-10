import { useCallback, useState, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { getSpaceAccessLevel, hasPrivilegedAccess } from '@/features/spaces/hooks/useSpaceAccessLevel';
import { ProjectContent, type ProjectContentWidget } from './project-content';
import { ProjectTablesNav } from './ProjectTablesNav';
import { MoreVertical, Search, X, Plus, Settings, GitMerge } from 'lucide-react';

interface SidebarSpace {
  id: number;
  name: string;
  icon?: string | null;
  type: string;
  projects_count?: number;
}

interface SidebarProject {
  id: number;
  name: string;
  icon?: string | null;
  logo?: string | null;
  space_id?: number | null;
}

interface CurrentProject {
  id: number;
  name: string;
}

export interface SidebarProps {
  spaces: SidebarSpace[];
  projects: SidebarProject[];
  currentProject: CurrentProject | null;
  currentSpace: SidebarSpace | null;
  expandedSpaces: Set<number>;
  expandedProjects: Set<number>;
  toggleSpace: (spaceId: number) => void;
  toggleProject: (projectId: number) => void;
  setExpandedSpaces: React.Dispatch<React.SetStateAction<Set<number>>>;
  setExpandedProjects: React.Dispatch<React.SetStateAction<Set<number>>>;
  selectProject: (id: number | null) => void;
  isMobile: boolean;
  isSidebarOpen: boolean;
  isSidebarLocked: boolean;
  sidebarWidth: number;
  isResizing: boolean;
  sidebarRef: React.RefObject<HTMLElement | null>;
  setIsSidebarOpen: (open: boolean) => void;
  handleResizeStart: (e: React.MouseEvent) => void;
  // Mutation triggers — only invoked in private mode; optional/no-op-safe in public.
  setIsCreateSpaceModalOpen?: (open: boolean) => void;
  setIsCreateProjectModalOpen?: (open: boolean) => void;
  setTargetSpaceId?: (id: number | null) => void;
  setEditSpaceId?: (id: number | null) => void;
  setIsEditSpaceModalOpen?: (open: boolean) => void;
  setActiveSpaceToolbar?: React.Dispatch<React.SetStateAction<number | null>>;
  activeSpaceToolbar?: number | null;
  // ADR-0060-A A1 — render in private (auth'd) or public (read-only) mode.
  mode?: 'private' | 'public';
  // Required when mode==='public' to build /s/:slug/... links.
  publicSlug?: string;
  // Public mode: pre-fetched widgets per project (PublicTree → projects[].widgets).
  widgetsByProject?: Record<number, ProjectContentWidget[]>;
}

export const Sidebar = ({
  spaces,
  projects,
  currentProject,
  currentSpace,
  expandedSpaces,
  expandedProjects,
  toggleSpace,
  toggleProject,
  setExpandedSpaces,
  setExpandedProjects,
  selectProject,
  isMobile,
  isSidebarOpen,
  isSidebarLocked,
  sidebarWidth,
  isResizing,
  sidebarRef,
  setIsSidebarOpen,
  handleResizeStart,
  setIsCreateSpaceModalOpen,
  setIsCreateProjectModalOpen,
  setTargetSpaceId,
  setEditSpaceId,
  setIsEditSpaceModalOpen,
  setActiveSpaceToolbar,
  activeSpaceToolbar = null,
  mode = 'private',
  publicSlug,
  widgetsByProject,
}: SidebarProps) => {
  const user = useAuthStore((state) => state.user);
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const isPublic = mode === 'public';

  // Search state for sidebar - track which space has active search
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [searchActiveSpaceId, setSearchActiveSpaceId] = useState<number | null>(null);

  return (
    <aside
      ref={sidebarRef as React.Ref<HTMLElement>}
      data-app-sidebar
      style={{ width: isMobile ? 256 : sidebarWidth }}
      className={`
        ${isMobile || !isSidebarLocked
          ? 'absolute left-0 top-0 bottom-0 z-50'
          : 'relative flex-shrink-0 z-50'
        }
        border-r border-[var(--sidebar-glass-border)]
        backdrop-blur-2xl backdrop-saturate-150
        bg-[var(--sidebar-glass-bg)]
        shadow-[0_8px_32px_rgba(0,0,0,0.1)]
        flex flex-col
        transition-transform duration-500 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        ${!isSidebarOpen ? 'pointer-events-none' : ''}
      `}
      onMouseLeave={() => !isMobile && !isSidebarLocked && setIsSidebarOpen(false)}
    >
      {/* Spaces Container - scrollable with overlay scrollbar and min-height */}
      <div
        className="flex-1 space-y-3 p-4 pb-0 overflow-y-auto sidebar-scroll"
        style={{ minHeight: '400px' }}
        data-testid="spaces-menu"
      >
        {/* DEBUG INFO */}
        {spaces.length === 0 && (
          <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded text-xs text-yellow-500">
            ⚠️ No spaces loaded! Check API/auth.
          </div>
        )}

        {/* All Spaces - sorted by user-defined order */}
        {spaces.map((space) => {
          const isSpaceExpanded = expandedSpaces.has(space.id);
          const spaceProjects = projects.filter(p => p.space_id === space.id);

          // Compute access level for this space (cast to satisfy SpaceModel).
          // In public mode there is no user — always treat as non-privileged
          // viewer and never filter spaces (public API already filtered them).
          const spaceAccessLevel = getSpaceAccessLevel(space as any, user);
          const isPrivileged = !isPublic && hasPrivilegedAccess(spaceAccessLevel);

          if (!isPublic && spaceAccessLevel === 'denied') {
            return null;
          }

          // Determine if this is the current/active space
          const isCurrentSpace = currentSpace?.id === space.id;
          const isToolbarOpen = activeSpaceToolbar === space.id;
          const spaceHref = isPublic
            ? `/s/${publicSlug ?? ''}`
            : `/spaces/${space.id}/dashboard`;

          return (
            <div key={`space-${space.id}`} className="rounded-xl border border-[var(--sidebar-glass-border)] overflow-hidden backdrop-blur-sm bg-[var(--sidebar-card-bg)] shadow-sm" data-testid="space-item">
              {/* Space Header - split: toggle arrow + clickable name */}
              <div className="flex items-center bg-[var(--sidebar-card-header)]">
                <button
                  type="button"
                  onClick={() => toggleSpace(space.id)}
                  className="p-3 hover:bg-[var(--bg-tertiary)] transition-colors"
                  data-testid={`space-toggle-${space.id}`}
                >
                  <span className="text-xs text-[var(--text-tertiary)]">
                    {isSpaceExpanded ? '▼' : '▶'}
                  </span>
                </button>
                <NavLink
                  to={spaceHref}
                  end={isPublic}
                  className={({ isActive }) =>
                    `flex-1 py-3 pr-2 text-sm font-semibold transition-colors ${
                      isActive || isCurrentSpace
                        ? 'text-[var(--color-primary-400)]'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`
                  }
                >
                  {space.icon && <span className="mr-1">{space.icon}</span>}{space.name}
                </NavLink>
                {/* Menu button for admins / Search button for non-admins.
                    Public mode: render the inline search button only (no
                    MoreVertical admin toolbar — AC-A1 hides mutation icons). */}
                {isPrivileged ? (
                  <button
                    type="button"
                    onClick={() => {
                      const willOpen = !isToolbarOpen;
                      setActiveSpaceToolbar?.(willOpen ? space.id : null);
                      // Expand space when opening toolbar (but keep projects collapsed)
                      if (willOpen) {
                        setExpandedSpaces(prev => new Set([...prev, space.id]));
                      }
                    }}
                    className={`p-2 hover:bg-[var(--bg-tertiary)] rounded transition-colors ${isToolbarOpen ? 'bg-[var(--bg-tertiary)]' : ''}`}
                    title={t('Меню пространства', 'Space menu')}
                  >
                    <MoreVertical className={`w-4 h-4 ${isToolbarOpen ? 'text-[var(--color-primary-500)]' : 'text-[var(--text-tertiary)] hover:text-[var(--color-primary-500)]'}`} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      // Expand only this space and its projects
                      setExpandedSpaces(prev => new Set([...prev, space.id]));
                      setExpandedProjects(new Set(spaceProjects.map(p => p.id)));
                      setSearchActiveSpaceId(searchActiveSpaceId === space.id ? null : space.id);
                      if (searchActiveSpaceId !== space.id) {
                        setSidebarSearch('');
                      }
                    }}
                    className={`p-2 hover:bg-[var(--bg-tertiary)] rounded transition-colors ${searchActiveSpaceId === space.id ? 'bg-[var(--bg-tertiary)]' : ''}`}
                    title={t('Поиск', 'Search')}
                  >
                    <Search className={`w-4 h-4 ${searchActiveSpaceId === space.id ? 'text-[var(--color-primary-500)]' : 'text-[var(--text-tertiary)] hover:text-[var(--color-primary-500)]'}`} />
                  </button>
                )}
              </div>

              {/* Divider line under space name */}
              <div className="h-px bg-white/20 dark:bg-white/10" />

              {/* Space Content - Projects */}
              {isSpaceExpanded && (
                <div className="space-y-1 p-3 bg-white/10 dark:bg-black/10">
                  {/* Admin Toolbar - unified element with search mode */}
                  {isPrivileged && isToolbarOpen && (
                    <div className="flex items-center gap-0.5 mb-2 p-1 bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded-lg">
                      {searchActiveSpaceId === space.id ? (
                        /* Search mode */
                        <>
                          <div className="flex-shrink-0 flex items-center justify-center p-1.5">
                            <Search className="w-3.5 h-3.5 text-[var(--color-primary-500)]" />
                          </div>
                          <input
                            type="text"
                            value={sidebarSearch}
                            onChange={(e) => setSidebarSearch(e.target.value)}
                            placeholder={t('Поиск...', 'Search...')}
                            className="flex-1 min-w-0 px-2 py-0.5 text-xs bg-transparent border-none focus:outline-none text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
                            autoFocus
                          />
                          {/* Vertical divider */}
                          <div className="w-px h-4 bg-[var(--border-secondary)] mx-0.5" />
                          <button
                            type="button"
                            onClick={() => {
                              setSidebarSearch('');
                              setSearchActiveSpaceId(null);
                              setExpandedProjects(new Set());
                            }}
                            className="flex-shrink-0 flex items-center justify-center p-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-white/10 rounded transition"
                            title={t('Закрыть поиск', 'Close search')}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        /* Toolbar mode */
                        <>
                          {/* Search area - icon + clickable zone */}
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedProjects(new Set(spaceProjects.map(p => p.id)));
                              setSearchActiveSpaceId(space.id);
                              setSidebarSearch('');
                            }}
                            className="flex-1 flex items-center gap-1.5 p-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-white/10 rounded transition"
                            title={t('Поиск', 'Search')}
                          >
                            <Search className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="text-xs opacity-50">{t('Поиск...', 'Search...')}</span>
                          </button>

                          {/* Vertical divider */}
                          <div className="w-px h-4 bg-[var(--border-secondary)] mx-0.5" />

                          {/* Create Project */}
                          <button
                            type="button"
                            onClick={() => {
                              setTargetSpaceId?.(space.id);
                              setIsCreateProjectModalOpen?.(true);
                              setActiveSpaceToolbar?.(null);
                            }}
                            className="flex items-center justify-center p-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-white/10 rounded transition"
                            title={t('Создать проект', 'Create project')}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>

                          {/* Edit Space Settings */}
                          <button
                            type="button"
                            onClick={() => {
                              setEditSpaceId?.(space.id);
                              setIsEditSpaceModalOpen?.(true);
                              setActiveSpaceToolbar?.(null);
                            }}
                            className="flex items-center justify-center p-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-white/10 rounded transition"
                            title={t('Настройки пространства', 'Space settings')}
                          >
                            <Settings className="w-3.5 h-3.5" />
                          </button>

                          {/* Schema Editor */}
                          <NavLink
                            to={`/spaces/${space.id}/schema`}
                            onClick={() => setActiveSpaceToolbar?.(null)}
                            className="flex items-center justify-center p-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-white/10 rounded transition"
                            title={t('Редактор схемы БД', 'Database schema editor')}
                          >
                            <GitMerge className="w-3.5 h-3.5" />
                          </NavLink>
                        </>
                      )}
                    </div>
                  )}

                  {/* Non-privileged users search */}
                  {!isPrivileged && searchActiveSpaceId === space.id && (
                    <div className="flex items-center gap-0.5 mb-2 p-1 bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded-lg">
                      <div className="flex-shrink-0 flex items-center justify-center p-1.5">
                        <Search className="w-3.5 h-3.5 text-[var(--color-primary-500)]" />
                      </div>
                      <input
                        type="text"
                        value={sidebarSearch}
                        onChange={(e) => setSidebarSearch(e.target.value)}
                        placeholder={t('Поиск...', 'Search...')}
                        className="flex-1 min-w-0 px-2 py-0.5 text-xs bg-transparent border-none focus:outline-none text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
                        autoFocus
                      />
                      {/* Vertical divider */}
                      <div className="w-px h-4 bg-[var(--border-secondary)] mx-0.5" />
                      <button
                        type="button"
                        onClick={() => {
                          setSidebarSearch('');
                          setSearchActiveSpaceId(null);
                          setExpandedProjects(new Set());
                        }}
                        className="flex-shrink-0 flex items-center justify-center p-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-white/10 rounded transition"
                        title={t('Закрыть поиск', 'Close search')}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Projects Section */}
                  {spaceProjects.length === 0 ? (
                    isPublic ? (
                      <p className="px-2 py-1 text-xs italic text-[var(--text-tertiary)]">
                        {t('Нет публичных проектов', 'No public projects')}
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setTargetSpaceId?.(space.id);
                          setIsCreateProjectModalOpen?.(true);
                        }}
                        className="w-full rounded-lg border border-dashed border-[var(--border-primary)] bg-[var(--bg-primary)] p-2 text-center text-xs font-medium text-[var(--text-tertiary)] transition hover:border-[var(--color-primary-400)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--color-primary-500)]"
                      >
                        <span className="text-sm">+</span> Create New Project
                      </button>
                    )
                  ) : (
                    spaceProjects.map((project) => {
                      const isProjectExpanded = expandedProjects.has(project.id);
                      const isProjectActive = currentProject?.id === project.id;
                      const projectHref = isPublic
                        ? `/s/${publicSlug ?? ''}/projects/${project.id}`
                        : `/projects/${project.id}/dashboard`;

                      return (
                        <div key={`project-${project.id}`} className="space-y-1">
                          {/* Project Header - click to navigate to dashboard AND toggle expand */}
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => toggleProject(project.id)}
                              className="p-1 hover:bg-[rgba(255,255,255,0.1)] rounded transition"
                              data-testid={`project-expand-${project.id}`}
                            >
                              <span className="text-xs text-[var(--text-tertiary)]">
                                {isProjectExpanded ? '▼' : '▶'}
                              </span>
                            </button>
                            <NavLink
                              to={projectHref}
                              onClick={() => selectProject(project.id)}
                              className={({ isActive }) =>
                                `flex-1 flex items-center gap-2 px-3 py-2 text-sm font-medium transition rounded-md ${
                                  isActive || isProjectActive
                                    ? 'text-[var(--color-primary-500)] hover:bg-[var(--color-primary-500)]/20'
                                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                                }`
                              }
                              data-testid={`project-link-${project.id}`}
                            >
                              <span className="text-base">{project.icon || '📁'}</span>
                              <span className="flex-1">{project.name}</span>
                            </NavLink>
                          </div>

                          {/* Project Content - Widget Views + Data Processing */}
                          {isProjectExpanded && (
                            <>
                              {/* Widget Views (Представления) */}
                              <ProjectContent
                                projectId={project.id}
                                isPrivileged={isPrivileged}
                                searchQuery={searchActiveSpaceId === space.id ? sidebarSearch : ''}
                                mode={mode}
                                publicSlug={publicSlug}
                                widgetsOverride={widgetsByProject?.[project.id]}
                              />

                              {/* Data & Processing (Источники данных) - only for privileged users.
                                  Public mode forces isPrivileged=false above, so this branch is dead. */}
                              {isPrivileged && (
                                <ProjectTablesNav
                                  projectId={project.id}
                                  isPrivileged={isPrivileged}
                                  searchQuery={searchActiveSpaceId === space.id ? sidebarSearch : ''}
                                />
                              )}
                            </>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Create New Space Button — private mode only (modal trigger). */}
        {!isPublic && (
          <button
            type="button"
            onClick={() => setIsCreateSpaceModalOpen?.(true)}
            className="w-full rounded-lg border-2 border-dashed border-[var(--border-primary)] p-4 text-center text-sm text-[var(--text-tertiary)] transition hover:border-[var(--color-primary-400)] hover:text-[var(--color-primary-500)]"
            data-testid="create-space-btn"
          >
            + Create New Space
          </button>
        )}
      </div>

      {/* Settings/Help moved to StatusBar — sidebar space freed for navigation */}

      {/* Resize handle — hidden in public mode (read-only viewers don't resize). */}
      {!isMobile && isSidebarLocked && !isPublic && (
        <div
          onMouseDown={handleResizeStart}
          className={`
            absolute right-0 top-0 bottom-0 w-1 cursor-col-resize
            hover:bg-[var(--color-primary-500)] transition-colors
            ${isResizing ? 'bg-[var(--color-primary-500)]' : 'bg-transparent'}
          `}
        />
      )}
    </aside>
  );
};
