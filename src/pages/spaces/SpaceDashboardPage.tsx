import { Link, useParams } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { DashboardGrid } from '@/features/widgets';
import { AddWidgetModal } from '@/features/widgets/components/AddWidgetModal';
import { useSpaceQuery } from '@/features/spaces/hooks/useSpacesQuery';
import { Plus, X, Edit, Settings } from 'lucide-react';
import { setSpaceTitle } from '@/shared/utils/pageTitle';
import NotFoundPage from '@/pages/NotFoundPage';
import { useStatusBar } from '@/shared/components/desktop/StatusBarContext';

export function SpaceDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const spaceId = id ? parseInt(id) : null;
  const { t } = useLanguage();
  const [isEditable, setIsEditable] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [borderRadius, setBorderRadius] = useState(12);
  const [widgetGap, setWidgetGap] = useState(16);
  const settingsRef = useRef<HTMLDivElement>(null);
  const { setActions } = useStatusBar();

  // Close settings dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setShowSettings(false);
      }
    };

    if (showSettings) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSettings]);

  // Fetch space data including dashboard
  const { data: spaceData, isLoading, error } = useSpaceQuery(spaceId);
  
  // Update page title when space loads
  useEffect(() => {
    if (spaceData?.name) {
      setSpaceTitle(spaceData.name);
    }
  }, [spaceData]);

  // Register status bar actions (must be before any early returns)
  useEffect(() => {
    // Only show actions when we have valid data
    if (!spaceData?.dashboard) {
      setActions([]);
      return;
    }
    
    setActions([
      {
        id: 'dashboard-edit',
        component: (
          <button
            onClick={() => setIsEditable(prev => !prev)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors ${
              isEditable
                ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                : "hover:bg-white/10"
            }`}
            title={isEditable ? t('dashboardPage.disableEditing') : t('dashboardPage.edit')}
          >
            {isEditable ? <X className="w-3 h-3" /> : <Edit className="w-3 h-3" />}
          </button>
        )
      },
      ...(isEditable ? [
        {
          id: 'dashboard-add-widget',
          component: (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-[var(--color-primary-500)] hover:bg-white/10 transition-colors"
              title={t('dashboardPage.addWidget')}
            >
              <Plus className="w-3 h-3" />
            </button>
          )
        },
        {
          id: 'dashboard-settings',
          component: (
            <div className="relative" ref={settingsRef}>
              <button
                onClick={() => setShowSettings(prev => !prev)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors ${
                  showSettings ? "bg-white/20" : "hover:bg-white/10"
                }`}
                title={t('dashboardPage.settings')}
              >
                <Settings className="w-3 h-3" />
              </button>
              {showSettings && (
                <div className="absolute left-0 bottom-full mb-2 w-64 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg p-3 z-50">
                  <div className="space-y-3">
                    <div>
                      <label className="flex items-center justify-between text-xs text-[var(--text-primary)] mb-1">
                        <span>{t('dashboardPage.radius')}</span>
                        <span className="text-[var(--text-tertiary)]">{borderRadius}px</span>
                      </label>
                      <input type="range" min="0" max="24" value={borderRadius} onChange={(e) => setBorderRadius(parseInt(e.target.value))} className="w-full h-1.5 rounded appearance-none cursor-pointer" style={{ accentColor: 'var(--color-primary-500)' }} />
                    </div>
                    <div>
                      <label className="flex items-center justify-between text-xs text-[var(--text-primary)] mb-1">
                        <span>{t('dashboardPage.padding')}</span>
                        <span className="text-[var(--text-tertiary)]">{widgetGap}px</span>
                      </label>
                      <input type="range" min="4" max="32" value={widgetGap} onChange={(e) => setWidgetGap(parseInt(e.target.value))} className="w-full h-1.5 rounded appearance-none cursor-pointer" style={{ accentColor: 'var(--color-primary-500)' }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        }
      ] : [])
    ]);
    
    return () => setActions([]);
  }, [spaceData, isEditable, showSettings, borderRadius, widgetGap, setActions]);

  const handleAddWidget = () => {
    setShowAddModal(true);
  };

  const handleWidgetCreated = () => {
    // Modal will close automatically, grid will refetch via React Query
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
        <p className="text-base text-[var(--text-secondary)]">{t('dashboards.loadingWorkspace')}</p>
      </div>
    );
  }

  if (error) {
    const errorMessage = (error as Error).message;
    const isNotFound = errorMessage.includes('NOT_FOUND') || errorMessage.includes('not found');
    const isAccessDenied = errorMessage.includes('ACCESS_DENIED') || errorMessage.includes('access denied');

    if (isNotFound) {
      return <NotFoundPage />;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[var(--bg-primary)] via-[var(--bg-secondary)] to-[var(--bg-primary)] p-6">
        <div className="max-w-2xl text-center space-y-8">
          {/* Animated 404 Icon */}
          <div className="relative inline-block">
            <div className="text-9xl font-black bg-gradient-to-r from-purple-500 via-pink-500 to-primary-500 bg-clip-text text-transparent animate-pulse">
              {isNotFound ? '404' : isAccessDenied ? '🔒' : '⚠️'}
            </div>
            {isNotFound && (
              <div className="absolute -top-4 -right-4 text-6xl animate-bounce">
                👻
              </div>
            )}
            {isAccessDenied && (
              <div className="absolute -top-4 -right-4 text-6xl animate-bounce">
                🚫
              </div>
            )}
          </div>

          {/* Error Message */}
          <div className="space-y-4">
            <h1 className="text-4xl font-bold text-[var(--text-primary)]">
              {isNotFound && t('spaceDashboard.notFoundTitle')}
              {isAccessDenied && t('spaceDashboard.accessDeniedTitle')}
              {!isNotFound && !isAccessDenied && t('spaceDashboard.errorTitle')}
            </h1>
            <p className="text-xl text-[var(--text-secondary)]">
              {isNotFound && t('spaceDashboard.notFoundDesc')}
              {isAccessDenied && t('spaceDashboard.accessDeniedDesc')}
              {!isNotFound && !isAccessDenied && t('spaceDashboard.errorDesc')}
            </p>
            {!isNotFound && !isAccessDenied && (
              <p className="text-sm text-[var(--text-tertiary)] font-mono bg-[var(--bg-secondary)] p-3 rounded-lg border border-[var(--border-primary)]">
                {errorMessage}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link
              to="/spaces"
              className="px-8 py-3 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold shadow-lg hover:shadow-xl transition-all hover:scale-105 active:scale-100"
            >
              🏠 {t('spaceDashboard.backToSpaces')}
            </Link>
            {isNotFound && (
              <button
                onClick={() => window.location.reload()}
                className="px-8 py-3 rounded-xl border-2 border-[var(--border-primary)] text-[var(--text-primary)] font-semibold hover:bg-[var(--bg-secondary)] transition-all"
              >
                🔄 {t('spaceDashboard.retry')}
              </button>
            )}
          </div>

          {/* Fun Facts */}
          <div className="pt-8 border-t border-[var(--border-primary)]">
            <p className="text-sm text-[var(--text-tertiary)] italic">
              {isNotFound && `💡 ${t('spaceDashboard.tipNotFound')}`}
              {isAccessDenied && `💡 ${t('spaceDashboard.tipAccessDenied')}`}
              {!isNotFound && !isAccessDenied && `💡 ${t('spaceDashboard.tipError')}`}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!spaceData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
        <p className="text-base text-[var(--text-secondary)]">{t('dashboards.workspaceNotFound')}</p>
      </div>
    );
  }

  if (!spaceData.dashboard) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
        <div className="text-center">
          <p className="text-base text-[var(--text-secondary)]">{t('dashboards.dashboardNotAvailable')}</p>
          <p className="mt-2 text-sm text-[var(--text-tertiary)]">{t('dashboards.contactAdmin')}</p>
        </div>
      </div>
    );
  }

  const dashboard = spaceData.dashboard;

  return (
    <div className="bg-[var(--bg-primary)] px-0 py-0 sm:p-2">
      <div className="w-full">
        {/* Widget Grid */}
        {dashboard && (
          <DashboardGrid
            dashboardId={dashboard.id}
            isEditable={isEditable}
            borderRadius={borderRadius}
            widgetGap={widgetGap}
          />
        )}

        {/* Add Widget Modal */}
        {dashboard && (
          <AddWidgetModal
            isOpen={showAddModal}
            onClose={() => setShowAddModal(false)}
            dashboardId={dashboard.id}
            spaceId={spaceId ?? undefined}
            onWidgetCreated={handleWidgetCreated}
          />
        )}
      </div>
    </div>
  );
}
