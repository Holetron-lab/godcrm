/**
 * DataMaintenanceTab - Data maintenance tab for table settings
 * Features: Normalize data format, detect mixed data formats
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/shared/components/ui';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import { Database, RefreshCw, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';

interface DataMaintenanceTabProps {
  tableId: number | string;
}

interface DataAnalysis {
  totalRows: number;
  columnNameFormat: number;
  columnIdFormat: number;
  mixedFormat: number;
  needsNormalization: boolean;
}

interface Column {
  id: number;
  column_name: string;
  display_name: string;
}

export const DataMaintenanceTab = ({ tableId }: DataMaintenanceTabProps) => {
  const queryClient = useQueryClient();
  const [normalizationResult, setNormalizationResult] = useState<{
    success: boolean;
    message: string;
    normalized: number;
  } | null>(null);

  // Fetch columns for the table
  const { data: columnsData } = useQuery({
    queryKey: ['table-columns', tableId],
    queryFn: async () => {
      const response = await apiClient.request<{ data: Column[] }>(`/tables/${tableId}/columns`);
      return response.data;
    }
  });

  // Analyze data format
  const { data: analysis, isLoading: isAnalyzing, refetch: refetchAnalysis } = useQuery({
    queryKey: ['table-data-analysis', tableId],
    queryFn: async () => {
      const columns = columnsData || [];
      const columnIdToName: Record<string, string> = {};
      columns.forEach((col: Column) => {
        columnIdToName[String(col.id)] = col.column_name;
      });

      const response = await apiClient.request<{ 
        data: { rows: Array<{ id: string; data: Record<string, unknown> }> } 
      }>(`/tables/${tableId}/rows?limit=5000`);
      
      const rows = response.data?.rows || [];
      
      let columnNameFormat = 0;
      let columnIdFormat = 0;
      let mixedFormat = 0;

      rows.forEach(row => {
        const data = row.data || {};
        const keys = Object.keys(data);
        const hasNumericKeys = keys.some(k => /^\d+$/.test(k));
        const hasNameKeys = keys.some(k => !/^\d+$/.test(k));
        
        if (hasNumericKeys && hasNameKeys) {
          mixedFormat++;
        } else if (hasNumericKeys) {
          columnIdFormat++;
        } else {
          columnNameFormat++;
        }
      });

      return {
        totalRows: rows.length,
        columnNameFormat,
        columnIdFormat,
        mixedFormat,
        needsNormalization: columnIdFormat > 0 || mixedFormat > 0
      } as DataAnalysis;
    },
    enabled: !!columnsData
  });

  // Normalize mutation
  const normalizeMutation = useMutation({
    mutationFn: async () => {
      const columns = columnsData || [];
      const columnIdToName: Record<string, string> = {};
      columns.forEach((col: Column) => {
        columnIdToName[String(col.id)] = col.column_name;
      });

      const response = await apiClient.request<{ 
        data: { rows: Array<{ id: string; data: Record<string, unknown> }> } 
      }>(`/tables/${tableId}/rows?limit=5000`);
      
      const rows = response.data?.rows || [];
      let normalized = 0;

      for (const row of rows) {
        const data = row.data || {};
        const keys = Object.keys(data);
        const hasNumericKeys = keys.some(k => /^\d+$/.test(k));
        
        if (hasNumericKeys) {
          // Convert column IDs to column names
          const newData: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(data)) {
            const columnName = columnIdToName[key] || key;
            newData[columnName] = value;
          }
          
          // Update row
          await apiClient.request(`/tables/${tableId}/rows/${row.id}`, {
            method: 'PUT',
            body: JSON.stringify({ data: newData })
          });
          normalized++;
        }
      }

      return { normalized };
    },
    onSuccess: (result) => {
      setNormalizationResult({
        success: true,
        message: `Успешно нормализовано ${result.normalized} строк`,
        normalized: result.normalized
      });
      refetchAnalysis();
      queryClient.invalidateQueries({ queryKey: ['table-rows', tableId] });
    },
    onError: (error) => {
      logger.error('Normalization failed:', error);
      setNormalizationResult({
        success: false,
        message: `Ошибка нормализации: ${error instanceof Error ? error.message : 'Unknown error'}`,
        normalized: 0
      });
    }
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Database className="w-5 h-5 text-[var(--color-primary-500)]" />
        <h3 className="text-lg font-medium text-[var(--text-primary)]">Обслуживание данных</h3>
      </div>

      {/* Analysis Section */}
      <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)] p-4">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-medium text-[var(--text-primary)]">Анализ формата данных</h4>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => refetchAnalysis()}
            disabled={isAnalyzing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isAnalyzing ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        </div>

        {isAnalyzing ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--color-primary-500)]" />
            <span className="ml-2 text-[var(--text-secondary)]">Анализ данных...</span>
          </div>
        ) : analysis ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Всего строк:</span>
                <span className="font-medium text-[var(--text-primary)]">{analysis.totalRows}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Формат column_name:</span>
                <span className="font-medium text-green-400">{analysis.columnNameFormat}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Формат column_id:</span>
                <span className={`font-medium ${analysis.columnIdFormat > 0 ? 'text-yellow-400' : 'text-[var(--text-primary)]'}`}>
                  {analysis.columnIdFormat}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Смешанный формат:</span>
                <span className={`font-medium ${analysis.mixedFormat > 0 ? 'text-orange-400' : 'text-[var(--text-primary)]'}`}>
                  {analysis.mixedFormat}
                </span>
              </div>
            </div>

            {/* Status */}
            <div className={`flex items-center gap-2 mt-4 p-3 rounded-lg ${
              analysis.needsNormalization 
                ? 'bg-yellow-500/10 border border-yellow-500/30' 
                : 'bg-green-500/10 border border-green-500/30'
            }`}>
              {analysis.needsNormalization ? (
                <>
                  <AlertTriangle className="w-5 h-5 text-yellow-400" />
                  <span className="text-sm text-yellow-400">
                    Обнаружены данные с column_id форматом. Рекомендуется нормализация.
                  </span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-5 h-5 text-green-400" />
                  <span className="text-sm text-green-400">
                    Все данные в нормализованном формате (column_name).
                  </span>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-4 text-[var(--text-tertiary)]">
            Нет данных для анализа
          </div>
        )}
      </div>

      {/* Normalization Section */}
      <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)] p-4">
        <h4 className="font-medium text-[var(--text-primary)] mb-3">Нормализация данных</h4>
        <p className="text-sm text-[var(--text-secondary)] mb-4">
          Преобразует данные из формата column_id (например, {`{"13254": 21}`}) 
          в формат column_name (например, {`{"system_user_id": 21}`}).
          Это улучшает читаемость и совместимость с Relations.
        </p>

        <div className="flex items-center gap-4">
          <Button
            variant="primary"
            onClick={() => normalizeMutation.mutate()}
            disabled={normalizeMutation.isPending || !analysis?.needsNormalization}
          >
            {normalizeMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Нормализация...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Нормализовать данные
              </>
            )}
          </Button>

          {!analysis?.needsNormalization && (
            <span className="text-sm text-[var(--text-tertiary)]">
              Нормализация не требуется
            </span>
          )}
        </div>

        {/* Result message */}
        {normalizationResult && (
          <div className={`mt-4 p-3 rounded-lg ${
            normalizationResult.success 
              ? 'bg-green-500/10 border border-green-500/30' 
              : 'bg-red-500/10 border border-red-500/30'
          }`}>
            <span className={`text-sm ${normalizationResult.success ? 'text-green-400' : 'text-red-400'}`}>
              {normalizationResult.message}
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="text-xs text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] rounded-lg p-3">
        <strong>Примечание:</strong> Данные могут храниться в двух форматах — по имени колонки 
        (column_name) или по ID колонки (column_id). Нормализация приводит все данные к единому 
        формату column_name, что обеспечивает корректную работу Relations и улучшает читаемость.
      </div>
    </div>
  );
};
