import { useState, useEffect } from 'react';
import { logger } from '@/shared/utils/logger';
import { useParams, useNavigate } from 'react-router-dom';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { DashboardGrid } from '@/features/widgets';
import { AddWidgetModal } from '@/features/widgets/components/AddWidgetModal';
import { useProjectStore } from '@/features/projects/store/projectStore';

const DashboardPage = () => {
  const { t } = useLanguage();
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [isEditable, setIsEditable] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  
  const projects = useProjectStore(state => state.projects);
  const currentProject = projects.find(p => p.id === Number(projectId));
  
  // Redirect if project not found
  useEffect(() => {
    if (projectId && !currentProject) {
      logger.error('[DashboardPage] Project not found:', projectId);
      navigate('/spaces');
    }
  }, [projectId, currentProject, navigate]);

  // TODO: Get dashboard ID from project or create default one
  // For now, hardcode to dashboard 9
  const dashboardId = 9;
  
  if (!currentProject) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-[var(--text-secondary)]">Loading project...</p>
      </div>
    );
  }

  const handleAddWidget = () => {
    setShowAddModal(true);
  };

  const handleWidgetCreated = () => {
    // Modal will close automatically, grid will refetch via React Query
  };

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-[var(--text-secondary)]">Project Dashboard</p>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
            {currentProject.icon} {currentProject.name}
          </h1>
          <p className="max-w-2xl text-base text-[var(--text-secondary)]">
            {currentProject.description || 'Project workspace with widgets and tables'}
          </p>
        </div>

        {/* Edit Mode Toggle */}
        <button
          onClick={() => setIsEditable(!isEditable)}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            isEditable
              ? 'bg-primary-600 text-white hover:bg-primary-700'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
        >
          {isEditable ? '✅ Edit Mode ON' : '✏️ Edit Mode OFF'}
        </button>
      </header>

      {/* Widget Grid */}
      <DashboardGrid
        dashboardId={dashboardId}
        isEditable={isEditable}
        onAddWidget={handleAddWidget}
      />

      {/* Add Widget Modal */}
      <AddWidgetModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        dashboardId={dashboardId}
        onWidgetCreated={handleWidgetCreated}
      />
    </section>
  );
};

export default DashboardPage;
