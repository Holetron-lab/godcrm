/**
 * Hook for loading atoms from _atoms table
 * 
 * @see TASK-009-DOCUMENTS-ATOMS-TRANSLATIONS.md
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';

// === TYPES ===

export interface DocumentAtom {
  id: number;
  base_id?: string;
  key: string;
  title: string;
  content: string;
  content_en?: string;
  content_ru?: string;
  type?: 'endpoint' | 'concept' | 'howto' | 'code' | 'reference' | 'component' | 'hook' | 'store';
  http_method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  http_path?: string;
  code?: string;
  tags?: string[];
  document_ids?: number[];
  created_at?: string;
  updated_at?: string;
}

// === QUERY KEYS ===

const ATOMS_KEYS = {
  all: ['atoms'] as const,
  list: (tableId: number) => [...ATOMS_KEYS.all, 'list', tableId] as const,
  single: (tableId: number, atomId: number) => [...ATOMS_KEYS.all, 'single', tableId, atomId] as const,
};

// === MAIN HOOK ===

interface UseAtomsOptions {
  atomsTableId: number | null;
  enabled?: boolean;
}

export function useAtoms(options: UseAtomsOptions) {
  const { atomsTableId, enabled = true } = options;
  const queryClient = useQueryClient();

  // === LIST ATOMS ===
  
  const atomsQuery = useQuery({
    queryKey: ATOMS_KEYS.list(atomsTableId ?? 0),
    queryFn: async () => {
      if (!atomsTableId) return [];
      
      const response = await apiClient.request<{
        success: boolean;
        data: { rows: Array<{ id: number; base_id?: string; data: string; created_at: string; updated_at: string }> };
      }>(`/tables/${atomsTableId}/rows`);
      
      if (!response.success || !response.data?.rows) {
        return [];
      }
      
      // Parse data JSON and map to DocumentAtom
      return response.data.rows.map(row => {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
        } catch {
          parsed = {};
        }
        
        return {
          id: row.id,
          base_id: row.base_id,
          key: (parsed.key as string) || '',
          title: (parsed.title as string) || '',
          content: (parsed.content as string) || '',
          content_en: parsed.content_en as string | undefined,
          content_ru: parsed.content_ru as string | undefined,
          type: parsed.type as DocumentAtom['type'],
          http_method: parsed.http_method as DocumentAtom['http_method'],
          http_path: parsed.http_path as string | undefined,
          code: parsed.code as string | undefined,
          tags: parsed.tags as string[] | undefined,
          document_ids: parsed.document_ids as number[] | undefined,
          created_at: row.created_at,
          updated_at: row.updated_at,
        } as DocumentAtom;
      });
    },
    enabled: enabled && !!atomsTableId,
    staleTime: 60000,
  });

  // === CREATE ATOM ===
  
  const createAtomMutation = useMutation({
    mutationFn: async (params: Omit<DocumentAtom, 'id' | 'created_at' | 'updated_at'>) => {
      if (!atomsTableId) throw new Error('Atoms table not initialized');
      
      const response = await apiClient.request<{
        success: boolean;
        data: { id: number; base_id?: string };
      }>(`/tables/${atomsTableId}/rows`, {
        method: 'POST',
        body: JSON.stringify({ data: params }),
      });
      
      if (!response.success) {
        throw new Error('Failed to create atom');
      }
      
      return response.data;
    },
    onSuccess: () => {
      if (atomsTableId) {
        queryClient.invalidateQueries({ queryKey: ATOMS_KEYS.list(atomsTableId) });
      }
    },
  });

  // === UPDATE ATOM ===
  
  const updateAtomMutation = useMutation({
    mutationFn: async (params: { atomId: number; data: Partial<DocumentAtom> }) => {
      if (!atomsTableId) throw new Error('Atoms table not initialized');
      
      const response = await apiClient.request<{ success: boolean }>(
        `/tables/${atomsTableId}/rows/${params.atomId}`,
        {
          method: 'PUT',
          body: JSON.stringify({ data: params.data }),
        }
      );
      
      if (!response.success) {
        throw new Error('Failed to update atom');
      }
      
      return response;
    },
    onSuccess: () => {
      if (atomsTableId) {
        queryClient.invalidateQueries({ queryKey: ATOMS_KEYS.list(atomsTableId) });
      }
    },
  });

  // === DELETE ATOM ===
  
  const deleteAtomMutation = useMutation({
    mutationFn: async (atomId: number) => {
      if (!atomsTableId) throw new Error('Atoms table not initialized');
      
      const response = await apiClient.request<{ success: boolean }>(
        `/tables/${atomsTableId}/rows/${atomId}`,
        { method: 'DELETE' }
      );
      
      if (!response.success) {
        throw new Error('Failed to delete atom');
      }
      
      return response;
    },
    onSuccess: () => {
      if (atomsTableId) {
        queryClient.invalidateQueries({ queryKey: ATOMS_KEYS.list(atomsTableId) });
      }
    },
  });

  // === GET ATOM BY ID ===
  
  const getAtomById = (atomId: number | string | null): DocumentAtom | undefined => {
    if (!atomId) return undefined;
    const id = typeof atomId === 'string' ? parseInt(atomId, 10) : atomId;
    return atomsQuery.data?.find(a => a.id === id);
  };

  // === SEARCH ATOMS ===
  
  const searchAtoms = (query: string): DocumentAtom[] => {
    if (!query.trim()) return atomsQuery.data || [];
    
    const q = query.toLowerCase();
    return (atomsQuery.data || []).filter(atom =>
      atom.key?.toLowerCase().includes(q) ||
      atom.title?.toLowerCase().includes(q) ||
      atom.content?.toLowerCase().includes(q) ||
      atom.tags?.some(tag => tag.toLowerCase().includes(q))
    );
  };

  return {
    // State
    atoms: atomsQuery.data || [],
    isLoading: atomsQuery.isLoading,
    error: atomsQuery.error,
    
    // Mutations
    createAtom: createAtomMutation.mutateAsync,
    updateAtom: updateAtomMutation.mutateAsync,
    deleteAtom: deleteAtomMutation.mutateAsync,
    
    // Mutation states
    isCreating: createAtomMutation.isPending,
    isUpdating: updateAtomMutation.isPending,
    isDeleting: deleteAtomMutation.isPending,
    
    // Helpers
    getAtomById,
    searchAtoms,
    
    // Refresh
    refresh: () => {
      if (atomsTableId) {
        queryClient.invalidateQueries({ queryKey: ATOMS_KEYS.list(atomsTableId) });
      }
    },
  };
}
