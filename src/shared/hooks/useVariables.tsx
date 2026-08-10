/**
 * useVariables Hook - ADR-026
 * Atomic module for accessing space/table variables from anywhere
 * 
 * @example
 * // In a component
 * const { variables, getVariable, isLoading } = useVariables(spaceId);
 * const taxRate = getVariable('$tax_rate');
 * 
 * // In a formula context
 * const { variablesMap } = useVariables(spaceId);
 * evaluateFormula('$total * $tax_rate', { variables: variablesMap });
 */

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import { useAuthStore } from '@/features/auth/store/authStore';
import { 
  mergeAllVariables,
  type SystemVariableContext 
} from '../config/systemVariables';

// ============================================================
// Types
// ============================================================

export interface Variable {
  id: number;
  name: string;          // $variable_name
  value: string | number | null;
  scope: 'space' | 'table' | 'dashboard';
  scopeRef: number | null;
  formula: string;
  description?: string;
  streamId: number;
  cachedAt?: string;
}

export interface VariablesResponse {
  tableId: number | null;
  variables: Variable[];
}

export interface RecalculateResult {
  calculated: number;
  cached: number;
  errors: Array<{ variable: string; error: string }>;
}

// ============================================================
// Query Keys
// ============================================================

export const variablesKeys = {
  all: ['variables'] as const,
  space: (spaceId: number) => [...variablesKeys.all, 'space', spaceId] as const,
  table: (spaceId: number, tableId: number) => [...variablesKeys.space(spaceId), 'table', tableId] as const,
};

// ============================================================
// API Functions
// ============================================================

async function fetchVariables(spaceId: number): Promise<VariablesResponse> {
  // apiClient already adds /api/v3 prefix, so we just use /spaces/...
  const response = await apiClient.get<VariablesResponse>(`/spaces/${spaceId}/variables`);
  return response;
}

async function recalculateVariables(spaceId: number): Promise<RecalculateResult> {
  const response = await apiClient.post<RecalculateResult>(`/spaces/${spaceId}/variables/recalculate`);
  return response;
}

// ============================================================
// Hooks
// ============================================================

export interface UseVariablesOptions {
  /** Filter variables by table scope */
  tableId?: number;
  /** Include space-level variables (default: true) */
  includeSpaceVars?: boolean;
  /** Auto-refresh interval in ms (default: disabled) */
  refetchInterval?: number;
  /** Include system variables like {current_widget_id} (default: true) */
  includeSystemVars?: boolean;
  /** Widget ID for system variables */
  widgetId?: number;
  /** Project ID for system variables */
  projectId?: number;
}

export interface UseVariablesReturn {
  /** All variables for this space */
  variables: Variable[];
  
  /** Variables as a map for formula evaluation */
  variablesMap: Record<string, string | number | null>;
  
  /** All variables including system vars (for templates/markdown) */
  allVariablesMap: Record<string, string | number>;
  
  /** ID of the variables table in System Data */
  tableId: number | null;
  
  /** Loading state */
  isLoading: boolean;
  
  /** Error if fetch failed */
  error: Error | null;
  
  /** Get a specific variable by name (returns value or null) */
  getVariable: (name: string) => string | number | null;
  
  /** Get a variable with full metadata */
  getVariableFull: (name: string) => Variable | null;
  
  /** Trigger recalculation of all variables */
  recalculate: () => Promise<RecalculateResult>;
  
  /** Is recalculation in progress */
  isRecalculating: boolean;
  
  /** Refetch variables from server */
  refetch: () => void;
}

/**
 * Hook for accessing space variables
 * 
 * @param spaceId - Space ID to fetch variables for
 * @param options - Optional configuration
 * @returns Variables data and utilities
 */
export function useVariables(
  spaceId: number | null | undefined,
  options: UseVariablesOptions = {}
): UseVariablesReturn {
  const queryClient = useQueryClient();
  const { tableId: filterTableId, includeSpaceVars = true, refetchInterval } = options;

  // Get current user for system variables - MUST be before any other code
  const user = useAuthStore((state) => state.user);

  // Fetch variables query
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: variablesKeys.space(spaceId ?? 0),
    queryFn: () => fetchVariables(spaceId!),
    enabled: !!spaceId,
    refetchInterval,
    staleTime: 30000, // 30 seconds
  });

  // Recalculate mutation
  const recalculateMutation = useMutation({
    mutationFn: () => recalculateVariables(spaceId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: variablesKeys.space(spaceId!) });
    },
  });

  // Build system variables context - useMemo MUST be called before any conditional code
  const systemCtx: SystemVariableContext = useMemo(() => ({
    widgetId: options.widgetId,
    userId: user?.id,
    userName: user?.name,
    userEmail: user?.email,
    projectId: options.projectId,
    spaceId: spaceId ?? undefined,
    tableId: filterTableId,
  }), [options.widgetId, options.projectId, user?.id, user?.name, user?.email, spaceId, filterTableId]);

  // Filter variables based on options
  const filteredVariables = useMemo(() => {
    return (data?.variables ?? []).filter((v) => {
      if (filterTableId !== undefined) {
        // If filtering by table, include:
        // 1. Table-scoped variables for this table
        // 2. Space-scoped variables (if includeSpaceVars)
        if (v.scope === 'table' && v.scopeRef === filterTableId) return true;
        if (v.scope === 'space' && includeSpaceVars) return true;
        return false;
      }
      return true;
    });
  }, [data?.variables, filterTableId, includeSpaceVars]);

  // Create map for formula evaluation
  const variablesMap = useMemo(() => {
    const map: Record<string, string | number | null> = {};
    for (const v of filteredVariables) {
      map[v.name] = v.value;
    }
    return map;
  }, [filteredVariables]);

  // Create combined map with system variables
  const allVariablesMap = useMemo(() => {
    if (options.includeSystemVars === false) {
      // Filter out null values for the return type
      const result: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(variablesMap)) {
        if (value !== null) {
          result[key] = value;
        }
      }
      return result;
    }
    return mergeAllVariables(systemCtx, variablesMap);
  }, [variablesMap, systemCtx, options.includeSystemVars]);

  // Get variable by name
  const getVariable = (name: string): string | number | null => {
    const normalizedName = name.startsWith('$') ? name : `$${name}`;
    return variablesMap[normalizedName] ?? null;
  };

  // Get full variable object
  const getVariableFull = (name: string): Variable | null => {
    const normalizedName = name.startsWith('$') ? name : `$${name}`;
    return filteredVariables.find((v) => v.name === normalizedName) ?? null;
  };

  // Recalculate wrapper
  const recalculate = async (): Promise<RecalculateResult> => {
    return recalculateMutation.mutateAsync();
  };

  return {
    variables: filteredVariables,
    variablesMap,
    allVariablesMap,
    tableId: data?.tableId ?? null,
    isLoading,
    error: error as Error | null,
    getVariable,
    getVariableFull,
    recalculate,
    isRecalculating: recalculateMutation.isPending,
    refetch,
  };
}

// ============================================================
// Context Provider (for deep component trees)
// ============================================================

import { createContext, useContext, ReactNode } from 'react';

interface VariablesContextValue extends UseVariablesReturn {
  spaceId: number;
}

const VariablesContext = createContext<VariablesContextValue | null>(null);

interface VariablesProviderProps {
  spaceId: number;
  children: ReactNode;
  options?: UseVariablesOptions;
}

/**
 * Provider for variables context
 * Use this at space/project level to avoid prop drilling
 */
export function VariablesProvider({ spaceId, children, options }: VariablesProviderProps) {
  const variablesData = useVariables(spaceId, options);
  
  return (
    <VariablesContext.Provider value={{ ...variablesData, spaceId }}>
      {children}
    </VariablesContext.Provider>
  );
}

/**
 * Hook to access variables from context
 * Must be used within VariablesProvider
 */
export function useVariablesContext(): VariablesContextValue {
  const context = useContext(VariablesContext);
  if (!context) {
    throw new Error('useVariablesContext must be used within a VariablesProvider');
  }
  return context;
}

// ============================================================
// Formula Integration
// ============================================================

/**
 * Evaluate a formula with space variables
 * 
 * @param formula - Formula string (e.g., "$total * $tax_rate")
 * @param variablesMap - Map of variable names to values
 * @returns Evaluated result
 */
export function evaluateFormulaWithVariables(
  formula: string,
  variablesMap: Record<string, string | number | null>
): number | string {
  if (!formula || formula.trim() === '') return 0;
  
  let expression = formula.trim();
  
  // Simple numeric constant
  const numericValue = parseFloat(expression);
  if (!isNaN(numericValue) && expression === String(numericValue)) {
    return numericValue;
  }
  
  // Replace $variable references
  expression = expression.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, varName) => {
    const fullName = '$' + varName;
    const value = variablesMap[fullName];
    if (value === null || value === undefined) {
      logger.warn(`Variable ${fullName} not found, using 0`);
      return '0';
    }
    return typeof value === 'string' ? `"${value}"` : String(value);
  });
  
  // Basic arithmetic evaluation (safe subset)
  try {
    // Only allow numbers, basic operators, and parentheses
    if (/^[\d\s+\-*/().]+$/.test(expression)) {
      // eslint-disable-next-line no-new-func
      return new Function(`return ${expression}`)();
    }
  } catch (e) {
    logger.error('Formula evaluation error:', e);
  }
  
  return 0;
}
