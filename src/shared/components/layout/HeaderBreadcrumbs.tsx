import { Link } from 'react-router-dom';
import type { Widget } from '@/features/widgets/types/widget.types';

interface BreadcrumbSpace {
  id: number;
  name: string;
  icon?: string | null;
}

interface BreadcrumbProject {
  id: number;
  name: string;
  icon?: string | null;
  logo?: string | null;
}

interface BreadcrumbTable {
  id: string;
  name: string;
  displayName?: string | null;
}

export interface HeaderBreadcrumbsProps {
  t: (key: string) => string;
  pathname: string;
  currentSpace: BreadcrumbSpace | null;
  displayProject: BreadcrumbProject | null;
  currentTable: BreadcrumbTable | null;
  currentWidgetId: string | null;
  currentWidget: Widget | null;
}

export const HeaderBreadcrumbs = ({
  t,
  pathname,
  currentSpace,
  displayProject,
  currentTable,
  currentWidgetId,
  currentWidget,
}: HeaderBreadcrumbsProps) => {
  const items: Array<{ icon?: string; name: string; href?: string }> = [];

  // Check if we're on home/spaces page - show Home only
  const isHomePage = pathname === '/' || pathname === '/spaces';
  const isSettingsPage = pathname === '/settings';
  const isHelpPage = pathname === '/help';
  const isSchemaEditorPage = pathname.startsWith('/schema-editor');

  if (isHomePage) {
    // Don't show anything on home page - just the logo is enough
    // Return early - don't add space/project
  } else if (isSettingsPage) {
    items.push({
      name: t('nav.settings') || 'Settings'
    });
  } else if (isHelpPage) {
    items.push({
      name: t('nav.help') || 'Help'
    });
  } else if (isSchemaEditorPage) {
    // Schema editor - show space if available
    if (currentSpace) {
      items.push({
        icon: currentSpace.icon || '📁',
        name: currentSpace.name,
        href: `/spaces/${currentSpace.id}/dashboard`
      });
    }
    items.push({
      icon: '🗂️',
      name: t('nav.schemaEditor') || 'Schema Editor'
    });
  } else {
    // Normal navigation - add space and project

    // Add space
    if (currentSpace) {
      items.push({
        icon: currentSpace.icon || '📁',
        name: currentSpace.name,
        href: `/spaces/${currentSpace.id}/dashboard`
      });
    }

    // Add project
    if (displayProject) {
      items.push({
        icon: displayProject.icon || displayProject.logo || '📂',
        name: displayProject.name,
        href: `/projects/${displayProject.id}`
      });
    }

    // Check for special project sub-pages (automations, settings, etc.)
    const projectSubPageMatch = pathname.match(/^\/projects\/\d+\/(\w+)/);
    if (projectSubPageMatch && displayProject) {
      const subPage = projectSubPageMatch[1];
      const subPageLabels: Record<string, { icon: string; name: string }> = {
        automations: { icon: '⚡', name: t('nav.automations') || 'Automations' },
        settings: { icon: '⚙️', name: t('nav.settings') || 'Settings' },
        widgets: { icon: '🧩', name: t('nav.modules') || 'Modules' },
        tables: { icon: '📋', name: t('nav.tables') || 'Tables' },
        dashboard: { icon: '📊', name: t('nav.dashboard') || 'Dashboard' },
        create: { icon: '➕', name: 'Create' },
      };
      if (subPageLabels[subPage]) {
        items.push({
          icon: subPageLabels[subPage].icon,
          name: subPageLabels[subPage].name
        });
      }
    }

    // Add table (if not on widget page and not on project sub-page)
    if (currentTable && !currentWidgetId && !projectSubPageMatch) {
      items.push({
        icon: '📋',
        name: currentTable.name
      });
    }

    // Add widget
    if (currentWidgetId && currentWidget) {
      items.push({
        icon: currentWidget.icon || '🧩',
        name: currentWidget.title || `Module #${currentWidgetId}`
      });
    }
  }

  // Fallback if nothing matched (but NOT on home page)
  if (items.length === 0 && !isHomePage) {
    items.push({
      name: t('home.main') || 'Home'
    });
  }

  return (
    <>
      {/* On small screens: show ellipsis for hidden items, then last item */}
      {items.length > 1 && (
        <span className="md:hidden text-[var(--text-tertiary)] flex-shrink-0">...</span>
      )}

      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const isFirst = index === 0;

        return (
          <div
            key={index}
            className={`flex items-center gap-1.5 min-w-0 ${
              // On small screens: hide all except last
              !isLast ? 'hidden md:flex' : 'flex'
            }`}
          >
            {/* Separator */}
            {!isFirst && (
              <span className="text-[var(--text-tertiary)] flex-shrink-0 hidden md:inline">/</span>
            )}

            {/* Item */}
            {item.href && !isLast ? (
              <Link
                to={item.href}
                className="flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors truncate"
              >
                {item.icon && <span className="text-base flex-shrink-0">{item.icon}</span>}
                <span className="truncate">{item.name}</span>
              </Link>
            ) : (
              <span className={`flex items-center gap-1.5 truncate ${
                isLast ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
              }`}>
                {item.icon && <span className="text-base flex-shrink-0">{item.icon}</span>}
                <span className="truncate">{item.name}</span>
              </span>
            )}
          </div>
        );
      })}
    </>
  );
};
