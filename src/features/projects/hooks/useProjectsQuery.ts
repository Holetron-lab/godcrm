import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { projectsApi } from '../api/projectsApi';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useProjectStore } from '../store/projectStore';

export const useProjectsQuery = () => {
  const user = useAuthStore((state) => state.user);
  const setProjects = useProjectStore((state) => state.setProjects);
  
  const query = useQuery({
    queryKey: ['projects', user?.id ?? 'anonymous'],
    queryFn: () => projectsApi.list(),
    enabled: Boolean(user)
  });

  useEffect(() => {
    if (query.data) {
      setProjects(query.data);
    }
  }, [query.data, setProjects]);

  return query;
};

export const useUpdateProjectMutation = () => {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);

  return useMutation({
    mutationFn: ({ id, ...payload }: { id: number; name?: string; description?: string | null; icon?: string | null; access_control?: object | null; theme_primary?: string; theme_secondary?: string; theme_tertiary?: string; is_public?: boolean }) =>
      projectsApi.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', user?.id ?? 'anonymous'] });
    }
  });
};

export const useDeleteProjectMutation = () => {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);

  return useMutation({
    mutationFn: (id: number) => projectsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', user?.id ?? 'anonymous'] });
    }
  });
};
