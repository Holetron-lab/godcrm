import { useState } from 'react';
import { Database, Plus, RefreshCw, Settings, Trash2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useDataSources, useDeleteDataSource, useTestConnection } from '../hooks/useDataSources';
import { DataSourceWizard } from './DataSourceWizard';
import type { DataSource } from '../types/dataSource.types';

interface DataSourcesSectionProps {
  workspaceId: string;
}

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
 * Data Sources Section - секция управления источниками данных на дашборде
 */
export function DataSourcesSection({ workspaceId }: DataSourcesSectionProps) {
  const { t, language } = useLanguage();
  const [showWizard, setShowWizard] = useState(false);
  const [editingSource, setEditingSource] = useState<DataSource | null>(null);
  
  const { dataSources, loading } = useDataSources(workspaceId);
  const deleteMutation = useDeleteDataSource();
  const testMutation = useTestConnection();

  const handleDelete = async (id: string) => {
    if (window.confirm(t('dataSources.messages.deleteConfirm'))) {
      await deleteMutation.mutateAsync({ id, workspaceId });
    }
  };

  const handleTest = async (id: string) => {
    await testMutation.mutateAsync(id);
  };

  const handleEdit = (source: DataSource) => {
    setEditingSource(source);
    setShowWizard(true);
  };

  const handleCloseWizard = () => {
    setShowWizard(false);
    setEditingSource(null);
  };

  const formatLastSync = (dateStr: string | null | undefined) => {
    if (!dateStr) return t('dataSources.card.never');
    
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
      
      if (diffInMinutes < 1) return language === 'ru' ? 'только что' : 'just now';
      if (diffInMinutes < 60) return `${diffInMinutes} ${language === 'ru' ? 'мин назад' : 'min ago'}`;
      
      const diffInHours = Math.floor(diffInMinutes / 60);
      if (diffInHours < 24) return `${diffInHours} ${language === 'ru' ? 'ч назад' : 'h ago'}`;
      
      const diffInDays = Math.floor(diffInHours / 24);
      return `${diffInDays} ${language === 'ru' ? 'д назад' : 'd ago'}`;
    } catch {
      return t('dataSources.card.never');
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6">
        <div className="flex items-center justify-center">
          <div className="text-sm text-[var(--text-secondary)]">{t('common.loading')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Database className="w-6 h-6" />
            {t('dataSources.title')}
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {t('dataSources.subtitle')}
          </p>
        </div>
        <button
          onClick={() => setShowWizard(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)] transition-colors font-medium"
        >
          <Plus className="w-4 h-4" />
          {t('dataSources.createButton')}
        </button>
      </div>

      {/* Empty State */}
      {(!dataSources || dataSources.length === 0) && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Database className="w-16 h-16 mb-4 text-[var(--text-tertiary)] opacity-50" />
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
            {t('dataSources.emptyStateTitle')}
          </h3>
          <p className="text-sm text-[var(--text-secondary)] mb-6 max-w-md">
            {t('dataSources.emptyStateDescription')}
          </p>
          <button
            onClick={() => setShowWizard(true)}
            className="flex items-center gap-2 px-6 py-3 rounded-lg bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)] transition-colors font-medium"
          >
            <Plus className="w-5 h-5" />
            {t('dataSources.emptyStateAction')}
          </button>
        </div>
      )}

      {/* Data Sources Grid */}
      {dataSources && dataSources.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {dataSources.map((ds) => {
            const currentStatus = ds.status || 'disconnected';
            const status = statusConfig[currentStatus];
            const dbIcon = dbIcons[ds.type] || '🔌';

            return (
              <div
                key={ds.id}
                className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-4 hover:border-[var(--color-primary-400)] transition-all hover:shadow-md"
              >
                {/* DS Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="text-2xl flex-shrink-0">{dbIcon}</span>
                    <div className="min-w-0 flex-1">
                      <h4 className="font-semibold text-[var(--text-primary)] truncate">
                        {ds.name}
                      </h4>
                      <p className="text-xs text-[var(--text-tertiary)]">
                        {ds.type.toUpperCase()} • {ds.host}:{ds.port}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Status Badge */}
                <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium mb-3 ${status.bgColor} ${status.color}`}>
                  <span>{status.icon}</span>
                  <span className="capitalize">{t(`dataSources.card.status${currentStatus.charAt(0).toUpperCase() + currentStatus.slice(1)}`)}</span>
                </div>

                {/* Description */}
                {ds.description && (
                  <p className="text-sm text-[var(--text-secondary)] mb-3 line-clamp-2">
                    {ds.description}
                  </p>
                )}

                {/* Meta Info */}
                <div className="flex items-center gap-3 text-xs text-[var(--text-tertiary)] mb-4 pb-3 border-b border-[var(--border-primary)]">
                  <span>{t('dataSources.card.tables')}: {ds.table_count || 0}</span>
                  <span>•</span>
                  <span>{t('dataSources.card.lastSync')}: {formatLastSync(ds.last_sync_at)}</span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleTest(ds.id)}
                    disabled={testMutation.isPending}
                    className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-[var(--text-primary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] border border-[var(--border-primary)] transition-colors disabled:opacity-50"
                    title={t('dataSources.card.testConnection')}
                  >
                    <RefreshCw className={`w-4 h-4 ${testMutation.isPending ? 'animate-spin' : ''}`} />
                    {t('dataSources.card.testConnection')}
                  </button>
                  <button
                    onClick={() => handleEdit(ds)}
                    className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-[var(--text-primary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] border border-[var(--border-primary)] transition-colors"
                    title={t('dataSources.card.edit')}
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(ds.id)}
                    disabled={deleteMutation.isPending}
                    className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-[var(--border-primary)] transition-colors disabled:opacity-50"
                    title={t('dataSources.card.delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Wizard Modal */}
      {showWizard && (
        <DataSourceWizard
          workspaceId={workspaceId}
          dataSourceId={editingSource?.id}
          onClose={handleCloseWizard}
          onSuccess={handleCloseWizard}
        />
      )}
    </div>
  );
}
