import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';

interface Space {
  id: number;
  name: string;
  icon?: string;
}

interface Project {
  id: number;
  name: string;
  icon?: string;
  space_id?: number;
}

interface Table {
  id: number;
  project_id: number;
  name: string;
  display_name?: string;
  icon?: string;
}

interface TableWithContext {
  id: string;
  name: string;
  displayName: string;
  icon?: string;
  projectId: number;
  projectName: string;
  projectIcon?: string;
  spaceId?: number;
  displayField?: string;
}

interface ProjectWithContext {
  id: number;
  name: string;
  icon?: string;
  spaceId?: number;
  spaceName?: string;
  spaceIcon?: string;
  tables: TableWithContext[];
}

interface SpaceWithProjects {
  id: number;
  name: string;
  icon?: string;
  projects: ProjectWithContext[];
}

interface AllTablesData {
  /** All spaces with all projects (for "create new table" mode) */
  spaces: SpaceWithProjects[];
  /** Spaces with only projects that have tables (for "select existing" mode) */
  spacesWithTables: SpaceWithProjects[];
  /** All projects */
  projects: ProjectWithContext[];
  /** Only projects with tables */
  projectsWithTables: ProjectWithContext[];
  /** Flat list of all tables */
  flat: TableWithContext[];
}

/**
 * Hook to load ALL tables accessible to the user, grouped by space and project.
 * Used for relation column configuration to allow cross-project relations.
 */
export function useAllTables() {
  return useQuery({
    queryKey: ['all-tables-grouped'],
    queryFn: async () => {
      // Fetch all spaces first
      const spacesResponse = await apiClient.request<{ data: Space[] }>('/spaces');
      const spaces = spacesResponse.data || [];
      
      // Fetch all projects user has access to
      const projectsResponse = await apiClient.request<{ data: Project[] }>('/projects');
      const projects = projectsResponse.data || [];
      
      // Fetch tables for all projects in parallel
      const tablePromises = projects.map(project =>
        apiClient.request<{ data: Table[] }>(`/projects/${project.id}/tables`)
          .then(res => ({ projectId: project.id, tables: res.data || [] }))
          .catch(() => ({ projectId: project.id, tables: [] }))
      );
      
      const tableResults = await Promise.all(tablePromises);
      
      // Build flat list with context
      const flat: TableWithContext[] = [];
      tableResults.forEach(result => {
        const project = projects.find(p => p.id === result.projectId);
        if (!project) return;
        
        result.tables.forEach(table => {
          flat.push({
            id: String(table.id),
            name: table.name,
            displayName: table.display_name || table.name,
            icon: table.icon,
            projectId: project.id,
            projectName: project.name,
            projectIcon: project.icon
          });
        });
      });
      
      // Build grouped structure by project with space info
      // Include ALL projects (for "create new table" mode)
      const allProjects: ProjectWithContext[] = projects.map(project => {
        const space = spaces.find(s => s.id === project.space_id);
        return {
          id: project.id,
          name: project.name,
          icon: project.icon,
          spaceId: project.space_id,
          spaceName: space?.name,
          spaceIcon: space?.icon,
          tables: flat.filter(t => t.projectId === project.id)
        };
      });
      
      // Projects with tables only (for "select existing table" mode)
      const projectsWithTables = allProjects.filter(p => p.tables.length > 0);
      
      // Build grouped structure by space - ALL projects
      const allSpaces: SpaceWithProjects[] = spaces.map(space => ({
        id: space.id,
        name: space.name,
        icon: space.icon,
        projects: allProjects.filter(p => p.spaceId === space.id)
      })).filter(s => s.projects.length > 0);
      
      // Build grouped structure by space - only projects with tables
      const spacesWithTables: SpaceWithProjects[] = spaces.map(space => ({
        id: space.id,
        name: space.name,
        icon: space.icon,
        projects: projectsWithTables.filter(p => p.spaceId === space.id)
      })).filter(s => s.projects.length > 0);
      
      // Add projects without space as "Без пространства" (to allSpaces)
      const orphanProjects = allProjects.filter(p => !p.spaceId);
      if (orphanProjects.length > 0) {
        allSpaces.push({
          id: 0,
          name: 'Без пространства',
          icon: '📦',
          projects: orphanProjects
        });
      }
      
      // Add orphan projects with tables (to spacesWithTables)
      const orphanProjectsWithTables = orphanProjects.filter(p => p.tables.length > 0);
      if (orphanProjectsWithTables.length > 0) {
        spacesWithTables.push({
          id: 0,
          name: 'Без пространства',
          icon: '📦',
          projects: orphanProjectsWithTables
        });
      }
      
      return {
        // All spaces/projects (for "create new" mode)
        spaces: allSpaces,
        // Spaces with tables only (for "select existing" mode)
        spacesWithTables,
        projects: allProjects,
        projectsWithTables,
        flat
      } as AllTablesData;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes cache
  });
}
