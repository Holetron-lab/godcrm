import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useProjectsQuery } from '@/features/projects/hooks/useProjectsQuery';
import { useCurrentProject, useProjectStore } from '@/features/projects/store/projectStore';
import { useSpacesQuery } from '@/features/spaces/hooks/useSpacesQuery';
import { useSpaces } from '@/features/spaces/store/spacesStore';
import { useSpacesOrder } from '@/features/spaces/hooks/useSpacesOrder';
import { useTablesStore } from '@/features/tables/store/tablesStore';
import { useWidgetsStore } from '@/features/widgets/store/widgetsStore';
import { getWidgetById } from '@/features/widgets/api/widgetsApi';
import type { Widget } from '@/features/widgets/types/widget.types';
import { useDataSource } from '@/features/data-sources/hooks/useDataSources';
import { apiClient } from '@/shared/utils/apiClient';
import { ToastContainer } from '@/shared/components/ui/Toast';
import { AIChatProvider, AIChatPanel } from '@/features/ai-chat';
import { WindowControls } from '@/shared/components/desktop/WindowControls';
import { DesktopTabBar } from '@/shared/components/desktop/DesktopTabBar';
import { StatusBar } from '@/shared/components/desktop/StatusBar';
import { useTabSync } from '@/shared/hooks/useTabSync';
import { useDesktopApp } from '@/shared/hooks/useDesktopApp';
import { useHeaderLanguageSwitcher } from '@/shared/hooks/useHeaderLanguageSwitcher';
import { readSidebarDefault } from '@/shared/hooks/useSidebarDefault';
import { isDesktopApp, getPlatform } from '@/shared/types/electron.types';
import { Menu, X } from 'lucide-react';
import { logger } from '@/shared/utils/logger';
import { LayoutLoader } from './LayoutLoader';
import { FullscreenToggle } from './FullscreenToggle';
import { ThemeToggle } from './ThemeToggle';
import { LanguageSwitcher } from './LanguageSwitcher';
import { HeaderBreadcrumbs } from './HeaderBreadcrumbs';
import { HeaderActionsMenu } from './HeaderActionsMenu';
import { Sidebar } from './Sidebar';
import { LayoutModals } from './LayoutModals';

export const Layout = () => {
  const { t } = useLanguage();
  const location = useLocation();
  const { user, initialized } = useAuthStore((state) => ({
    user: state.user,
    initialized: state.initialized
  }));

  // CALL ALL HOOKS FIRST (before any conditionals)
  useProjectsQuery();
  useSpacesQuery();
  const currentProject = useCurrentProject();
  const projects = useProjectStore((state) => state.projects);
  const spaces = useSpaces();
  const selectProject = useProjectStore((state) => state.selectProject);

  // NOW check conditionals AFTER all hooks
  if (!initialized) {
    return <LayoutLoader />;
  }

  if (!user) {
    return <Navigate to="/auth/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return (
    <LayoutContent
      t={t}
      location={location}
      currentProject={currentProject}
      projects={projects}
      spaces={spaces}
      selectProject={selectProject}
    />
  );
};

interface LayoutContentProps {
  t: (key: string) => string;
  location: { pathname: string; search?: string };
  currentProject: {
    id: number;
    name: string;
    business_name?: string | null;
    icon?: string | null;
    logo?: string | null;
    description?: string | null;
    space_id?: number | null;
  } | null;
  projects: Array<{
    id: number;
    name: string;
    icon?: string | null;
    logo?: string | null;
    space_id?: number | null;
  }>;
  spaces: Array<{
    id: number;
    name: string;
    icon?: string | null;
    type: string;
    projects_count?: number;
  }>;
  selectProject: (id: number | null) => void;
}

const LayoutContent = ({
  t,
  location,
  currentProject,
  projects,
  spaces,
  selectProject
}: LayoutContentProps) => {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();

  const { isSettingsOpen, closeSettings } = useDesktopApp();
  const { getSpaceOrder } = useSpacesOrder();
  const [showHeaderLanguageSwitcher] = useHeaderLanguageSwitcher();

  const sortedSpaces = useMemo(() => {
    return [...spaces].sort((a, b) => {
      const orderA = getSpaceOrder(a.id, a.type);
      const orderB = getSpaceOrder(b.id, b.type);
      return orderA - orderB;
    });
  }, [spaces, getSpaceOrder]);

  const [expandedSpaces, setExpandedSpaces] = useState<Set<number>>(new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<number>>(new Set());
  const [isCreateSpaceModalOpen, setIsCreateSpaceModalOpen] = useState(false);
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] = useState(false);
  const [isEditProjectModalOpen, setIsEditProjectModalOpen] = useState(false);
  const [editProjectId, setEditProjectId] = useState<number | null>(null);
  const [isDeleteProjectModalOpen, setIsDeleteProjectModalOpen] = useState(false);
  const [deleteProjectId, setDeleteProjectId] = useState<number | null>(null);
  const [isEditSpaceModalOpen, setIsEditSpaceModalOpen] = useState(false);
  const [editSpaceId, setEditSpaceId] = useState<number | null>(null);
  const [isSpaceManagerModalOpen, setIsSpaceManagerModalOpen] = useState(false);
  const [isDeleteSpaceModalOpen, setIsDeleteSpaceModalOpen] = useState(false);
  const [isCreateTableModalOpen, setIsCreateTableModalOpen] = useState(false);
  const [isEditWidgetSettingsModalOpen, setIsEditWidgetSettingsModalOpen] = useState(false);
  const [isEditTableDisplayModalOpen, setIsEditTableDisplayModalOpen] = useState(false);
  const [isEditTableModalOpen, setIsEditTableModalOpen] = useState(false);
  const [isDataSourceWizardOpen, setIsDataSourceWizardOpen] = useState(false);
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);

  const projectForEdit = useMemo(() => {
    if (editProjectId) {
      return projects.find((project) => project.id === editProjectId) || currentProject;
    }
    return currentProject;
  }, [editProjectId, projects, currentProject]);

  const projectForDelete = useMemo(() => {
    if (deleteProjectId) {
      return projects.find((project) => project.id === deleteProjectId) || currentProject;
    }
    return currentProject;
  }, [deleteProjectId, projects, currentProject]);

  const handleEditProjectModalChange = useCallback((open: boolean) => {
    setIsEditProjectModalOpen(open);
    if (!open) {
      setEditProjectId(null);
    }
  }, []);

  const handleDeleteProjectModalChange = useCallback((open: boolean) => {
    setIsDeleteProjectModalOpen(open);
    if (!open) {
      setDeleteProjectId(null);
    }
  }, []);

  const openDeleteProjectModal = useCallback((projectId?: number | null) => {
    if (!projectId) return;
    setDeleteProjectId(projectId);
    setIsDeleteProjectModalOpen(true);
  }, []);

  const [activeSpaceToolbar, setActiveSpaceToolbar] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 768 && readSidebarDefault() === 'show');
  const [isSidebarLocked, setIsSidebarLocked] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 768 && readSidebarDefault() === 'show');
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('sidebar-width');
      return saved ? parseInt(saved, 10) : 256;
    }
    return 256;
  });
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarHoverTimerRef = useRef<number | null>(null);

  const [targetSpaceId, setTargetSpaceId] = useState<number | null>(null);

  // Listen for resize to update mobile state
  useEffect(() => {
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

  // Notify width-sensitive consumers (chat panel) when sidebar layout changes
  // — locking or resizing the sidebar changes the available viewport width
  // for a glued chat panel, but doesn't fire window 'resize'. Without this
  // event, the panel keeps its old gluedMax and a gap appears on the right.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event('app:layout-changed'));
  }, [isSidebarLocked, sidebarWidth]);

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
  }, []);

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
  }, []);

  // Sidebar resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(Math.max(e.clientX, 230), 400);
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('sidebar-width', sidebarWidth.toString());
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, sidebarWidth]);

  // Get tables store to find table's project
  const tables = useTablesStore((state) => state.tables);

  // Update current project from URL (projects or tables)
  useEffect(() => {
    const spaceMatch = location.pathname.match(/^\/spaces\/(\d+)/);
    if (spaceMatch) {
      if (currentProject) {
        selectProject(null);
      }
      return;
    }

    const projectMatch = location.pathname.match(/^\/projects\/(\d+)/);
    if (projectMatch) {
      const projectId = parseInt(projectMatch[1], 10);
      if (currentProject?.id !== projectId) {
        selectProject(projectId);
      }
      return;
    }

    const tableMatch = location.pathname.match(/^\/tables\/(.+)/);
    if (tableMatch) {
      const tableId = tableMatch[1];
      const table = tables.find(t => t.id === tableId);
      if (table?.projectId && currentProject?.id !== table.projectId) {
        selectProject(table.projectId);
      }
    }
  }, [location.pathname, currentProject?.id, selectProject, tables]);

  useEffect(() => {
    const handleEditProject = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: number }>).detail;
      if (!detail?.projectId) return;
      setEditProjectId(detail.projectId);
      setIsEditProjectModalOpen(true);
    };
    window.addEventListener('schema-editor:edit-project', handleEditProject as EventListener);
    return () => {
      window.removeEventListener('schema-editor:edit-project', handleEditProject as EventListener);
    };
  }, [setEditProjectId, setIsEditProjectModalOpen]);

  // Determine current widget from URL
  const widgets = useWidgetsStore((state) => state.widgets);
  const [loadedWidget, setLoadedWidget] = useState<Widget | null>(null);
  const currentWidgetId = useMemo(() => {
    const widgetMatch = location.pathname.match(/^\/widgets\/(\d+)/);
    if (widgetMatch) {
      return widgetMatch[1];
    }
    return null;
  }, [location.pathname]);

  // Load widget data if not in store
  useEffect(() => {
    if (!currentWidgetId) {
      if (loadedWidget !== null) {
        setLoadedWidget(null);
      }
      return;
    }

    const storeWidget = widgets.find(w => String(w.id) === currentWidgetId);
    if (storeWidget) {
      if (!loadedWidget || String(loadedWidget.id) !== currentWidgetId) {
        setLoadedWidget(storeWidget);
      }
      return;
    }

    if (loadedWidget && String(loadedWidget.id) === currentWidgetId) {
      return;
    }

    getWidgetById(Number(currentWidgetId))
      .then(widget => {
        setLoadedWidget(widget);
      })
      .catch(err => logger.error('[Layout] Failed to load widget:', err));
  }, [currentWidgetId, widgets, loadedWidget]);

  // Determine current space from URL, widget, or current project
  const currentSpace = useMemo(() => {
    const spaceMatch = location.pathname.match(/^\/spaces\/(\d+)/);
    if (spaceMatch) {
      const spaceId = parseInt(spaceMatch[1], 10);
      return spaces.find(s => s.id === spaceId) || null;
    }

    const widgetMatch = location.pathname.match(/^\/widgets\/(\d+)/);
    if (widgetMatch && loadedWidget) {
      const widgetSpaceId = (loadedWidget as any).space_id;
      if (widgetSpaceId) {
        return spaces.find(s => s.id === widgetSpaceId) || null;
      }
    }

    if (currentProject?.space_id) {
      return spaces.find(s => s.id === currentProject.space_id) || null;
    }

    if (location.pathname === '/' || location.pathname === '/spaces') {
      return spaces.find(s => s.type === 'personal') || null;
    }

    return null;
  }, [location.pathname, currentProject, spaces, loadedWidget]);

  // Space for edit modal
  const spaceForEdit = useMemo(() => {
    if (editSpaceId) {
      return spaces.find((space) => space.id === editSpaceId) || currentSpace;
    }
    return currentSpace;
  }, [editSpaceId, spaces, currentSpace]);

  // Determine current table ID from URL
  const currentTableId = useMemo(() => {
    const tableMatch = location.pathname.match(/^\/tables\/(.+)/);
    return tableMatch ? tableMatch[1] : null;
  }, [location.pathname]);

  // Load table if not in store
  const [loadedTable, setLoadedTable] = useState<typeof tables[0] | null>(null);

  useEffect(() => {
    if (!currentTableId) {
      if (loadedTable) setLoadedTable(null);
      return;
    }

    const storeTable = tables.find(t => String(t.id) === currentTableId);
    if (storeTable) {
      if (!loadedTable || String(loadedTable.id) !== currentTableId) {
        setLoadedTable(storeTable);
      }
      return;
    }

    if (loadedTable && String(loadedTable.id) === currentTableId) {
      return;
    }

    logger.debug('[Layout] Loading table from API:', currentTableId);
    apiClient.get<{ data: { id: number; name: string; display_name?: string; icon?: string; project_id?: number } }>(`/tables/${currentTableId}`)
      .then(response => {
        logger.debug('[Layout] Table loaded:', response.data);
        setLoadedTable({
          id: response.data.id,
          name: response.data.name,
          displayName: response.data.display_name || response.data.name,
          icon: response.data.icon || null,
          projectId: response.data.project_id || null
        } as unknown as typeof tables[0]);
      })
      .catch(err => logger.error('[Layout] Failed to load table:', err));
  }, [currentTableId, tables, loadedTable]);

  // Get current table (from store or loaded)
  const currentTable = useMemo(() => {
    if (!currentTableId) return null;
    const storeTable = tables.find(t => String(t.id) === currentTableId);
    return storeTable || loadedTable;
  }, [currentTableId, tables, loadedTable]);

  // Get current widget (from store or loaded)
  const currentWidget = loadedWidget;

  // Get project to display in breadcrumb
  const displayProject = useMemo(() => {
    const widgetMatch = location.pathname.match(/^\/widgets\/(\d+)/);
    if (widgetMatch && loadedWidget) {
      const widgetProjectId = (loadedWidget as any).project_id;
      if (widgetProjectId) {
        return projects.find(p => p.id === widgetProjectId) || null;
      }
    }
    return currentProject;
  }, [location.pathname, loadedWidget, projects, currentProject]);

  // Get data source info for external tables
  useDataSource(currentTable?.data_source_id || '');

  // Sync current page with desktop tabs
  const isHomePage = location.pathname === '/' || location.pathname === '/spaces';

  const tabTitle = useMemo(() => {
    if (isHomePage) return 'Главная';
    if (location.pathname === '/settings') return 'Настройки';
    if (location.pathname === '/help') return 'Помощь';
    if (currentWidget) return currentWidget.title || `Module #${currentWidget.id}`;
    if (currentTable) return currentTable.displayName || currentTable.name;
    if (currentProject) return currentProject.name;
    if (currentSpace) return currentSpace.name;
    return 'Главная';
  }, [isHomePage, currentWidget, currentTable, currentProject, currentSpace, location.pathname]);

  const tabIcon = useMemo(() => {
    if (isHomePage) return '__home__';
    if (location.pathname === '/settings') return '__settings__';
    if (location.pathname === '/help') return '__help__';
    if (location.pathname.includes('/dashboard')) return '__dashboard__';
    if (currentWidget) return currentWidget.icon || '🧩';
    if (currentTable) return '📋';
    if (currentProject) return currentProject.icon || '📁';
    if (currentSpace) return currentSpace.icon || '🌐';
    return undefined;
  }, [isHomePage, currentWidget, currentTable, currentProject, currentSpace, location.pathname]);

  useTabSync({ title: tabTitle, icon: tabIcon });

  // Auto-expand hierarchy based on current location
  useEffect(() => {
    if (spaces.length === 0 || projects.length === 0) return;

    let targetSpaceIdToExpand: number | null = null;
    let targetProjectIdToExpand: number | null = null;

    const spaceMatch = location.pathname.match(/^\/spaces\/(\d+)/);
    if (spaceMatch) {
      targetSpaceIdToExpand = parseInt(spaceMatch[1], 10);
    }

    const projectMatch = location.pathname.match(/^\/projects\/(\d+)/);
    if (projectMatch) {
      const projectId = parseInt(projectMatch[1], 10);
      const project = projects.find(p => p.id === projectId);
      if (project?.space_id) {
        targetSpaceIdToExpand = project.space_id;
        targetProjectIdToExpand = projectId;
      }
    }

    const tableMatch = location.pathname.match(/^\/tables\/(.+)/);
    if (tableMatch) {
      const tableId = tableMatch[1];
      const table = tables.find(t => String(t.id) === tableId);
      if (table?.projectId) {
        const project = projects.find(p => p.id === table.projectId);
        if (project?.space_id) {
          targetSpaceIdToExpand = project.space_id;
          targetProjectIdToExpand = table.projectId;
        }
      }
    }

    const widgetMatch = location.pathname.match(/^\/widgets\/(\d+)/);
    if (widgetMatch) {
      if (loadedWidget && String(loadedWidget.id) === widgetMatch[1]) {
        const widgetProjectId = (loadedWidget as any).project_id;
        if (widgetProjectId) {
          const project = projects.find(p => p.id === widgetProjectId);
          if (project?.space_id) {
            targetSpaceIdToExpand = project.space_id;
            targetProjectIdToExpand = widgetProjectId;
          }
        }
      }

      if (!targetProjectIdToExpand) {
        const widget = widgets.find(w => String(w.id) === widgetMatch[1]);
        if (widget?.config?.table_id) {
          const linkedTable = tables.find(t => String(t.id) === String(widget.config.table_id));
          if (linkedTable?.projectId) {
            const project = projects.find(p => p.id === linkedTable.projectId);
            if (project?.space_id) {
              targetSpaceIdToExpand = project.space_id;
              targetProjectIdToExpand = linkedTable.projectId;
            }
          }
        }
      }
    }

    if (targetSpaceIdToExpand !== null) {
      setExpandedSpaces(new Set([targetSpaceIdToExpand]));
    } else {
      setExpandedSpaces(new Set());
    }

    if (targetProjectIdToExpand !== null) {
      setExpandedProjects(new Set([targetProjectIdToExpand]));
    } else {
      setExpandedProjects(new Set());
    }
  }, [location.pathname, spaces, projects, tables, widgets, loadedWidget]);

  return (
    <AIChatProvider spaceId={currentSpace?.id}>
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Header */}
      <header
        className="flex-shrink-0 flex items-center gap-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-2"
        style={{ WebkitAppRegion: isDesktopApp() && getPlatform() !== 'darwin' ? 'drag' : undefined } as React.CSSProperties}
      >
        {/* Hamburger Menu Button */}
        <button
          type="button"
          onClick={() => {
            if (isMobile) {
              setIsSidebarOpen(!isSidebarOpen);
            } else {
              if (isSidebarLocked) {
                setIsSidebarLocked(false);
                setIsSidebarOpen(false);
              } else {
                setIsSidebarLocked(true);
                setIsSidebarOpen(true);
              }
            }
          }}
          className={`p-2 rounded-lg transition-colors ${
            isMobile
              ? (isSidebarOpen ? 'bg-[var(--bg-tertiary)]' : 'hover:bg-[var(--bg-tertiary)]')
              : (isSidebarLocked ? 'bg-[var(--bg-tertiary)]' : 'hover:bg-[var(--bg-tertiary)]')
          }`}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title={isMobile
            ? (isSidebarOpen ? 'Hide menu' : 'Show menu')
            : (isSidebarLocked ? 'Hide sidebar' : 'Show sidebar')
          }
        >
          {(isMobile && isSidebarOpen) || (!isMobile && isSidebarLocked) ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>

        {/* Logo */}
        <Link
          to="/"
          className="flex-shrink-0 hover:opacity-80 transition-opacity"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title="GOD CRM - Home"
        >
          <svg width="20" height="20" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-sm">
            <ellipse cx="32" cy="32" rx="28" ry="12" fill="var(--color-primary-400)" opacity="0.4" />
            <ellipse cx="32" cy="32" rx="22" ry="9" fill="var(--color-primary-500)" opacity="0.6" />
            <ellipse cx="32" cy="32" rx="16" ry="6" fill="var(--color-primary-400)" opacity="0.8" />
            <ellipse cx="32" cy="32" rx="10" ry="3.5" fill="var(--color-primary-300)" />
          </svg>
        </Link>

        {/* Separator after logo */}
        {!(location.pathname === '/' || location.pathname === '/spaces') && (
          <span className="text-[var(--text-tertiary)] text-sm flex-shrink-0">/</span>
        )}

        {/* Breadcrumb Navigation */}
        <div
          className="flex-1 flex items-center gap-1.5 text-sm min-w-0 overflow-hidden"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <HeaderBreadcrumbs
            t={t}
            pathname={location.pathname}
            currentSpace={currentSpace}
            displayProject={displayProject}
            currentTable={currentTable}
            currentWidgetId={currentWidgetId}
            currentWidget={currentWidget}
          />
        </div>

        {/* Desktop Tab Bar */}
        <DesktopTabBar />

        {/* Right Actions */}
        <div
          className="flex items-center gap-2 flex-shrink-0"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <FullscreenToggle />
          {showHeaderLanguageSwitcher && <LanguageSwitcher />}
          <ThemeToggle />
          <HeaderActionsMenu
            t={t}
            isActionsMenuOpen={isActionsMenuOpen}
            setIsActionsMenuOpen={setIsActionsMenuOpen}
            currentProject={currentProject}
            currentSpace={currentSpace}
            currentTable={currentTable}
            currentWidgetId={currentWidgetId}
            currentWidget={currentWidget}
            setIsCreateTableModalOpen={setIsCreateTableModalOpen}
            setIsCreateProjectModalOpen={setIsCreateProjectModalOpen}
            setIsDataSourceWizardOpen={setIsDataSourceWizardOpen}
            setIsEditWidgetSettingsModalOpen={setIsEditWidgetSettingsModalOpen}
            setEditProjectId={setEditProjectId}
            setIsEditProjectModalOpen={setIsEditProjectModalOpen}
            setIsEditSpaceModalOpen={setIsEditSpaceModalOpen}
            setIsEditTableModalOpen={setIsEditTableModalOpen}
            setIsDeleteSpaceModalOpen={setIsDeleteSpaceModalOpen}
            openDeleteProjectModal={openDeleteProjectModal}
          />

          {/* Window Controls */}
          <WindowControls />
        </div>
      </header>

      {/* Body - Sidebar + Content */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Mobile overlay backdrop */}
        {isMobile && isSidebarOpen && (
          <div
            className="absolute inset-0 bg-black/50 z-20"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Hover zone to open sidebar when collapsed — debounced 500ms so passing the
            cursor through the strip doesn't immediately reveal it. z-[60] so it
            sits ABOVE the chat panel (z-30) — otherwise a glued chat covers the
            strip and the sidebar can't be revealed. */}
        {!isMobile && !isSidebarOpen && !isSidebarLocked && (
          <div
            className="absolute left-0 top-0 bottom-0 w-4 z-[60] hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer"
            onMouseEnter={() => {
              if (sidebarHoverTimerRef.current) window.clearTimeout(sidebarHoverTimerRef.current);
              sidebarHoverTimerRef.current = window.setTimeout(() => {
                setIsSidebarOpen(true);
                sidebarHoverTimerRef.current = null;
              }, 500);
            }}
            onMouseLeave={() => {
              if (sidebarHoverTimerRef.current) {
                window.clearTimeout(sidebarHoverTimerRef.current);
                sidebarHoverTimerRef.current = null;
              }
            }}
            title="Open sidebar"
          />
        )}

        {/* Sidebar */}
        <Sidebar
          spaces={sortedSpaces}
          projects={projects}
          currentProject={currentProject}
          currentSpace={currentSpace}
          expandedSpaces={expandedSpaces}
          expandedProjects={expandedProjects}
          toggleSpace={toggleSpace}
          toggleProject={toggleProject}
          setExpandedSpaces={setExpandedSpaces}
          setExpandedProjects={setExpandedProjects}
          selectProject={selectProject}
          isMobile={isMobile}
          isSidebarOpen={isSidebarOpen}
          isSidebarLocked={isSidebarLocked}
          sidebarWidth={sidebarWidth}
          isResizing={isResizing}
          sidebarRef={sidebarRef}
          setIsSidebarOpen={setIsSidebarOpen}
          handleResizeStart={handleResizeStart}
          setIsCreateSpaceModalOpen={setIsCreateSpaceModalOpen}
          setIsCreateProjectModalOpen={setIsCreateProjectModalOpen}
          setTargetSpaceId={setTargetSpaceId}
          setEditSpaceId={setEditSpaceId}
          setIsEditSpaceModalOpen={setIsEditSpaceModalOpen}
          setActiveSpaceToolbar={setActiveSpaceToolbar}
          activeSpaceToolbar={activeSpaceToolbar}
        />

        {/* Main Content */}
        <main className="flex-1 min-w-0 min-h-0 w-full max-w-full overflow-auto bg-[var(--bg-primary)] p-[3px] sm:p-[6px] lg:p-[12px] 3xl:p-6">
          <Outlet />
        </main>

        {/* AI Chat Panel v2 (ADR-024) */}
        <AIChatPanel />
      </div>

      {/* Status Bar */}
      <StatusBar />

      <ToastContainer />
      <LayoutModals
        t={t}
        isCreateSpaceModalOpen={isCreateSpaceModalOpen}
        setIsCreateSpaceModalOpen={setIsCreateSpaceModalOpen}
        isEditSpaceModalOpen={isEditSpaceModalOpen}
        setIsEditSpaceModalOpen={setIsEditSpaceModalOpen}
        isSpaceManagerModalOpen={isSpaceManagerModalOpen}
        setIsSpaceManagerModalOpen={setIsSpaceManagerModalOpen}
        isDeleteSpaceModalOpen={isDeleteSpaceModalOpen}
        setIsDeleteSpaceModalOpen={setIsDeleteSpaceModalOpen}
        spaceForEdit={spaceForEdit}
        currentSpace={currentSpace}
        editSpaceId={editSpaceId}
        setEditSpaceId={setEditSpaceId}
        isCreateProjectModalOpen={isCreateProjectModalOpen}
        setIsCreateProjectModalOpen={setIsCreateProjectModalOpen}
        isEditProjectModalOpen={isEditProjectModalOpen}
        handleEditProjectModalChange={handleEditProjectModalChange}
        isDeleteProjectModalOpen={isDeleteProjectModalOpen}
        handleDeleteProjectModalChange={handleDeleteProjectModalChange}
        projectForEdit={projectForEdit}
        projectForDelete={projectForDelete}
        openDeleteProjectModal={openDeleteProjectModal}
        targetSpaceId={targetSpaceId}
        setTargetSpaceId={setTargetSpaceId}
        selectProject={selectProject}
        projects={projects}
        currentProject={currentProject}
        isCreateTableModalOpen={isCreateTableModalOpen}
        setIsCreateTableModalOpen={setIsCreateTableModalOpen}
        isEditTableDisplayModalOpen={isEditTableDisplayModalOpen}
        setIsEditTableDisplayModalOpen={setIsEditTableDisplayModalOpen}
        isEditTableModalOpen={isEditTableModalOpen}
        setIsEditTableModalOpen={setIsEditTableModalOpen}
        currentTable={currentTable}
        currentWidgetId={currentWidgetId}
        isEditWidgetSettingsModalOpen={isEditWidgetSettingsModalOpen}
        setIsEditWidgetSettingsModalOpen={setIsEditWidgetSettingsModalOpen}
        currentWidget={currentWidget}
        isDataSourceWizardOpen={isDataSourceWizardOpen}
        setIsDataSourceWizardOpen={setIsDataSourceWizardOpen}
        isSettingsOpen={isSettingsOpen}
        closeSettings={closeSettings}
      />
    </div>
    </AIChatProvider>
  );
};
