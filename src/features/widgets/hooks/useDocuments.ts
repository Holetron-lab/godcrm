/**
 * Hook for Documents v4 - Table-based document management
 * 
 * @see TASK-008-DOCUMENTS-V4-TABLES.md
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import {
  initDocumentsFolder,
  listDocuments,
  createDocument,
  getDocumentContent,
  importDocumentV4,
  addDocumentLanguage,
} from '../api/documents-v4.api';
import type {
  DocumentRegistryItem,
  DocumentItem,
  DocumentItemTreeNode,
  DocumentImportSection,
  DocumentsWidgetConfig,
  DocumentLevel,
} from '../types/documents.types';

// === QUERY KEYS ===

const DOCUMENTS_V4_KEYS = {
  all: ['documents-v4'] as const,
  folder: (projectId: number) => [...DOCUMENTS_V4_KEYS.all, 'folder', projectId] as const,
  list: (projectId: number) => [...DOCUMENTS_V4_KEYS.all, 'list', projectId] as const,
  content: (documentId: number) => [...DOCUMENTS_V4_KEYS.all, 'content', documentId] as const,
};

// === MAIN HOOK ===

interface UseDocumentsV4Options {
  projectId: number;
  config?: DocumentsWidgetConfig;
  folderPath?: string;
  autoInit?: boolean;
}

export function useDocuments(options: UseDocumentsV4Options) {
  const { 
    projectId, 
    config,
    folderPath = config?.folder_path || 'databases/documents/',
    autoInit = true,
  } = options;
  
  const queryClient = useQueryClient();

  // === FOLDER INITIALIZATION ===
  
  const initMutation = useMutation({
    mutationFn: () => initDocumentsFolder(projectId, folderPath),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: DOCUMENTS_V4_KEYS.folder(projectId) });
      queryClient.invalidateQueries({ queryKey: DOCUMENTS_V4_KEYS.list(projectId) });
    },
  });

  // === DOCUMENTS LIST ===

  // Canonical registry from widget config (ADR-0067 precedence: canonical first,
  // legacy key as fallback). When present, bypass the legacy project+folder_path
  // resolver and read the registry directly — required for widgets bound to a
  // custom registry that doesn't match the project's default `_registry` row
  // (e.g. widget 4140 → registry 100008, while project 152 also has _registry 2711).
  const configuredRegistryTableId: number | undefined = (() => {
    const raw = (config as { registry_table_id?: number | string; documents_table_id?: number | string } | undefined)?.registry_table_id
      ?? (config as { documents_table_id?: number | string } | undefined)?.documents_table_id;
    const n = raw != null ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : undefined;
  })();

  const documentsQuery = useQuery({
    queryKey: configuredRegistryTableId
      ? ['documents-v4', 'registry', configuredRegistryTableId]
      : DOCUMENTS_V4_KEYS.list(projectId),
    queryFn: async () => {
      // Canonical path: widget config carries registry_table_id → fetch rows
      // straight from that registry table. Skips project+folder_path lookup
      // entirely so widget-scoped custom registries resolve correctly.
      if (configuredRegistryTableId) {
        const response = await apiClient.request<{ data: { rows?: Array<{ id: number; base_id: string; table_id: number; data: Record<string, unknown> }> } | Array<{ id: number; base_id: string; table_id: number; data: Record<string, unknown> }> }>(
          `/tables/${configuredRegistryTableId}/rows?limit=5000`
        );
        const payload = (response as { data?: unknown }).data;
        const rows = Array.isArray(payload)
          ? payload
          : (payload as { rows?: Array<{ id: number; base_id: string; table_id: number; data: Record<string, unknown> }> })?.rows ?? [];
        const documents: DocumentRegistryItem[] = rows.map(r => {
          const d = (r.data ?? {}) as Record<string, unknown>;
          return {
            id: r.id,
            base_id: r.base_id,
            ...(d as object),
            content_table_id: d.table_id as number | undefined,
          } as DocumentRegistryItem;
        });
        const atomsRaw = (config as { atoms_table_id?: number | string; sections_table_id?: number | string } | undefined)?.atoms_table_id
          ?? (config as { sections_table_id?: number | string } | undefined)?.sections_table_id;
        const atomsN = atomsRaw != null ? Number(atomsRaw) : NaN;
        return {
          documents,
          registryTableId: configuredRegistryTableId,
          atomsTableId: Number.isFinite(atomsN) && atomsN > 0 ? atomsN : undefined,
          initialized: true,
        };
      }

      const response = await listDocuments(projectId, folderPath);

      // Auto-init if not initialized and autoInit is true
      if (response.data.not_initialized && autoInit) {
        const initResponse = await initDocumentsFolder(projectId, folderPath);
        return {
          documents: [] as DocumentRegistryItem[],
          registryTableId: initResponse.data.registry_table_id,
          atomsTableId: initResponse.data.atoms_table_id,
          initialized: true,
        };
      }

      // Map documents to include content_table_id (alias for table_id)
      const documents: DocumentRegistryItem[] = response.data.documents.map(doc => ({
        ...doc,
        content_table_id: doc.table_id,  // Frontend components use this name
      }));

      return {
        documents,
        registryTableId: response.data.registry_table_id,
        atomsTableId: config?.atoms_table_id,
        initialized: !response.data.not_initialized,
      };
    },
    enabled: !!projectId || !!configuredRegistryTableId,
    staleTime: 60000,
  });

  const documents = documentsQuery.data?.documents ?? [];
  const registryTableId = documentsQuery.data?.registryTableId;
  const isInitialized = documentsQuery.data?.initialized ?? false;

  // Invalidate the active documents-list query. When the widget is bound to a
  // configured registry, the list lives under the `registry` key — NOT the
  // legacy `list(projectId)` key — so we must invalidate both. Without this,
  // status changes / creates only surfaced after a full page reload.
  const invalidateDocsList = () => {
    queryClient.invalidateQueries({ queryKey: DOCUMENTS_V4_KEYS.list(projectId) });
    if (configuredRegistryTableId) {
      queryClient.invalidateQueries({ queryKey: ['documents-v4', 'registry', configuredRegistryTableId] });
    }
  };

  // === CREATE DOCUMENT ===
  
  const createDocumentMutation = useMutation({
    mutationFn: (params: {
      name: string;
      slug?: string;
      description?: string;
      icon?: string;
      category?: string;
      project_id?: number;  // Link to ADR Projects table (1699)
    }) => createDocument(projectId, {
      ...params,
      folder_path: folderPath,
      // Mirror the read/delete paths: when the widget is bound to a custom
      // registry (ADR-0067), pass it so the backend writes into that registry
      // instead of the project's default `_registry`. Absent → legacy behavior.
      ...(configuredRegistryTableId ? { registry_table_id: configuredRegistryTableId } : {}),
    }),
    onSuccess: () => {
      invalidateDocsList();
    },
  });

  // === DELETE DOCUMENT ===
  
  const deleteDocumentMutation = useMutation({
    mutationFn: async (params: { documentId: number; deleteTable?: boolean }) => {
      if (!registryTableId) throw new Error('Registry not initialized');
      return apiClient.request<{ success: boolean; data: { document_id: number; table_deleted: boolean } }>(
        `/documents/${params.documentId}`,
        {
          method: 'DELETE',
          body: JSON.stringify({
            registryTableId,
            deleteTable: params.deleteTable ?? true,
          }),
        }
      );
    },
    onSuccess: () => {
      invalidateDocsList();
    },
  });

  // === DOCUMENT CONTENT ===
  
  const useDocumentContent = (documentId: number | null) => {
    return useQuery({
      queryKey: DOCUMENTS_V4_KEYS.content(documentId ?? 0),
      queryFn: async () => {
        if (!documentId || !registryTableId) return null;
        const response = await getDocumentContent(documentId, registryTableId);
        return response.data;
      },
      enabled: !!documentId && !!registryTableId,
      staleTime: 30000,
    });
  };

  // === IMPORT SECTIONS ===
  
  const importSectionsMutation = useMutation({
    mutationFn: (params: { documentId: number; sections: DocumentImportSection[] }) => {
      if (!registryTableId) throw new Error('Registry not initialized');
      return importDocumentV4(params.documentId, registryTableId, params.sections);
    },
    onSuccess: (data, variables) => {
      // Invalidate document content
      queryClient.invalidateQueries({ 
        queryKey: DOCUMENTS_V4_KEYS.content(variables.documentId) 
      });
      // Also refresh documents list to update counts/status
      invalidateDocsList();
    },
  });

  // === ADD/UPDATE ITEM ===
  
  const addItemMutation = useMutation({
    mutationFn: async (params: { documentId: number; item: Partial<DocumentItem> }) => {
      // Get document to find table_id
      if (!registryTableId) throw new Error('Registry not initialized');
      const content = await getDocumentContent(params.documentId, registryTableId);
      const tableId = content.data.table_id;
      
      const response = await apiClient.request<{ success: boolean; data: { id: number } }>(
        `/tables/${tableId}/rows`,
        {
          method: 'POST',
          body: JSON.stringify({ data: params.item }),
        }
      );
      return { id: response.data.id, tableId };
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: DOCUMENTS_V4_KEYS.content(variables.documentId) 
      });
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: async (params: { 
      documentId: number; 
      itemId: number; 
      tableId: number;
      data: Partial<DocumentItem>;
    }) => {
      return apiClient.request<{ success: boolean }>(
        `/tables/${params.tableId}/rows/${params.itemId}`,
        {
          method: 'PUT',
          body: JSON.stringify({ data: params.data }),
        }
      );
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: DOCUMENTS_V4_KEYS.content(variables.documentId) 
      });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (params: { 
      documentId: number; 
      itemId: number; 
      tableId: number;
    }) => {
      return apiClient.request<{ success: boolean }>(
        `/tables/${params.tableId}/rows/${params.itemId}`,
        { method: 'DELETE' }
      );
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: DOCUMENTS_V4_KEYS.content(variables.documentId) 
      });
    },
  });

  // === ADD LANGUAGE ===
  
  const addLanguageMutation = useMutation({
    mutationFn: (params: { languageCode: string; languageName?: string }) => 
      addDocumentLanguage(projectId, params.languageCode, params.languageName, folderPath),
  });

  // === HELPERS ===
  
  /**
   * Get localized content from item
   */
  const getLocalizedField = (
    item: DocumentItem, 
    field: 'title' | 'content', 
    languageCode: string
  ): string => {
    if (languageCode === 'en' || !languageCode) {
      return item[field] || '';
    }
    
    const localizedKey = `${field}_${languageCode}` as keyof DocumentItem;
    const localizedValue = item[localizedKey];
    
    if (typeof localizedValue === 'string' && localizedValue.trim()) {
      return localizedValue;
    }
    
    return item[field] || '';
  };

  /**
   * Calculate next order value for new item.
   * Always returns an integer — backend `ORDER BY ::numeric` cast tolerates
   * fractions, but legacy `::integer` paths still exist and crash on them.
   * For non-end inserts call-sites use `resolveOrderForInsert` (orderUtils)
   * directly to handle the renumber-when-gap-exhausted case.
   */
  const getNextOrder = (items: DocumentItem[], afterItemId?: number): number => {
    if (!items.length) return 10;

    if (afterItemId) {
      const afterIndex = items.findIndex(i => i.id === afterItemId);
      if (afterIndex >= 0 && afterIndex < items.length - 1) {
        const afterOrder = Math.floor(items[afterIndex].order);
        const nextOrder = Math.floor(items[afterIndex + 1].order);
        const mid = Math.floor((afterOrder + nextOrder) / 2);
        if (mid > afterOrder && mid < nextOrder) return mid;
      }
    }

    const maxOrder = Math.max(...items.map(i => Math.floor(i.order)));
    return maxOrder + 10;
  };

  /**
   * Reorder items by updating order values
   */
  const reorderItems = async (
    documentId: number, 
    tableId: number, 
    orderedIds: number[]
  ) => {
    const updates = orderedIds.map((id, index) => ({
      id,
      order: (index + 1) * 10,
    }));
    
    // Batch update using existing API
    for (const update of updates) {
      await apiClient.request(
        `/tables/${tableId}/rows/${update.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({ data: { order: update.order } }),
        }
      );
    }
    
    queryClient.invalidateQueries({ 
      queryKey: DOCUMENTS_V4_KEYS.content(documentId) 
    });
  };

  return {
    // State
    documents,
    isInitialized,
    registryTableId,
    isLoading: documentsQuery.isLoading,
    error: documentsQuery.error,
    
    // Queries
    useDocumentContent,
    
    // Mutations
    initFolder: initMutation.mutateAsync,
    createDocument: createDocumentMutation.mutateAsync,
    deleteDocument: deleteDocumentMutation.mutateAsync,
    importSections: importSectionsMutation.mutateAsync,
    addItem: addItemMutation.mutateAsync,
    updateItem: updateItemMutation.mutateAsync,
    deleteItem: deleteItemMutation.mutateAsync,
    addLanguage: addLanguageMutation.mutateAsync,
    
    // Mutation states
    isCreating: createDocumentMutation.isPending,
    isImporting: importSectionsMutation.isPending,
    isDeleting: deleteDocumentMutation.isPending,
    
    // Helpers
    getLocalizedField,
    getNextOrder,
    reorderItems,
    
    // Invalidate
    refresh: invalidateDocsList,
  };
}

// === DOCUMENT CONTENT HOOK (Standalone) ===

export function useDocumentContent(
  documentId: number | null,
  registryTableId: number | null,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: DOCUMENTS_V4_KEYS.content(documentId ?? 0),
    queryFn: async () => {
      if (!documentId || !registryTableId) return null;
      const response = await getDocumentContent(documentId, registryTableId);
      return response.data;
    },
    enabled: (options?.enabled ?? true) && !!documentId && !!registryTableId,
    staleTime: 30000,
  });
}
