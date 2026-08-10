import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import type { FormConfig, FormConfigResponse } from '../types/form-config.types';

const FORM_CONFIGS_KEY = 'form-configs';

// Form type values matching backend
type FormTypeValue = 'add_row' | 'edit_row' | 'custom' | 'edit' | 'add';

/**
 * In-flight request deduplication map.
 * Prevents duplicate API calls when multiple components mount simultaneously
 * with the same tableId + formType (e.g. EditRowModal + RelatedRowModal).
 */
const inflightRequests = new Map<string, Promise<{ success: boolean; data: FormConfigResponse | null }>>();

/**
 * Hook to fetch form config for a table.
 * Uses staleTime to avoid redundant re-fetches and in-flight deduplication
 * to prevent N+1 request patterns when multiple modals mount at once.
 */
export function useFormConfig(tableId: string | number, formType: FormTypeValue = 'edit_row') {
  // Map legacy values to new format
  const normalizedFormType = formType === 'edit' ? 'edit_row' : formType === 'add' ? 'add_row' : formType;
  
  return useQuery({
    queryKey: [FORM_CONFIGS_KEY, tableId, normalizedFormType],
    queryFn: async () => {
      const dedupeKey = `${tableId}:${normalizedFormType}`;
      const existing = inflightRequests.get(dedupeKey);
      if (existing) {
        return existing;
      }

      const promise = apiClient.get<{ success: boolean; data: FormConfigResponse | null }>(
        `/form-configs/${tableId}?formType=${normalizedFormType}`
      );

      inflightRequests.set(dedupeKey, promise);
      try {
        return await promise;
      } finally {
        inflightRequests.delete(dedupeKey);
      }
    },
    enabled: Boolean(tableId),
    // Prevent re-fetches within 30s — form configs rarely change mid-session
    staleTime: 30_000,
  });
}

/**
 * Hook to save form config
 */
export function useSaveFormConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      tableId, 
      formType, 
      formTypes,
      config, 
      name 
    }: { 
      tableId: string | number; 
      formType: FormTypeValue; 
      formTypes?: FormTypeValue[];
      config: FormConfig;
      name?: string;
    }) => {
      // Map legacy values to new format
      const normalizedFormType = formType === 'edit' ? 'edit_row' : formType === 'add' ? 'add_row' : formType;
      const finalFormTypes = formTypes || [normalizedFormType];
      
      const response = await apiClient.post<{ success: boolean; data: FormConfigResponse }>(
        `/form-configs/${tableId}`,
        { formType: normalizedFormType, formTypes: finalFormTypes, config, name, isDefault: true }
      );
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: [FORM_CONFIGS_KEY, variables.tableId] 
      });
    },
  });
}

/**
 * Hook to delete form config
 */
export function useDeleteFormConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      tableId, 
      formType 
    }: { 
      tableId: string | number; 
      formType: 'edit' | 'add';
    }) => {
      const response = await apiClient.delete(
        `/form-configs/${tableId}?formType=${formType}`
      );
      return response;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: [FORM_CONFIGS_KEY, variables.tableId] 
      });
    },
  });
}
