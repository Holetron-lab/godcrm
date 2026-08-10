import { create } from 'zustand';
import type { ProjectModel } from '../api/projectsApi';

interface ProjectState {
  projects: ProjectModel[];
  currentProjectId: number | null;
  setProjects: (projects: ProjectModel[]) => void;
  selectProject: (projectId: number | null) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  currentProjectId: null,
  setProjects: (projects) =>
    set((state) => {
      const hasCurrent = state.currentProjectId
        ? projects.some((project) => project.id === state.currentProjectId)
        : false;
      return {
        projects,
        currentProjectId: hasCurrent ? state.currentProjectId : projects[0]?.id ?? null
      };
    }),
  selectProject: (projectId) => set({ currentProjectId: projectId })
}));

export const useCurrentProject = () =>
  useProjectStore((state) => state.projects.find((project) => project.id === state.currentProjectId) ?? null);
