import { useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi } from '../api/projectsApi';
import type { ProjectModel } from '../api/projectsApi';
import { useProjectStore } from '../store/projectStore';

interface CreateProjectPayload {
  name: string;
  description?: string | null;
  logo?: string;
  space_id?: number;
}

export const useCreateProject = () => {
  const queryClient = useQueryClient();
  const selectProject = useProjectStore((state) => state.selectProject);
  return useMutation<ProjectModel, Error, CreateProjectPayload>({
    mutationFn: (payload) => projectsApi.create(payload),
    onSuccess: (project) => {
      if (project?.id) {
        selectProject(project.id);
      }
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
    }
  });
};
