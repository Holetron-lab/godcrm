import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useDataSources, useDeleteDataSource, useTestConnection } from '../hooks/useDataSources';
import { DataSourceCard } from '../components/DataSourceCard';
import { DataSourceWizard } from '../components/DataSourceWizard';
import { Button } from '@/shared/components/ui/Button';

export default function DataSourcesPage() {
  const { t } = useLanguage();
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  
  // For now, using projectId as workspaceId (will need to map later)
  const workspaceId = projectId || '1';
  
  const { dataSources, loading } = useDataSources(workspaceId);
  const deleteMutation = useDeleteDataSource();
  const testMutation = useTestConnection();
  
  const [showWizard, setShowWizard] = useState(false);

  const handleDelete = async (id: string) => {
    if (window.confirm(t('dataSources.messages.deleteConfirm'))) {
      await deleteMutation.mutateAsync({ id, workspaceId });
    }
  };

  const handleTest = async (id: string) => {
    await testMutation.mutateAsync(id);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 dark:text-gray-400">
          {t('common.loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            {t('dataSources.title')}
          </h1>
          <Button
            onClick={() => setShowWizard(true)}
            variant="primary"
          >
            + {t('dataSources.createButton')}
          </Button>
        </div>
        <p className="text-gray-600 dark:text-gray-400">
          {t('dataSources.subtitle')}
        </p>
      </div>

      {/* Empty State */}
      {dataSources.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 px-4 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
          <div className="text-6xl mb-4">🔌</div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            {t('dataSources.emptyStateTitle')}
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {t('dataSources.emptyStateDescription')}
          </p>
          <Button
            onClick={() => setShowWizard(true)}
            variant="primary"
          >
            {t('dataSources.emptyStateAction')}
          </Button>
        </div>
      )}

      {/* Data Sources Grid */}
      {dataSources.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {dataSources.map((ds) => (
            <DataSourceCard
              key={ds.id}
              dataSource={ds}
              onTest={() => handleTest(ds.id)}
              onEdit={() => navigate(`/data-sources/${ds.id}/edit`)}
              onDelete={() => handleDelete(ds.id)}
            />
          ))}
        </div>
      )}

      {/* Wizard Modal */}
      {showWizard && (
        <DataSourceWizard
          workspaceId={workspaceId}
          onClose={() => setShowWizard(false)}
          onSuccess={() => {
            setShowWizard(false);
          }}
        />
      )}
    </div>
  );
}
