/**
 * useBugReport - Hook for bug reporting functionality
 * Used by StatusBar to open bug report modal
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/features/auth/store/authStore';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { showToast } from '@/shared/hooks/useToast';

const BUG_TABLE_NAME = 'Bugs';

export interface BugReportState {
  isBugModalOpen: boolean;
  openBugModal: () => void;
  closeBugModal: () => void;
  submitBug: (data: Record<string, unknown>) => Promise<void>;
  bugTable: { id: number; name: string; displayName?: string } | null;
  bugColumns: unknown[];
  isLoading: boolean;
}

export const useBugReport = (): BugReportState => {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [isBugModalOpen, setIsBugModalOpen] = useState(false);

  const { data: tablesData, isLoading: isLoadingTables } = useQuery({
    queryKey: ['bug-tables'],
    queryFn: () => tablesApi.listTables(),
    enabled: Boolean(user)
  });

  const bugTable = useMemo(() => {
    const tables = tablesData?.tables || [];
    return tables.find((table: { name: string; displayName?: string }) => 
      table.name === BUG_TABLE_NAME || table.displayName === BUG_TABLE_NAME
    ) || null;
  }, [tablesData]);

  const { data: bugColumnsData, isLoading: isLoadingBugColumns } = useQuery({
    queryKey: ['bug-table-columns', bugTable?.id],
    queryFn: () => tablesApi.getColumns(String(bugTable!.id)),
    enabled: Boolean(user && bugTable?.id)
  });

  const bugColumns = bugColumnsData?.columns || [];

  const openBugModal = useCallback(() => {
    if (isLoadingTables) {
      showToast('Загрузка таблицы багов...', 'info');
      return;
    }
    if (!bugTable) {
      showToast('Таблица "Bugs" не найдена. Создайте её для отслеживания ошибок.', 'error');
      return;
    }
    setIsBugModalOpen(true);
  }, [isLoadingTables, bugTable]);

  const closeBugModal = useCallback(() => {
    setIsBugModalOpen(false);
  }, []);

  const submitBug = useCallback(async (data: Record<string, unknown>) => {
    if (!bugTable) return;
    try {
      await tablesApi.createRow(String(bugTable.id), data);
      showToast('Баг добавлен!', 'success');
      queryClient.invalidateQueries({ queryKey: ['table-rows', bugTable.id] });
      setIsBugModalOpen(false);
    } catch (error) {
      showToast('Ошибка добавления бага', 'error');
      throw error;
    }
  }, [bugTable, queryClient]);

  return {
    isBugModalOpen,
    openBugModal,
    closeBugModal,
    submitBug,
    bugTable,
    bugColumns,
    isLoading: isLoadingTables || isLoadingBugColumns
  };
};
