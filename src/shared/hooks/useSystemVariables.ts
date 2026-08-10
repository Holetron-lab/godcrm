/**
 * Hook to build system variables from current context
 * Optionally includes space variables from useVariables hook
 */

import { useMemo } from 'react';
import { useAuthStore } from '@/features/auth/store/authStore';
import { mergeAllVariables, type SystemVariableContext } from '../config/systemVariables';
import { useVariables } from './useVariables';

interface UseSystemVariablesOptions {
  widgetId?: number;
  projectId?: number;
  spaceId?: number;
  spaceName?: string;
  tableId?: number;
  /** Include space variables from useVariables (requires spaceId) */
  includeSpaceVars?: boolean;
  /** Additional custom variables to merge */
  custom?: Record<string, string | number>;
}

/**
 * Build system variables from current auth context and provided options
 * Optionally includes space variables when includeSpaceVars is true
 * 
 * @example
 * // System variables only
 * const variables = useSystemVariables({ widgetId: 105 });
 * 
 * // System + space variables
 * const variables = useSystemVariables({ 
 *   widgetId: 105, 
 *   spaceId: 1, 
 *   includeSpaceVars: true 
 * });
 * 
 * <MarkdownPreview content={content} variables={variables} />
 */
export function useSystemVariables(options: UseSystemVariablesOptions = {}) {
  const user = useAuthStore((state) => state.user);
  
  // Optionally fetch space variables
  const { variablesMap: spaceVars } = useVariables(
    options.includeSpaceVars ? options.spaceId : null,
    { 
      tableId: options.tableId,
      includeSystemVars: false, // Avoid circular dependency
    }
  );
  
  return useMemo(() => {
    const ctx: SystemVariableContext = {
      widgetId: options.widgetId,
      userId: user?.id,
      userName: user?.name,
      userEmail: user?.email,
      projectId: options.projectId,
      spaceId: options.spaceId,
      spaceName: options.spaceName,
      tableId: options.tableId,
    };
    
    return mergeAllVariables(
      ctx, 
      options.includeSpaceVars ? spaceVars : undefined,
      options.custom
    );
  }, [
    options.widgetId,
    options.projectId,
    options.spaceId,
    options.spaceName,
    options.tableId,
    options.includeSpaceVars,
    options.custom,
    user?.id,
    user?.name,
    user?.email,
    spaceVars,
  ]);
}
