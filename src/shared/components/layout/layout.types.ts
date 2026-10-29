export interface LayoutContentProps {
  t: (key: string) => string;
  location: { pathname: string; search?: string };
  currentProject: {
    id: number;
    name: string;
    business_name?: string | null;
    icon?: string | null;
    logo?: string | null;
    description?: string | null;
    space_id?: number | null;
  } | null;
  projects: Array<{
    id: number;
    name: string;
    icon?: string | null;
    logo?: string | null;
    space_id?: number | null;
  }>;
  spaces: Array<{
    id: number;
    name: string;
    icon?: string | null;
    type: string;
    projects_count?: number;
  }>;
  selectProject: (id: number | null) => void;
}
