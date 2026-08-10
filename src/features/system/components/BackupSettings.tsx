/**
 * BackupSettings.tsx
 * ADR-039: Owner-only backup management UI
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { systemApi } from '../api/systemApi';
import { Button } from '@/shared/components/ui';
import { useAuthStore } from '@/features/auth/store/authStore';
import { Database, Download, Clock, HardDrive, RefreshCw, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatRelativeTime = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}д назад`;
  if (diffHours > 0) return `${diffHours}ч назад`;
  return 'только что';
};

export const BackupSettings = () => {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Only owner/admin can see this
  if (user?.role !== 'owner' && user?.role !== 'admin') {
    return null;
  }

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['system', 'backups'],
    queryFn: async () => {
      const response = await systemApi.fetchBackups();
      return response.data;
    }
  });

  const createBackupMutation = useMutation({
    mutationFn: systemApi.createBackup,
    onSuccess: (result) => {
      setAlert({ type: 'success', message: `Бекап создан: ${result.data.filename} (${result.data.size_mb} MB)` });
      queryClient.invalidateQueries({ queryKey: ['system', 'backups'] });
    },
    onError: (error: Error) => {
      setAlert({ type: 'error', message: error.message });
    }
  });

  const handleDownload = (filename: string) => {
    const url = systemApi.downloadBackup(filename);
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-4 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Database className="h-5 w-5 text-[var(--color-primary-500)]" />
          <div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Резервные копии БД</h3>
            <p className="text-sm text-[var(--text-secondary)]">Управление бекапами PostgreSQL</p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
          title="Обновить"
        >
          <RefreshCw className="h-4 w-4 text-[var(--text-tertiary)]" />
        </button>
      </div>

      {/* Alert */}
      {alert && (
        <div className={`flex items-center gap-2 p-3 rounded-lg ${
          alert.type === 'success' 
            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' 
            : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
        }`}>
          {alert.type === 'success' ? <CheckCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          <span className="text-sm">{alert.message}</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--color-primary-500)]" />
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 p-4 bg-[var(--bg-tertiary)] rounded-lg">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-[var(--text-tertiary)]" />
              <div>
                <p className="text-sm text-[var(--text-tertiary)]">Последний бекап</p>
                <p className="font-medium text-[var(--text-primary)]">
                  {data?.last_backup 
                    ? formatRelativeTime(data.last_backup.created_at)
                    : 'Нет данных'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <HardDrive className="h-5 w-5 text-[var(--text-tertiary)]" />
              <div>
                <p className="text-sm text-[var(--text-tertiary)]">Размер БД</p>
                <p className="font-medium text-[var(--text-primary)]">{data?.db_size_mb || 0} MB</p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              onClick={() => createBackupMutation.mutate()}
              disabled={createBackupMutation.isPending}
            >
              {createBackupMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Database className="h-4 w-4 mr-2" />
              )}
              Создать бекап
            </Button>
            {data?.last_backup && (
              <Button
                variant="secondary"
                onClick={() => handleDownload(data.last_backup!.filename)}
              >
                <Download className="h-4 w-4 mr-2" />
                Скачать последний
              </Button>
            )}
          </div>

          {/* Schedule Info */}
          <p className="text-sm text-[var(--text-tertiary)]">
            📅 Автоматические бекапы: ежедневно в {data?.schedule?.daily}, еженедельно {data?.schedule?.weekly}
          </p>

          {/* Backup History */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-[var(--text-secondary)]">История бекапов</h4>
            <div className="max-h-48 overflow-y-auto space-y-1 rounded-lg border border-[var(--border-primary)]">
              {data?.backups?.map((backup) => (
                <div 
                  key={backup.filename}
                  className="flex items-center justify-between p-3 border-b border-[var(--border-primary)] last:border-b-0 hover:bg-[var(--bg-tertiary)]"
                >
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-1 text-xs rounded ${
                      backup.type === 'weekly' 
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' 
                        : backup.type === 'manual'
                        ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                    }`}>
                      {backup.type}
                    </span>
                    <span className="text-sm text-[var(--text-primary)]">{formatDate(backup.created_at)}</span>
                    <span className="text-sm text-[var(--text-tertiary)]">{backup.size_mb} MB</span>
                  </div>
                  <button
                    onClick={() => handleDownload(backup.filename)}
                    className="p-2 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
                    title="Скачать"
                  >
                    <Download className="h-4 w-4 text-[var(--text-tertiary)]" />
                  </button>
                </div>
              ))}
              {(!data?.backups || data.backups.length === 0) && (
                <p className="text-sm text-[var(--text-tertiary)] text-center py-6">
                  Нет резервных копий
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default BackupSettings;
