/**
 * Desktop Tab Bar Component
 * Browser-like tabs displayed in the header between breadcrumbs and action buttons
 * - Active tab pinned to the left
 * - Other tabs scroll horizontally (hidden scrollbar)
 * - Close button on hover
 * - Context menu for tab actions
 */

import { useRef, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { X, Circle, Home, LayoutDashboard, Settings, HelpCircle } from 'lucide-react';
import { useTabsStore, Tab, getTabTypeFromPath } from '@/shared/stores/tabsStore';
import { isDesktopApp } from '@/shared/types/electron.types';
import { cn } from '@/shared/utils/cn';
import { useLanguage } from '@/shared/i18n/LanguageContext';

// Tab type colors
const tabTypeColors: Record<Tab['type'], string> = {
  space: 'text-blue-400',
  project: 'text-purple-400',
  table: 'text-green-400',
  widget: 'text-cyan-400',
  settings: 'text-gray-400',
  other: 'text-gray-400',
};

// Special icon identifiers for lucide icons (used instead of emoji)
const SPECIAL_ICONS: Record<string, React.FC<{ className?: string }>> = {
  '__home__': Home,
  '__dashboard__': LayoutDashboard,
  '__settings__': Settings,
  '__help__': HelpCircle,
};

// Render tab icon - supports special lucide icons and emoji
const renderTabIcon = (icon: string | undefined, type: Tab['type']) => {
  if (!icon) {
    return <Circle className={cn('w-2 h-2 flex-shrink-0', tabTypeColors[type])} fill="currentColor" />;
  }
  
  // Check for special lucide icon
  const LucideIcon = SPECIAL_ICONS[icon];
  if (LucideIcon) {
    return <LucideIcon className="w-3.5 h-3.5 flex-shrink-0" />;
  }
  
  // Regular emoji
  return <span className="text-sm flex-shrink-0">{icon}</span>;
};

interface TabItemProps {
  tab: Tab;
  isActive: boolean;
  onClose: (e: React.MouseEvent) => void;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const TabItem = ({ tab, isActive, onClose, onClick, onContextMenu }: TabItemProps) => {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div role="presentation"
      className={cn(
        'group flex items-center gap-1.5 px-3 py-1.5 rounded-md cursor-pointer transition-all duration-150 select-none whitespace-nowrap',
        'border border-transparent',
        isActive
          ? 'bg-[var(--bg-primary)] border-[var(--border-primary)] text-[var(--text-primary)] shadow-sm'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
      )}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title={tab.title}
    >
      {/* Icon */}
      {renderTabIcon(tab.icon, tab.type)}
      
      {/* Title */}
      <button type="button" aria-pressed={isActive} className="text-xs font-medium truncate max-w-[120px]">
        {tab.title}
      </button>
      
      {/* Dirty indicator or Close button */}
      {tab.isDirty && !isHovered ? (
        <Circle className="w-2 h-2 flex-shrink-0 text-[var(--accent-primary)]" fill="currentColor" />
      ) : (
        <button
          onClick={onClose}
          className={cn(
            'p-0.5 rounded hover:bg-[var(--bg-tertiary)] transition-opacity flex-shrink-0',
            isHovered || isActive ? 'opacity-100' : 'opacity-0'
          )}
          title={t('Закрыть вкладку', 'Close tab')}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};

export const DesktopTabBar = () => {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const navigate = useNavigate();
  const location = useLocation();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  const { tabs, activeTabId, openTab, closeTab, setActiveTab, closeOtherTabs, getTabByPath } = useTabsStore();
  
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);

  const activeTab = tabs.find(t => t.id === activeTabId);
  const otherTabs = tabs.filter(t => t.id !== activeTabId);

  const handleTabClick = (tab: Tab) => {
    setActiveTab(tab.id);
    navigate(tab.path);
  };

  const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    const tab = tabs.find(t => t.id === tabId);
    const isClosingActive = tabId === activeTabId;
    
    closeTab(tabId);
    
    // Navigate to next tab if closing active
    if (isClosingActive) {
      const remainingTabs = tabs.filter(t => t.id !== tabId);
      if (remainingTabs.length > 0) {
        const tabIndex = tabs.findIndex(t => t.id === tabId);
        const nextTab = remainingTabs[Math.min(tabIndex, remainingTabs.length - 1)];
        if (nextTab) {
          navigate(nextTab.path);
        }
      } else {
        navigate('/');
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  };

  const handleCloseContextMenu = () => {
    setContextMenu(null);
  };

  const handleContextAction = (action: 'close' | 'closeOthers' | 'closeAll') => {
    if (!contextMenu) return;
    
    switch (action) {
      case 'close':
        handleCloseTab({ stopPropagation: () => {} } as React.MouseEvent, contextMenu.tabId);
        break;
      case 'closeOthers':
        closeOtherTabs(contextMenu.tabId);
        break;
      case 'closeAll':
        closeTab(contextMenu.tabId);
        // Navigate home after closing all
        navigate('/');
        break;
    }
    handleCloseContextMenu();
  };

  // Scroll active tab into view
  useEffect(() => {
    if (scrollContainerRef.current && activeTabId) {
      const activeElement = scrollContainerRef.current.querySelector(`[data-tab-id="${activeTabId}"]`);
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
      }
    }
  }, [activeTabId]);

  // Only render in desktop app
  if (!isDesktopApp()) return null;

  // Don't show if no tabs
  if (tabs.length === 0) return null;

  // Don't show if only active tab (no other tabs to display)
  if (otherTabs.length === 0) return null;

  return (
    <>
      <div 
        className="flex items-center gap-1 min-w-0 max-w-[400px] flex-shrink"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Separator before tabs (after breadcrumbs) */}
        <div className="w-px h-4 bg-[var(--border-primary)] flex-shrink-0 mr-1" />
        
        {/* Other tabs - scrollable (active tab not shown, breadcrumbs show current location) */}
        <div
          ref={scrollContainerRef}
          className="flex items-center gap-1 overflow-x-auto scrollbar-none min-w-0"
          style={{ 
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
        >
          {otherTabs.map(tab => (
            <div key={tab.id} data-tab-id={tab.id}>
              <TabItem
                tab={tab}
                isActive={false}
                onClick={() => handleTabClick(tab)}
                onClose={(e) => handleCloseTab(e, tab.id)}
                onContextMenu={(e) => handleContextMenu(e, tab.id)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <button type="button" aria-label={t("Закрыть меню вкладки", "Close tab menu")}
            className="fixed inset-0 z-50" 
            onClick={handleCloseContextMenu}
            onContextMenu={(e) => { e.preventDefault(); handleCloseContextMenu(); }}
          />
          <div
            className="fixed z-50 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-lg py-1 min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => handleContextAction('close')}
              className="w-full px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
            >
              {t('Закрыть вкладку', 'Close tab')}
            </button>
            <button
              onClick={() => handleContextAction('closeOthers')}
              className="w-full px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
            >
              {t('Закрыть другие', 'Close others')}
            </button>
            <button
              onClick={() => handleContextAction('closeAll')}
              className="w-full px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
            >
              {t('Закрыть все', 'Close all')}
            </button>
          </div>
        </>
      )}
    </>
  );
};
