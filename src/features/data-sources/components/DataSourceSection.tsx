import { useState, useEffect } from 'react';
import { logger } from '@/shared/utils/logger';
import { DataSourceCard } from './DataSourceCard';
import { DataSourceWizard } from './DataSourceWizard';
import { ConnectTableDialog } from './ConnectTableDialog';
import { useDataSource } from '../hooks/useDataSource';
import { useDeleteDataSource } from '../hooks/useDataSources';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface DataSourceSectionProps {
  tableId: string;
  workspaceId: string;
  dataSourceId?: string | null;
}

export function DataSourceSection({ tableId, workspaceId, dataSourceId }: DataSourceSectionProps) {
  const { t } = useLanguage();
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [editingDataSourceId, setEditingDataSourceId] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  
  const { data: dataSource, isLoading } = useDataSource(dataSourceId || '');
  const deleteMutation = useDeleteDataSource();
  
  // Debug: track isConnecting state changes
  useEffect(() => {
  }, [isConnecting]);
  
  // Safety check after hooks
  if (!tableId) {
    return null;
  }

  const handleEdit = () => {
    if (dataSourceId) {
      setEditingDataSourceId(dataSourceId);
      setIsWizardOpen(true);
    }
  };

  const handleDelete = async () => {
    if (!dataSourceId) return;
    
    if (confirm(t('dataSources.deleteConfirm'))) {
      try {
        await deleteMutation.mutateAsync({ id: dataSourceId, workspaceId });
        window.location.reload();
      } catch (error) {
        logger.error('Delete error:', error);
      }
    }
  };

  const handleTest = () => {
    setIsConnecting(true);
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-6">
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('common.loading')}</p>
      </div>
    );
  }

  // Show existing data source
  if (dataSource) {
    return (
      <>
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('dataSources.title')}
          </h3>
          <div className="max-w-[400px]">
            <DataSourceCard
              dataSource={dataSource}
              onTest={handleTest}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          </div>
        </div>

        {isWizardOpen && (
          <DataSourceWizard
            workspaceId={workspaceId}
            dataSourceId={editingDataSourceId}
            onClose={() => {
              setIsWizardOpen(false);
              setEditingDataSourceId(null);
            }}
          />
        )}

        {isConnecting && dataSourceId ? (
          <ConnectTableDialog
            dataSourceId={dataSourceId}
            tableId={tableId}
            onClose={() => {
              setIsConnecting(false);
            }}
            onSuccess={() => {
              setIsConnecting(false);
              window.location.reload();
            }}
          />
        ) : null}
      </>
    );
  }

  // Show "Add data source" placeholder
  return (
    <>
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('dataSources.title')}
        </h3>
        <button
          onClick={() => setIsWizardOpen(true)}
          className="w-full max-w-[400px] rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-8 text-center transition-all hover:border-primary-400 hover:bg-primary-50 dark:hover:border-primary-600 dark:hover:bg-primary-900/20 group"
        >
          <div className="flex flex-col items-center gap-2">
            <span className="text-3xl group-hover:scale-110 transition-transform">🔗</span>
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400 group-hover:text-primary-600 dark:group-hover:text-primary-400">
              {t('dataSources.emptyStateAction')}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-500">
              {t('dataSources.emptyStateDescription')}
            </span>
          </div>
        </button>
      </div>

      {isWizardOpen && (
        <DataSourceWizard
          workspaceId={workspaceId}
          onClose={() => setIsWizardOpen(false)}
          onSuccess={() => {
            // Reload page to show new data source
            window.location.reload();
          }}
        />
      )}
    </>
  );
}
