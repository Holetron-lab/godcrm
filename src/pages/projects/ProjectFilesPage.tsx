import { useParams } from 'react-router-dom';
import { FilesPanel } from '@/features/files';

export function ProjectFilesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const numericProjectId = projectId ? parseInt(projectId) : undefined;

  return <FilesPanel projectId={numericProjectId} />;
}

export default ProjectFilesPage;
