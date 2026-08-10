import { useParams } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { DashboardGrid } from '@/features/widgets';
import { AddWidgetModal } from '@/features/widgets/components/AddWidgetModal';
import { Plus, X, Edit, Settings } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { setDashboardTitle } from '@/shared/utils/pageTitle';
import { useStatusBar } from '@/shared/components/desktop/StatusBarContext';

export function DashboardPage() {
  const { projectId } = useParams<{ projectId: string }>();
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

  // Fetch project dashboard
  const { data: dashboardData, isLoading, error } = useQuery({
    queryKey: ['project-dashboard', projectId],
    queryFn: async () => {
      return await apiClient.get<{ success: boolean; data: { id: number; name: string } }>(`/projects/${projectId}/dashboard`);
    },
    enabled: !!projectId,
  });
  
  // Update page title when dashboard loads
  useEffect(() => {
    if (dashboardData?.data?.name) {
      setDashboardTitle(dashboardData.data.name);
    }
  }, [dashboardData]);

  // Register status bar actions (must be before any early returns)
  useEffect(() => {
    // Only show actions when we have valid data
    if (!dashboardData?.data) {
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
  }, [dashboardData, isEditable, showSettings, borderRadius, widgetGap, setActions]);

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
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
        <div className="text-center">
          <p className="text-base text-[var(--color-error)]">⚠️ {t('dashboards.errorLoading')}</p>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  if (!dashboardData?.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
        <div className="text-center">
          <p className="text-base text-[var(--text-secondary)]">{t('dashboards.dashboardNotAvailable')}</p>
          <p className="mt-2 text-sm text-[var(--text-tertiary)]">{t('dashboards.contactAdmin')}</p>
        </div>
      </div>
    );
  }

  const dashboard = dashboardData.data;

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
            onWidgetCreated={handleWidgetCreated}
          />
        )}
      </div>
    </div>
  );
}
