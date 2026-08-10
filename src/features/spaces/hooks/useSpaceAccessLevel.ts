/**
 * useSpaceAccessLevel - Hook to determine current user's access level in a space
 * 
 * Uses the space's access_control configuration to map user roles from
 * the users table to UserAccessLevel.
 */

import { logger } from '@/shared/utils/logger';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useSpacesStore } from '../store/spacesStore';
import { apiClient } from '@/shared/utils/apiClient';
import type { UserAccessLevel } from '@/shared/types/user-access.types';
import type { SpaceModel } from '../types/space.types';

interface SpaceAccessResult {
  accessLevel: UserAccessLevel;
  isOwner: boolean;
  isAdmin: boolean;
  isEditor: boolean;
  isViewer: boolean;
  isDenied: boolean;
  // Permission helpers
  canManageSpace: boolean;      // Owner/Admin only
  canSeeDataProcessing: boolean; // Owner/Admin only
  canAddWidget: boolean;         // Owner/Admin only
  canCreateFolder: boolean;      // Owner/Admin only
  canEditSchema: boolean;        // Owner/Admin only
  canEdit: boolean;              // Owner/Admin/Editor
  canView: boolean;              // All except denied
  loading: boolean;
}

// Fetch user role from the configured users table
async function fetchUserRoleFromTable(
  usersTableId: number,
  userIdColumn: string,
  roleColumn: string,
  userId: string
): Promise<string | null> {
  try {
    const response = await apiClient.get(`/api/tables/${usersTableId}/rows`, {
      params: {
        filters: JSON.stringify([{
          field: userIdColumn,
          operator: 'equals',
          value: userId
        }]),
        limit: 1
      }
    });
    
    if (response.data?.rows?.[0]) {
      return response.data.rows[0][roleColumn] || null;
    }
    return null;
  } catch {
    logger.warn('Failed to fetch user role from table:', usersTableId);
    return null;
  }
}

// Map role value to UserAccessLevel based on roleMapping
function mapRoleToAccessLevel(
  roleValue: string | null,
  roleMapping: SpaceModel['access_control']['roleMapping'],
  isSpaceOwner: boolean
): UserAccessLevel {
  // Space owner always has owner_owner access
  if (isSpaceOwner) {
    return 'owner_owner';
  }
  
  if (!roleValue || !roleMapping) {
    return 'viewer'; // Default to viewer if no role found
  }
  
  const roleLower = roleValue.toLowerCase().trim();
  
  // Check each access level in order of priority
  if (roleMapping.owner?.some(r => r.toLowerCase() === roleLower)) {
    return 'owner';
  }
  if (roleMapping.admin?.some(r => r.toLowerCase() === roleLower)) {
    return 'admin';
  }
  if (roleMapping.editor?.some(r => r.toLowerCase() === roleLower)) {
    return 'editor';
  }
  if (roleMapping.viewer?.some(r => r.toLowerCase() === roleLower)) {
    return 'viewer';
  }
  if (roleMapping.denied?.some(r => r.toLowerCase() === roleLower)) {
    return 'denied';
  }
  
  // Default to viewer if role not found in mapping
  return 'viewer';
}

/**
 * Hook to get current user's access level in a space
 */
export function useSpaceAccessLevel(spaceId: number | null): SpaceAccessResult {
  const user = useAuthStore(state => state.user);
  const getSpaceById = useSpacesStore(state => state.getSpaceById);
  
  const space = spaceId ? getSpaceById(spaceId) : null;
  const accessControl = space?.access_control;
  
  // Check if current user is the space owner
  const isSpaceOwner = user?.id && space?.owner_id ? 
    String(user.id) === String(space.owner_id) : false;
  
  // Support both old format (usersTableId) and new format (users_table_id)
  const usersTableId = accessControl?.users_table_id || accessControl?.usersTableId;
  const userIdColumn = accessControl?.user_id_column || accessControl?.userIdColumn || 'user_id';
  const roleColumn = accessControl?.role_column || accessControl?.roleColumn || 'role';
  
  // Fetch role from users table if access control is enabled
  // Note: This is a fallback - backend should provide user_access_level in space data
  const { data: userRole, isLoading } = useQuery({
    queryKey: ['spaceUserRole', spaceId, user?.id],
    queryFn: async () => {
      if (!accessControl?.enabled || !usersTableId || !user?.id) {
        return null;
      }
      return fetchUserRoleFromTable(
        usersTableId,
        userIdColumn,
        roleColumn,
        String(user.id)
      );
    },
    enabled: !!spaceId && !!user?.id && !!accessControl?.enabled && !!usersTableId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1
  });
  
  // Compute access level
  const accessLevel = useMemo((): UserAccessLevel => {
    // No space = denied
    if (!space) return 'denied';
    
    // PRIORITY 1: Use backend-computed access level if available
    // This is the most accurate as backend checks the users table
    const backendLevel = (space as any).user_access_level as string | undefined;
    if (backendLevel) {
      const allowed = ['owner_owner', 'owner', 'admin', 'editor', 'viewer', 'denied'];
      if (allowed.includes(backendLevel)) {
        return backendLevel as UserAccessLevel;
      }
    }
    
    // PRIORITY 2: Space owner always has full access
    if (isSpaceOwner) return 'owner_owner';
    
    // PRIORITY 3: If access control is not enabled, default to viewer for non-owners
    // Note: Global admin role should NOT override space-level access when access_control is enabled
    if (!accessControl?.enabled) {
      // Only use global role when access_control is disabled
      if (user?.role === 'owner' || user?.role === 'admin') {
        return 'admin';
      }
      return 'viewer';
    }
    
    // PRIORITY 4: Map role from table to access level (fallback if backend didn't provide level)
    return mapRoleToAccessLevel(userRole, accessControl.roleMapping, isSpaceOwner);
  }, [space, isSpaceOwner, accessControl, userRole, user?.role]);
  
  // Compute permission flags
  const result = useMemo((): SpaceAccessResult => {
    const isOwner = accessLevel === 'owner_owner' || accessLevel === 'owner';
    const isAdmin = accessLevel === 'admin';
    const isEditor = accessLevel === 'editor';
    const isViewer = accessLevel === 'viewer';
    const isDenied = accessLevel === 'denied';
    
    // Owner and Admin can do everything
    const isPrivileged = isOwner || isAdmin;
    
    return {
      accessLevel,
      isOwner,
      isAdmin,
      isEditor,
      isViewer,
      isDenied,
      // Permission helpers
      canManageSpace: isPrivileged,
      canSeeDataProcessing: isPrivileged,
      canAddWidget: isPrivileged,
      canCreateFolder: isPrivileged,
      canEditSchema: isPrivileged,
      canEdit: isPrivileged || isEditor,
      canView: !isDenied,
      loading: isLoading
    };
  }, [accessLevel, isLoading]);
  
  return result;
}

/**
 * Simple hook that just returns the access level without loading from API
 * Use when you already have the space data and just need to compute access
 */
export function useSpaceAccessLevelSync(space: SpaceModel | null): UserAccessLevel {
  const user = useAuthStore(state => state.user);
  
  return useMemo(() => {
    if (!space) return 'denied';
    
    // PRIORITY 1: Use backend-computed access level if available
    const backendLevel = (space as any).user_access_level as string | undefined;
    if (backendLevel) {
      const allowed = ['owner_owner', 'owner', 'admin', 'editor', 'viewer', 'denied'];
      if (allowed.includes(backendLevel)) {
        return backendLevel as UserAccessLevel;
      }
    }
    
    // PRIORITY 2: Space owner always has full access
    if (user?.id && String(user.id) === String(space.owner_id)) {
      return 'owner_owner';
    }
    
    // PRIORITY 3: If access control is not enabled, check global role
    if (!space.access_control?.enabled) {
      if (user?.role === 'owner' || user?.role === 'admin') {
        return 'admin';
      }
      return 'viewer';
    }
    
    // Without async role fetch, default to viewer
    // The async hook useSpaceAccessLevel should be used for accurate results
    return 'viewer';
  }, [space, user]);
}

/**
 * Pure function to compute access level from space and user
 * Use in render functions where hooks can't be called
 */
export function getSpaceAccessLevel(
  space: SpaceModel | null,
  user: { id: string; role: 'owner' | 'admin' | 'member' } | null
): UserAccessLevel {
  if (!space) return 'denied';
  
  // Если бэкенд уже прислал вычисленный уровень доступа
  const backendLevel = (space as any).user_access_level as string | undefined;
  
  // DEBUG: Log access level computation for Development space
  if (space.name === 'Development') {
    logger.debug('[getSpaceAccessLevel] Development space:', {
      spaceId: space.id,
      spaceName: space.name,
      backendLevel,
      userId: user?.id,
      userRole: user?.role,
      spaceOwnerId: space.owner_id,
      accessControlEnabled: space.access_control?.enabled
    });
  }
  
  if (backendLevel) {
    const allowed = ['owner_owner', 'owner', 'admin', 'editor', 'viewer', 'denied'];
    if (allowed.includes(backendLevel)) {
      if (space.name === 'Development') {
        logger.debug('[getSpaceAccessLevel] Returning backend level:', backendLevel);
      }
      return backendLevel as UserAccessLevel;
    }
  }
  
  // Space owner always has full access
  if (user?.id && String(user.id) === String(space.owner_id)) {
    return 'owner_owner';
  }
  
  // If access control is not enabled, check global role
  if (!space.access_control?.enabled) {
    if (user?.role === 'owner' || user?.role === 'admin') {
      return 'admin';
    }
    return 'viewer';
  }
  
  // Without async role data, default to viewer
  return 'viewer';
}

/**
 * Check if user has privileged access (owner or admin)
 */
export function hasPrivilegedAccess(accessLevel: UserAccessLevel): boolean {
  return ['owner_owner', 'owner', 'admin'].includes(accessLevel);
}
