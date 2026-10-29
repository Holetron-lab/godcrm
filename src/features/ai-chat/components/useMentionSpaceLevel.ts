import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { useSpacesStore } from '@/features/spaces/store/spacesStore';
import type { UserAccessLevel } from '@/shared/types/user-access.types';

/** Display-only membership lookup. Never use it to authorize an action. */
export function useMentionSpaceLevel(userId: number | undefined, enabled: boolean, spaceId?: number) {
  const space = useSpacesStore(state => {
    const id = spaceId ?? state.currentSpace?.id ?? state.activeSpaceId;
    return state.currentSpace?.id === id ? state.currentSpace : state.spaces.find(space => space.id === id);
  });
  const query = useQuery({
    queryKey: ['mention-space-membership', space?.id],
    queryFn: async () => {
      const [members, permissions] = await Promise.all([
        apiClient.get<{ success: boolean; data: { users: { id: number; role?: string | null }[] } }>(`/access/space/${space!.id}/available-users`),
        apiClient.get<{ success: boolean; data: { user_id: number; access_level: UserAccessLevel }[] }>(`/access/space/${space!.id}/permissions`),
      ]);
      if (!members.success || !permissions.success) throw new Error('Unable to load space membership');
      return { members: members.data.users, permissions: permissions.data };
    },
    enabled: enabled && !!space && userId != null,
    staleTime: 30_000,
    retry: false,
  });
  let level: UserAccessLevel | 'not_member' | 'unknown' = 'unknown';
  if (space && userId != null && query.isSuccess) {
    const permission = query.data.permissions.find(item => item.user_id === userId);
    const member = query.data.members.find(item => item.id === userId);
    if (String(space.owner_id) === String(userId)) level = 'owner_owner';
    else if (permission) level = permission.access_level;
    else if (!member) level = 'not_member';
    else {
      const role = member.role?.trim().toLowerCase();
      // Stored spaces use role_mappings; older editor state uses roleMapping.
      const config = space.access_control as typeof space.access_control & {
        role_mappings?: { columnValue: string; accessLevel: UserAccessLevel }[];
      };
      const levels = ['owner', 'admin', 'editor', 'viewer', 'denied'] as const;
      const mappedLevel = config?.role_mappings
        ? config.role_mappings.find(item => item.columnValue.trim().toLowerCase() === role)?.accessLevel
        : levels.find(key => config?.roleMapping?.[key]?.some(value => value.trim().toLowerCase() === role));
      // A custom table role is not necessarily an access level.
      level = mappedLevel
        || (!config?.enabled ? levels.find(key => key === role) : undefined)
        || 'unknown';
    }
  }
  return { spaceName: space?.name, level, loading: query.isFetching, error: query.isError };
}
