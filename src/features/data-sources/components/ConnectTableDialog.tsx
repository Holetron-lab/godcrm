import { useState } from 'react';
import { logger } from '@/shared/utils/logger';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dataSourcesApi } from '../api/dataSourcesApi';
import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui/Button';
import { Select } from '@/shared/components/ui/Select';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';

interface ConnectTableDialogProps {
  dataSourceId: string;
  tableId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function ConnectTableDialog({ dataSourceId, tableId, onClose, onSuccess }: ConnectTableDialogProps) {
  
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [selectedIdColumn, setSelectedIdColumn] = useState<string>('');

  // Load available tables from data source
  const { data: tables, isLoading, error } = useQuery({
    queryKey: ['dataSourceTables', dataSourceId],
    queryFn: () => dataSourcesApi.listTables(dataSourceId),
    enabled: !!dataSourceId
  });
  
  // Load columns for selected table
  const { data: columns, isLoading: columnsLoading, error: columnsError } = useQuery({
    queryKey: ['dataSourceTableColumns', dataSourceId, selectedTable],
    queryFn: async () => {
      const result = await dataSourcesApi.listTableColumns(dataSourceId, selectedTable);
      return result;
    },
    enabled: !!dataSourceId && !!selectedTable
  });
  

  // Connect table mutation
  const connectMutation = useMutation({
    mutationFn: async (data: { sourceTable: string; idColumn: string }) => {
      const result = await apiClient.request<{ success: boolean; data: Record<string, unknown> }>(
        `/tables/${tableId}/connect`,
        {
          method: 'POST',
          body: JSON.stringify({
            data_source_id: dataSourceId,
            source_table_name: data.sourceTable,
            source_id_column: data.idColumn
          })
        }
      );
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      onSuccess();
    },
    onError: (error) => {
      logger.error('Connection failed:', error);
      alert(`Failed to connect table: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  const handleConnect = async () => {
    if (!selectedTable) {
      alert('Please select a table');
      return;
    }

    await connectMutation.mutateAsync({
      sourceTable: selectedTable,
      idColumn: selectedIdColumn
    });
  };

  return (
    <Modal
      open={true}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Подключить таблицу"
      size="md"
    >
      <div className="space-y-4">
        {isLoading && (
          <p className="text-sm text-gray-500 dark:text-gray-400">Загрузка таблиц...</p>
        )}

        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-600 dark:text-red-400">
              Ошибка загрузки таблиц: {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </div>
        )}

        {tables && tables.length > 0 && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Выберите таблицу из базы данных
              </label>
              <Select
                value={selectedTable}
                onChange={(value) => setSelectedTable(value)}
                placeholder="Выберите таблицу..."
                options={tables.map(table => ({
                  value: table.name,
                  label: table.name
                }))}
              />
            </div>

            {selectedTable && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  ID колонка (для связывания)
                </label>
                {columnsLoading ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Загрузка колонок...</p>
                ) : columns && columns.length > 0 ? (
                  <>
                    <Select
                      value={selectedIdColumn}
                      onChange={(value) => setSelectedIdColumn(value)}
                      placeholder="Выберите ID колонку..."
                      options={columns.map(col => ({
                        value: col.name,
                        label: `${col.name} (${col.type})`
                      }))}
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Обычно это поле 'id' или 'primary_key'
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-red-500">Не удалось загрузить колонки</p>
                )}
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <Button
                variant="secondary"
                onClick={onClose}
                disabled={connectMutation.isPending}
              >
                Отмена
              </Button>
              <Button
                variant="primary"
                onClick={handleConnect}
                disabled={!selectedTable || !selectedIdColumn || connectMutation.isPending}
              >
                {connectMutation.isPending ? 'Подключение...' : 'Подключить'}
              </Button>
            </div>
          </>
        )}

        {tables && tables.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Таблицы не найдены в базе данных
          </p>
        )}
      </div>
    </Modal>
  );
}
