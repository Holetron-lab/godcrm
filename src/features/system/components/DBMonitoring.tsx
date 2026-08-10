/**
 * DBMonitoring.tsx
 * ADR-039: Owner-only database monitoring UI
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { systemApi } from '../api/systemApi';
import { Button } from '@/shared/components/ui';
import { useAuthStore } from '@/features/auth/store/authStore';
import { Activity, Database, AlertTriangle, RefreshCw, Zap, Loader2, CheckCircle } from 'lucide-react';

const formatDate = (dateString: string | null) => {
  if (!dateString) return 'Никогда';
  const date = new Date(dateString);
  return date.toLocaleString('ru-RU', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export const DBMonitoring = () => {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Only owner/admin can see this
  if (user?.role !== 'owner' && user?.role !== 'admin') {
    return null;
  }

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['system', 'db-stats'],
    queryFn: async () => {
      const response = await systemApi.fetchDbStats();
      return response.data;
    },
    refetchInterval: 30000 // Refresh every 30 seconds
  });

  const vacuumMutation = useMutation({
    mutationFn: systemApi.runVacuum,
    onSuccess: (result) => {
      setAlert({ type: 'success', message: result.data.message });
      queryClient.invalidateQueries({ queryKey: ['system', 'db-stats'] });
    },
    onError: (error: Error) => {
      setAlert({ type: 'error', message: error.message });
    }
  });

  if (data?.database_type === 'sqlite') {
    return (
      <div className="space-y-4 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-[var(--color-primary-500)]" />
          <div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Мониторинг БД</h3>
            <p className="text-sm text-[var(--text-secondary)]">Мониторинг доступен только для PostgreSQL</p>
          </div>
        </div>
      </div>
    );
  }

  const connectionUsage = data?.max_connections 
    ? Math.round((data.active_connections || 0) / data.max_connections * 100)
    : 0;

  return (
    <div className="space-y-4 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-[var(--color-primary-500)]" />
          <div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">PostgreSQL Мониторинг</h3>
            <p className="text-sm text-[var(--text-secondary)]">Статистика и медленные запросы</p>
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
          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-4 p-4 bg-[var(--bg-tertiary)] rounded-lg">
            <div>
              <p className="text-sm text-[var(--text-tertiary)]">Соединения</p>
              <p className="text-xl font-bold text-[var(--text-primary)]">
                {data?.active_connections} / {data?.max_connections}
              </p>
              <span className={`text-xs px-2 py-1 rounded ${
                connectionUsage > 80 
                  ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' 
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
              }`}>
                {connectionUsage}%
              </span>
            </div>
            <div>
              <p className="text-sm text-[var(--text-tertiary)]">Размер БД</p>
              <p className="text-xl font-bold text-[var(--text-primary)]">{data?.db_size_mb} MB</p>
            </div>
            <div>
              <p className="text-sm text-[var(--text-tertiary)]">Последний VACUUM</p>
              <p className="font-medium text-[var(--text-primary)]">{formatDate(data?.last_vacuum || null)}</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => vacuumMutation.mutate()}
              disabled={vacuumMutation.isPending}
            >
              {vacuumMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Zap className="h-4 w-4 mr-2" />
              )}
              VACUUM ANALYZE
            </Button>
          </div>

          {/* Slow Queries */}
          {data?.slow_queries_enabled && data.slow_queries && data.slow_queries.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-[var(--text-secondary)] flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                Медленные запросы ({'>'} 100ms)
              </h4>
              <div className="rounded-lg border border-[var(--border-primary)] overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--bg-tertiary)]">
                    <tr>
                      <th className="text-left p-3 text-[var(--text-secondary)]">Запрос</th>
                      <th className="text-right p-3 w-24 text-[var(--text-secondary)]">Среднее</th>
                      <th className="text-right p-3 w-20 text-[var(--text-secondary)]">Вызовы</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.slow_queries.map((query, idx) => (
                      <tr key={idx} className="border-t border-[var(--border-primary)]">
                        <td className="p-3 font-mono text-xs text-[var(--text-primary)] truncate max-w-[300px]">
                          {query.query.substring(0, 100)}...
                        </td>
                        <td className="p-3 text-right">
                          <span className="px-2 py-1 text-xs rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                            {Math.round(query.mean_time_ms)}ms
                          </span>
                        </td>
                        <td className="p-3 text-right text-[var(--text-primary)]">{query.calls}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!data?.slow_queries_enabled && (
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-sm">
              <p className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
                <AlertTriangle className="h-4 w-4" />
                pg_stat_statements не включен. Для мониторинга медленных запросов выполните:
              </p>
              <code className="block mt-2 p-2 bg-[var(--bg-tertiary)] rounded text-xs font-mono text-[var(--text-primary)]">
                CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
              </code>
            </div>
          )}

          {/* Table Stats */}
          {data?.table_stats && data.table_stats.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-[var(--text-secondary)] flex items-center gap-2">
                <Database className="h-4 w-4" />
                Статистика таблиц (Top 10)
              </h4>
              <div className="rounded-lg border border-[var(--border-primary)] overflow-hidden max-h-48 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--bg-tertiary)] sticky top-0">
                    <tr>
                      <th className="text-left p-3 text-[var(--text-secondary)]">Таблица</th>
                      <th className="text-right p-3 w-24 text-[var(--text-secondary)]">Строк</th>
                      <th className="text-right p-3 w-24 text-[var(--text-secondary)]">Dead rows</th>
                      <th className="text-right p-3 w-28 text-[var(--text-secondary)]">VACUUM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.table_stats.map((table) => (
                      <tr key={table.table_name} className="border-t border-[var(--border-primary)]">
                        <td className="p-3 font-mono text-xs text-[var(--text-primary)]">{table.table_name}</td>
                        <td className="p-3 text-right text-[var(--text-primary)]">{table.row_count.toLocaleString()}</td>
                        <td className="p-3 text-right">
                          {table.dead_rows > 1000 ? (
                            <span className="px-2 py-1 text-xs rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                              {table.dead_rows}
                            </span>
                          ) : (
                            <span className="text-[var(--text-primary)]">{table.dead_rows}</span>
                          )}
                        </td>
                        <td className="p-3 text-right text-xs text-[var(--text-tertiary)]">
                          {formatDate(table.last_vacuum || table.last_autovacuum)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DBMonitoring;
