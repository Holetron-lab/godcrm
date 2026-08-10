import { useQuery } from '@tanstack/react-query';
import { usersApi } from '../api/usersApi';
import { useAuthStore } from '@/features/auth/store/authStore';

export const useWorkspaceUsers = (enabled: boolean) => {
  const user = useAuthStore((state) => state.user);
  return useQuery({
    queryKey: ['workspace-users', user?.id ?? 'anonymous'],
    queryFn: () => usersApi.list(),
    enabled: Boolean(user && enabled)
  });
};
