import { MouseEvent, CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreVertical, Settings, Copy, Download, Trash2, Users, LayoutGrid, FolderOpen, Plus, ExternalLink, BarChart3 } from 'lucide-react';
import type { SpaceModel, UsersByRoles, SpaceProject, SpaceUser } from '../types/space.types';
import type { SpaceCardSize, SpaceCardHeight, SpaceCardSettings } from '../types/spaceCardSettings.types';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { DropdownMenu } from '@/shared/components/ui/DropdownMenu';

interface SpaceCardProps {
  space: SpaceModel;
  isActive?: boolean;
  onClick?: (space: SpaceModel) => void;
  cardSettings?: SpaceCardSettings;
  onSettingsClick?: (space: SpaceModel) => void;
  onSizeChange?: (spaceId: number, size: SpaceCardSize) => void;
  onHeightChange?: (spaceId: number, height: SpaceCardHeight) => void;
  onDelete?: (space: SpaceModel) => void;
  onDuplicate?: (space: SpaceModel) => void;
  onExport?: (space: SpaceModel) => void;
  onCreateProject?: (space: SpaceModel) => void;
  usersCount?: number;
  usersByRole?: UsersByRoles;
  userAccessLevel?: 'owner' | 'admin' | 'editor' | 'viewer' | null;
  // Layout-driven props (set by SpacesList).
  // effectiveSlots = how many columns the card actually occupies after packing.
  // mobileMode = the parent grid is single-column; modules stack vertically.
  // rowHeightPx = base height of one module row (desktop) / one module cell (mobile).
  effectiveSlots?: number;
  mobileMode?: boolean;
  rowHeightPx?: number;
}

/**
 * SpaceCard - Модульная карточка пространства
 * 
 * Каждая карточка состоит из модулей размером 1/4:
 * - quarter: 1 модуль (только инфо)
 * - half: 2 модуля (инфо + проекты)
 * - threeQuarter: 3 модуля (инфо + проекты + команда)
 * - full: 4 модуля
 */
export const SpaceCard = ({
  space,
  isActive = false,
  onClick,
  cardSettings,
  onSettingsClick,
  onSizeChange,
  onHeightChange,
  onDelete,
  onDuplicate,
  onExport,
  onCreateProject,
  usersCount = 0,
  usersByRole,
  userAccessLevel,
  effectiveSlots,
  mobileMode = false,
  rowHeightPx = 140
}: SpaceCardProps) => {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const size = cardSettings?.size || 'quarter';
  const showDescription = cardSettings?.showDescription ?? true;

  // User access level from space or prop
  const accessLevel = userAccessLevel || (space as any).user_access_level || 'viewer';
  const canManage = accessLevel === 'owner' || accessLevel === 'admin';

  // Get actual users by roles from space or prop
  const roles = usersByRole || space.users_by_roles || { owners: 1, admins: 0, editors: 0, viewers: 0 };
  const totalUsers = space.users_count || usersCount || (roles.owners + roles.admins + roles.editors + roles.viewers);

  // Preferred number of modules from user-chosen size (1..4).
  const preferredModuleCount = (() => {
    switch (size) {
      case 'full': return 4;
      case 'threeQuarter': return 3;
      case 'half': return 2;
      default: return 1;
    }
  })();

  // How many modules to actually render.
  //  - Desktop: equal to the card's effective horizontal span (so a 1/4-card
  //    that grew to fill a row shows extra modules; a 4/4-card squeezed to
  //    1/4 shows only the info module).
  //  - Mobile (N=1): always show preferred — modules stack vertically.
  const span = Math.max(1, effectiveSlots ?? preferredModuleCount);
  const moduleCount = mobileMode ? preferredModuleCount : span;

  const handleClick = () => {
    if (onClick) {
      onClick(space);
    } else {
      navigate(`/spaces/${space.id}/dashboard`);
    }
  };

  const handleMenuClick = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  const handleCreateProject = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onCreateProject?.(space);
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'business':
        // Use fixed green color instead of dynamic primary (which can be any color)
        return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
      case 'personal':
        return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';
      case 'admin':
        return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400';
    }
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      business: t('spaces.types.business') || 'Business',
      personal: t('spaces.types.personal') || 'Personal',
      admin: t('spaces.types.admin') || 'Admin'
    };
    return labels[type] || type;
  };

  // Dropdown menu items
  const menuItems = [
    {
      label: t('spaces.menu.settings') || 'Settings',
      value: 'settings',
      icon: <Settings className="h-4 w-4" />,
      onSelect: () => onSettingsClick?.(space)
    },
    {
      label: t('spaces.menu.changeSize') || 'Change Size',
      value: 'size',
      icon: <LayoutGrid className="h-4 w-4" />,
      submenu: [
        { label: t('spaces.menu.sizeFull') || 'Full Width', value: 'full', onSelect: () => onSizeChange?.(space.id, 'full') },
        { label: t('spaces.menu.sizeThreeQuarter') || '3/4 Width', value: 'threeQuarter', onSelect: () => onSizeChange?.(space.id, 'threeQuarter') },
        { label: t('spaces.menu.sizeHalf') || 'Half Width', value: 'half', onSelect: () => onSizeChange?.(space.id, 'half') },
        { label: t('spaces.menu.sizeQuarter') || 'Quarter', value: 'quarter', onSelect: () => onSizeChange?.(space.id, 'quarter') }
      ]
    },
    {
      label: t('spaces.menu.duplicate') || 'Duplicate',
      value: 'duplicate',
      icon: <Copy className="h-4 w-4" />,
      onSelect: () => onDuplicate?.(space)
    },
    {
      label: t('spaces.menu.export') || 'Export',
      value: 'export',
      icon: <Download className="h-4 w-4" />,
      onSelect: () => onExport?.(space)
    },
    {
      label: t('spaces.menu.delete') || 'Delete',
      value: 'delete',
      icon: <Trash2 className="h-4 w-4" />,
      danger: true,
      onSelect: () => onDelete?.(space)
    }
  ];

  // MODULE: Info (always first)
  const renderInfoModule = () => (
    <div className="relative flex flex-col h-full p-3">
      {/* Menu button - always in top-right of info module */}
      <div onClick={handleMenuClick} className="absolute top-2 right-2 z-10">
        <DropdownMenu
          trigger={
            <span
              role="button"
              tabIndex={0}
              className="flex h-6 w-6 items-center justify-center rounded-md transition-all hover:bg-[var(--bg-tertiary)] cursor-pointer"
            >
              <MoreVertical className="h-4 w-4 text-[var(--text-tertiary)]" />
            </span>
          }
          items={menuItems}
        />
      </div>

      {/* Header row */}
      <div className="flex items-start gap-2.5 mb-2 pr-6">
        <div 
          className={`flex-shrink-0 flex items-center justify-center rounded-lg text-lg h-9 w-9 transition-transform duration-300 group-hover:scale-110 ${
            isActive ? 'bg-[var(--color-primary-100)] dark:bg-[var(--color-primary-900)]' : 'bg-[var(--bg-tertiary)]'
          }`}
        >
          {space.icon || '📁'}
        </div>
        
        <div className="flex-1 min-w-0">
          <h3 className={`font-semibold text-sm truncate ${
            isActive ? 'text-[var(--color-primary-700)] dark:text-[var(--color-primary-300)]' : 'text-[var(--text-primary)]'
          }`}>
            {space.name}
          </h3>
          <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${getTypeColor(space.type)}`}>
            {getTypeLabel(space.type)}
          </span>
        </div>
      </div>

      {/* Description */}
      {showDescription && (
        <p className="text-[11px] text-[var(--text-tertiary)] line-clamp-2 flex-1 leading-relaxed">
          {space.description || '\u00A0'}
        </p>
      )}

      {/* Bottom stats */}
      <div className="flex items-center gap-3 mt-auto pt-2 text-[11px] text-[var(--text-tertiary)]">
        <div className="flex items-center gap-1">
          <FolderOpen className="h-3 w-3" />
          <span className="font-medium">{space.projects_count || 0}</span>
        </div>
        <div className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          <span className="font-medium">{totalUsers}</span>
        </div>
        {canManage && (
          <button
            onClick={handleCreateProject}
            className="ml-auto flex items-center justify-center h-5 w-5 rounded bg-[var(--color-primary-500)] hover:bg-[var(--color-primary-600)] text-white transition-colors"
            title={t('projects.createButton') || 'Create project'}
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); navigate(`/spaces/${space.id}`); }}
          className="flex items-center justify-center h-5 w-5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          title={t('common.open') || 'Open'}
        >
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>
    </div>
  );

  // MODULE: Projects list (scrollable)
  const renderProjectsModule = () => {
    const projects = (space as any).projects || [];
    const projectsCount = space.projects_count || projects.length || 0;
    
    return (
      <div className="flex flex-col h-full p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <FolderOpen className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <span className="text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wide">
            {t('spaces.tabs.projects') || 'Проекты'}
          </span>
          <span className="ml-auto text-xs font-semibold text-[var(--text-primary)]">
            {projectsCount}
          </span>
        </div>
        
        <div className="flex-1 overflow-y-auto space-y-0.5 scrollbar-thin scrollbar-thumb-[var(--border-primary)] scrollbar-track-transparent">
          {projects.length > 0 ? (
            projects.map((project: SpaceProject) => (
              <button
                key={project.id}
                onClick={(e) => { e.stopPropagation(); navigate(`/projects/${project.id}/dashboard`); }}
                className="w-full flex items-center gap-2 text-left text-[11px] py-1 px-1.5 rounded hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <span className="text-sm flex-shrink-0">{project.icon || '📂'}</span>
                <span className="text-[var(--text-secondary)] truncate">{project.name}</span>
              </button>
            ))
          ) : (
            <div className="text-[11px] text-[var(--text-tertiary)]">
              {t('spaces.card.noProjects') || 'Пока нет проектов'}
            </div>
          )}
        </div>
      </div>
    );
  };

  // MODULE: Team/Users list (scrollable)
  const renderTeamModule = () => {
    const users = (space as any).users || [];
    
    const roleColors: Record<string, string> = {
      owner: 'bg-purple-500',
      admin: 'bg-primary-500',
      editor: 'bg-green-500',
      viewer: 'bg-gray-400'
    };
    
    return (
      <div className="flex flex-col h-full p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Users className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <span className="text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wide">
            {t('spaces.tabs.roles') || 'Команда'}
          </span>
          <span className="ml-auto text-xs font-semibold text-[var(--text-primary)]">
            {totalUsers}
          </span>
        </div>
        
        <div className="flex-1 overflow-y-auto space-y-0.5 scrollbar-thin scrollbar-thumb-[var(--border-primary)] scrollbar-track-transparent">
          {users.length > 0 ? (
            users.map((user: SpaceUser) => (
              <button
                key={user.id}
                onClick={(e) => { e.stopPropagation(); /* navigate to user profile */ }}
                className="w-full flex items-center gap-2 text-left text-[11px] py-1 px-1.5 rounded hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <div className="h-5 w-5 flex-shrink-0 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-[10px] font-medium text-[var(--text-secondary)]">
                  {user.name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <span className="text-[var(--text-secondary)] truncate flex-1">{user.name}</span>
                <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${roleColors[user.role] || 'bg-gray-400'}`} />
              </button>
            ))
          ) : (
            <div className="text-[11px] text-[var(--text-tertiary)] text-center py-2">
              {t('spaces.card.noUsers') || 'Нет пользователей'}
            </div>
          )}
        </div>
      </div>
    );
  };

  // MODULE: Empty placeholder (for full width)
  const renderEmptyModule = () => (
    <div className="flex flex-col h-full p-3">
      <div className="flex-1 flex items-center justify-center">
        <button
          onClick={handleCreateProject}
          className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        >
          + {t('spaces.card.addModule') || 'Добавить модуль'}
        </button>
      </div>
    </div>
  );

  // Module renderer — index → which module to show.
  // Index 0: info (always). 1: projects. 2: team. ≥3: empty placeholder.
  const renderModuleAt = (i: number) => {
    if (i === 0) return renderInfoModule();
    if (i === 1) return renderProjectsModule();
    if (i === 2) return renderTeamModule();
    return renderEmptyModule();
  };

  // Inner module grid styles.
  //  - Desktop (mobileMode=false): one row, `moduleCount` columns.
  //  - Mobile (mobileMode=true): one column, `moduleCount` rows of `rowHeightPx`.
  const innerGridStyle: CSSProperties = mobileMode
    ? {
        gridTemplateColumns: '1fr',
        gridTemplateRows: `repeat(${moduleCount}, ${rowHeightPx}px)`,
      }
    : {
        gridTemplateColumns: `repeat(${moduleCount}, minmax(0, 1fr))`,
      };

  return (
    <div className="h-full w-full min-w-0">
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
        className={`
          group relative w-full h-full overflow-hidden rounded-xl border cursor-pointer
          transition-all duration-300 ease-out text-left
          ${
            isActive
              ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-50)] shadow-lg shadow-[var(--color-primary-200)] dark:bg-[var(--color-primary-950)] dark:shadow-[var(--color-primary-900)]'
              : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-[var(--color-primary-300)] hover:shadow-md'
          }
        `}
      >
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-[var(--color-primary-100)]/20 opacity-0 transition-opacity duration-300 group-hover:opacity-100 pointer-events-none" />

        {/* Grid of modules — minmax(0,1fr) lets modules shrink instead of
            forcing the card wider than its slot. */}
        <div
          className="relative h-full grid gap-0"
          style={innerGridStyle}
        >
          {Array.from({ length: moduleCount }, (_, i) => (
            <div key={i} className="min-w-0 min-h-0">
              {renderModuleAt(i)}
            </div>
          ))}
        </div>

        {/* Bottom border highlight */}
        <div className={`absolute bottom-0 left-0 right-0 h-1 transition-all duration-300 ${
          isActive
            ? 'bg-gradient-to-r from-[var(--color-primary-500)] via-[var(--color-secondary-500)] to-[var(--color-tertiary-500)]'
            : 'bg-transparent group-hover:bg-gradient-to-r group-hover:from-[var(--color-primary-300)] group-hover:via-[var(--color-secondary-300)] group-hover:to-[var(--color-tertiary-300)]'
        }`} />
      </div>
    </div>
  );
};
