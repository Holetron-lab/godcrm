import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tablesApi } from '../api/tablesApi';
import { useTablesStore } from '../store/tablesStore';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useProjectStore } from '@/features/projects/store/projectStore';
import type { PersonalSpaceSummary } from '../types/table.types';

interface UseTablesBootstrapOptions {
  rawMode?: boolean;
}

export const useTablesBootstrap = (options: UseTablesBootstrapOptions = {}) => {
  const { rawMode = false } = options;
  const authUser = useAuthStore((state) => state.user);
  const isAuthenticated = Boolean(authUser);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const contextUserId = useTablesStore((state) => state.contextUserId);
  const activeTableId = useTablesStore((state) => state.activeTableId);
  const setTables = useTablesStore((state) => state.setTables);
  const setColumns = useTablesStore((state) => state.setColumns);
  const setTableRole = useTablesStore((state) => state.setTableRole);
  const setRows = useTablesStore((state) => state.setRows);
  const appendRows = useTablesStore((state) => state.appendRows);
  const setPagination = useTablesStore((state) => state.setPagination);
  const setLoadingMore = useTablesStore((state) => state.setLoadingMore);
  const setError = useTablesStore((state) => state.setError);
  const setPersonalSummary = useTablesStore((state) => state.setPersonalSummary);

  const tablesQuery = useQuery({
    queryKey: ['tables', authUser?.id ?? 'anonymous', contextUserId],
    queryFn: async () => {
      // Don't filter by projectId - load all tables user has access to
      const result = await tablesApi.listTables({
        userId: contextUserId ?? undefined,
        projectId: undefined
      });
      return result;
    },
    retry: 1,
    enabled: isAuthenticated,
    staleTime: 60000, // 1 minute cache
    gcTime: 300000 // Keep in cache for 5 minutes
  });

  const columnsQuery = useQuery({
    queryKey: ['columns', activeTableId ?? 'none', rawMode ? 'raw' : 'normal'],
    enabled: Boolean(activeTableId && isAuthenticated),
    queryFn: () => tablesApi.getColumns(activeTableId as string, rawMode),
    retry: 1,
    staleTime: 30000, // 30 seconds cache for columns
    gcTime: 120000 // Keep columns in cache for 2 minutes
  });

  const rowsLimit = useTablesStore((state) => state.rowsLimit ?? 50);
  const currentPage = useTablesStore((state) => state.currentPage ?? 1);
  const sortColumn = useTablesStore((state) => state.sortColumn);
  const sortDirection = useTablesStore((state) => state.sortDirection);

  const rowsQuery = useQuery({
    queryKey: ['rows', activeTableId ?? 'none', currentPage, rowsLimit, rawMode ? 'raw' : 'normal', sortColumn, sortDirection],
    enabled: Boolean(activeTableId && isAuthenticated),
    queryFn: () => tablesApi.getRows(activeTableId as string, currentPage, rowsLimit, rawMode, sortColumn, sortDirection),
    retry: 1,
    staleTime: 10000, // 10 seconds cache for rows
    gcTime: 60000 // Keep rows in cache for 1 minute
  });

  // Track mounted state to avoid React warning
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Track loading more state
  useEffect(() => {
    if (!mountedRef.current) return;
    
    if (currentPage > 1 && rowsQuery.isFetching) {
      setLoadingMore(true);
    } else if (!rowsQuery.isFetching) {
      setLoadingMore(false);
    }
  }, [currentPage, rowsQuery.isFetching, setLoadingMore]);

  const lastTablesSignatureRef = useRef<string | null>(null);
  const lastColumnsSignatureRef = useRef<string | null>(null);
  const lastRowsSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    if (!tablesQuery.data) {
      if (!tablesQuery.isFetching) {
        setTables([]);
        setPersonalSummary(null);
      }
      return;
    }

    const incomingTables = tablesQuery.data.tables ?? [];
    const signature = incomingTables.map((table) => `${table.id}:${table.updatedAt ?? ''}`).join('|');

    if (lastTablesSignatureRef.current === signature) {
      return;
    }

    lastTablesSignatureRef.current = signature;
    setTables(incomingTables);
    const meta = tablesQuery.data.meta as { personalSpace?: PersonalSpaceSummary | null } | null | undefined;
    setPersonalSummary(meta?.personalSpace ?? null);
  }, [isAuthenticated, tablesQuery.data, tablesQuery.isFetching, setPersonalSummary, setTables]);

  useEffect(() => {
    if (!activeTableId || !columnsQuery.data) {
      return;
    }

    // Include config and type in signature to detect all changes
    const signature = `${activeTableId}:${columnsQuery.data.columns.map((column) => 
      column.id + ':' + column.type + ':' + (column.updatedAt ?? '') + ':' + JSON.stringify(column.config ?? {})
    ).join('|')}`;

    if (lastColumnsSignatureRef.current === signature) {
      return;
    }

    lastColumnsSignatureRef.current = signature;
    setColumns(activeTableId, columnsQuery.data.columns);
    setTableRole(activeTableId, columnsQuery.data.userRole);
  }, [activeTableId, columnsQuery.data, setColumns, setTableRole]);

  useEffect(() => {
    if (!activeTableId || !rowsQuery.data) {
      return;
    }


    // Parse data field if it's a string
    const parsedRows = rowsQuery.data.rows.map(row => ({
      ...row,
      data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data
    }));

    const signature = `${activeTableId}:${currentPage}:${parsedRows
      .map((row) => row.id + (row.updatedAt ?? ''))
      .join('|')}`;

    if (lastRowsSignatureRef.current === signature) {
      return;
    }

    lastRowsSignatureRef.current = signature;
    
    // If page 1, replace rows. Otherwise append
    if (currentPage === 1) {
      setRows(activeTableId, parsedRows);
    } else {
      appendRows(activeTableId, parsedRows);
    }
    
    // Save pagination info
    if (rowsQuery.data.pagination) {
      setPagination(activeTableId, rowsQuery.data.pagination.pages, rowsQuery.data.pagination.total);
    }
  }, [activeTableId, rowsQuery.data, currentPage, setRows, appendRows, setPagination]);

  useEffect(() => {
    const combinedError = tablesQuery.error || columnsQuery.error || rowsQuery.error;
    setError(combinedError ? String(combinedError) : null);
  }, [columnsQuery.error, rowsQuery.error, setError, tablesQuery.error]);

  const loading = useMemo(
    () => Boolean(isAuthenticated) && (tablesQuery.isLoading || columnsQuery.isLoading || rowsQuery.isLoading),
    [columnsQuery.isLoading, isAuthenticated, rowsQuery.isLoading, tablesQuery.isLoading]
  );

  const error = tablesQuery.error || columnsQuery.error || rowsQuery.error || null;

  return { loading, error };
};
