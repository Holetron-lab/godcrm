/**
 * useSpaceAccessLevel - Hook to determine current user's access level in a space
 *
 * Uses the space's access_control configuration to map user roles from
 * the users table to UserAccessLevel.
 *
 * Fleet Audit WP-5 (Bugs 1552/228713, ADR-203 D3): the global `user.role`
 * gates system settings only. Inside a space the level comes from, in order,
 * the backend-computed `user_access_level`, space ownership, the space's own
 * access-control table, and only then (access control off) the global role —
 * mirroring backend/services/space/crud.js. Every entry point below goes
 * through the single `resolveSpaceAccessLevel` so the three of them cannot
 * drift again.
 */

import { logger } from '@/shared/utils/logger';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/features/auth/store/authStore';
import type { AuthUser } from '@/features/auth/types/auth.types';
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

/** The slice of the auth user the access computation needs. */
export type SpaceAccessUser = Pick<AuthUser, 'id' | 'role'>;

const ACCESS_LEVELS: readonly UserAccessLevel[] = ['owner_owner', 'owner', 'admin', 'editor', 'viewer', 'denied'];

const isAccessLevel = (value: unknown): value is UserAccessLevel =>
  typeof value === 'string' && (ACCESS_LEVELS as readonly string[]).includes(value);

/** Global owner/admin — the only two global roles that mean anything inside a space. */
const isGlobalAdmin = (user: SpaceAccessUser | null | undefined): boolean =>
  user?.role === 'owner' || user?.role === 'admin';

// Fetch user role from the configured users table
async function fetchUserRoleFromTable(
  usersTableId: number,
  userIdColumn: string,
  roleColumn: string,
  userId: string
): Promise<string | null> {
  try {
    const query = new URLSearchParams({
      filter: JSON.stringify({ [userIdColumn]: userId }),
      limit: '1',
      mode: 'raw'
    });
    const response = await apiClient.get<{ data?: { rows?: { data?: Record<string, unknown> }[] } }>(
      `/tables/${usersTableId}/rows?${query}`
    );
    const row = response.data?.rows?.[0]?.data;
    // Never use another user's role, even if the response ignores the filter.
    if (row && String(row[userIdColumn]) === userId) {
      const role = row[roleColumn];
      return typeof role === 'string' ? role : null;
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
  roleMapping: NonNullable<SpaceModel['access_control']>['roleMapping']
): UserAccessLevel {
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
 * Pure resolver shared by every entry point in this module.
 *
 * @param tableRole role value read from the space's users table (async hook
 *   only); `undefined` when the caller has no table data — then an enabled
 *   access control falls back to viewer.
 */
export function resolveSpaceAccessLevel(
  space: SpaceModel | null | undefined,
  user: SpaceAccessUser | null | undefined,
  tableRole?: string | null
): UserAccessLevel {
  // No space = denied
  if (!space) return 'denied';

  // PRIORITY 1: backend-computed level — it already knows ownership, the
  // access-control table and ADR-105 explicit permissions.
  const backendLevel = (space as { user_access_level?: unknown }).user_access_level;
  if (isAccessLevel(backendLevel)) return backendLevel;

  // PRIORITY 2: the space owner is owner_owner whatever their global role is (D3).
  if (user?.id != null && space.owner_id != null && String(user.id) === String(space.owner_id)) {
    return 'owner_owner';
  }

  // PRIORITY 3: access control on → the space's own users table decides.
  if (space.access_control?.enabled) {
    return tableRole === undefined ? 'viewer' : mapRoleToAccessLevel(tableRole, space.access_control.roleMapping);
  }

  // PRIORITY 4: access control off → global owner/admin are space admins,
  // everyone else (member, viewer) is a viewer. Same rule as the backend.
  return isGlobalAdmin(user) ? 'admin' : 'viewer';
}

/**
 * Hook to get current user's access level in a space
 */
export function useSpaceAccessLevel(spaceId: number | null): SpaceAccessResult {
  const user = useAuthStore(state => state.user);
  const space = useSpacesStore(state => spaceId ? state.spaces.find(s => s.id === spaceId) : null);
  const accessControl = space?.access_control;

  // Support both old format (usersTableId) and new format (users_table_id)
  const usersTableId = accessControl && 'users_table_id' in accessControl && typeof accessControl.users_table_id === 'number'
    ? accessControl.users_table_id || accessControl.usersTableId : accessControl?.usersTableId;
  const userIdColumn = (accessControl && 'user_id_column' in accessControl && typeof accessControl.user_id_column === 'string'
    ? accessControl.user_id_column : '') || accessControl?.userIdColumn || 'user_id';
  const roleColumn = (accessControl && 'role_column' in accessControl && typeof accessControl.role_column === 'string'
    ? accessControl.role_column : '') || accessControl?.roleColumn || 'role';

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

  const accessLevel = useMemo(
    () => resolveSpaceAccessLevel(space, user, userRole ?? null),
    [space, user, userRole]
  );

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
  return useMemo(() => resolveSpaceAccessLevel(space, user), [space, user]);
}

/**
 * Pure function to compute access level from space and user
 * Use in render functions where hooks can't be called
 */
export function getSpaceAccessLevel(
  space: SpaceModel | null,
  user: SpaceAccessUser | null
): UserAccessLevel {
  return resolveSpaceAccessLevel(space, user);
}

/**
 * Check if user has privileged access (owner or admin)
 */
export function hasPrivilegedAccess(accessLevel: UserAccessLevel): boolean {
  return ['owner_owner', 'owner', 'admin'].includes(accessLevel);
}
