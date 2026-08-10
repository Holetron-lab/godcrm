import { useState } from 'react';
import { Database, Plus, RefreshCw, Settings, Trash2 } from 'lucide-react';
import type { PresetWidgetProps } from '../../types/widget.types';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useDataSources, useDeleteDataSource, useTestConnection } from '@/features/data-sources/hooks/useDataSources';
import { DataSourceWizard } from '@/features/data-sources/components/DataSourceWizard';
import { formatDistanceToNow } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';

const statusConfig = {
  connected: {
    icon: '✅',
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
  },
  disconnected: {
    icon: '❌',
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-900/20',
  },
  testing: {
    icon: '🔄',
    color: 'text-yellow-600 dark:text-yellow-400',
    bgColor: 'bg-yellow-50 dark:bg-yellow-900/20',
  },
  error: {
    icon: '⚠️',
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-50 dark:bg-orange-900/20',
  }
};

const dbIcons: Record<string, string> = {
  mysql: '🐬',
  postgresql: '🐘',
  sqlite: '📦'
};

/**
 * Data Sources Widget - управление источниками данных
 */
export function DataSourcesWidget({ widget }: PresetWidgetProps) {
  const { t, language } = useLanguage();
  const [showWizard, setShowWizard] = useState(false);
  
  // Get workspaceId from widget config
  const workspaceId = widget.config?.workspace_id || '1';
  
  const { dataSources, loading } = useDataSources(workspaceId);
  const deleteMutation = useDeleteDataSource();
  const testMutation = useTestConnection();

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this data source?')) {
      await deleteMutation.mutateAsync({ id, workspaceId });
    }
  };

  const handleTest = async (id: string) => {
    await testMutation.mutateAsync(id);
  };

  const formatLastSync = (dateStr: string | null | undefined) => {
    if (!dateStr) return t('dataSources.card.never');
    
    try {
      const locale = language === 'ru' ? ru : enUS;
      return formatDistanceToNow(new Date(dateStr), {
        addSuffix: true,
        locale
      });
    } catch {
      return t('dataSources.card.never');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm text-[var(--text-secondary)]">Loading data sources...</div>
      </div>
    );
  }

  if (!dataSources || dataSources.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--text-secondary)]">
        <Database className="w-12 h-12 mb-3 opacity-50" />
        <p className="text-sm mb-4">No data sources configured</p>
        <button
          onClick={() => setShowWizard(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Data Source
        </button>
        
        {showWizard && (
          <DataSourceWizard
            workspaceId={workspaceId}
            onClose={() => setShowWizard(false)}
            onSuccess={() => setShowWizard(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--border-primary)]">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Database className="w-4 h-4" />
          Data Sources ({dataSources.length})
        </h3>
        <button
          onClick={() => setShowWizard(true)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors text-xs"
        >
          <Plus className="w-3 h-3" />
          Add
        </button>
      </div>

      {/* Data Sources List */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {dataSources.map((ds) => {
          const currentStatus = ds.status || 'disconnected';
          const status = statusConfig[currentStatus];
          const dbIcon = dbIcons[ds.type] || '🔌';

          return (
            <div
              key={ds.id}
              className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 hover:border-primary-400 dark:hover:border-primary-600 transition-colors"
            >
              {/* DS Header */}
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-xl flex-shrink-0">{dbIcon}</span>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-medium text-[var(--text-primary)] text-sm truncate">
                      {ds.name}
                    </h4>
                    <p className="text-xs text-[var(--text-tertiary)]">
                      {ds.type.toUpperCase()} • {ds.host}
                    </p>
                  </div>
                </div>
                
                {/* Status Badge */}
                <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${status.bgColor} ${status.color}`}>
                  <span>{status.icon}</span>
                  <span className="capitalize">{currentStatus}</span>
                </div>
              </div>

              {/* Meta Info */}
              <div className="flex items-center gap-3 text-xs text-[var(--text-tertiary)] mb-2">
                <span>Tables: {ds.tables_count || 0}</span>
                <span>•</span>
                <span>Last sync: {formatLastSync(ds.last_sync_at)}</span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleTest(ds.id)}
                  disabled={testMutation.isPending}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-primary-600 hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-900/20 transition-colors disabled:opacity-50"
                  title="Test Connection"
                >
                  <RefreshCw className={`w-3 h-3 ${testMutation.isPending ? 'animate-spin' : ''}`} />
                  Test
                </button>
                <button
                  onClick={() => {/* TODO: Open edit modal */}}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 transition-colors"
                  title="Edit"
                >
                  <Settings className="w-3 h-3" />
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(ds.id)}
                  disabled={deleteMutation.isPending}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                  title="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Wizard Modal */}
      {showWizard && (
        <DataSourceWizard
          workspaceId={workspaceId}
          onClose={() => setShowWizard(false)}
          onSuccess={() => setShowWizard(false)}
        />
      )}
    </div>
  );
}
