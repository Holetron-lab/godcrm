import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { Button } from '@/shared/components/ui';
import { useTablesBootstrap } from '@/features/tables/hooks/useTablesBootstrap';
import { useTablesStore } from '@/features/tables/store/tablesStore';
import { CreateTableModal } from '@/features/tables/components/CreateTableModal';
import { useSpacesQuery } from '@/features/spaces/hooks/useSpacesQuery';
import { CreateSpaceModal } from '@/features/spaces/components/CreateSpaceModal';
import { useProjectStore } from '@/features/projects/store/projectStore';
import { useProjectsQuery } from '@/features/projects/hooks/useProjectsQuery';

const ProjectsPage = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const { loading } = useTablesBootstrap();
  const tables = useTablesStore((state) => state.tables);
  const [modalOpen, setModalOpen] = useState(false);
  const [spaceModalOpen, setSpaceModalOpen] = useState(false);
  const { data: spaces = [], isLoading: spacesLoading } = useSpacesQuery();
  const { data: projects = [] } = useProjectsQuery();
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const selectProject = useProjectStore((state) => state.selectProject);

  // Redirect to space dashboard instead of showing placeholder
  useEffect(() => {
    if (projectId) {
      const project = projects.find(p => p.id === parseInt(projectId));
      if (project?.space_id) {
        navigate(`/spaces/${project.space_id}/dashboard`, { replace: true });
      }
    }
  }, [projectId, projects, navigate]);

  const projectTables = useMemo(
    () => tables.filter((table) => (table.projectId ?? null) === currentProjectId),
    [tables, currentProjectId]
  );

  const selectedSpace = spaces[0] ?? null; // For now, use first space

  const handleSpaceCreated = (space: { id: number }) => {
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-[var(--text-secondary)]">
          {selectedSpace ? selectedSpace.name : 'Workspace Dashboard'}
        </p>
        <h2 className="text-3xl font-semibold text-[var(--text-primary)]">
          Dashboard & Analytics
        </h2>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6">
          <p className="text-sm font-medium text-[var(--text-secondary)]">Total Tables</p>
          <p className="mt-2 text-3xl font-bold text-[var(--text-primary)]">{projectTables.length}</p>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">in current workspace</p>
        </div>
        <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6">
          <p className="text-sm font-medium text-[var(--text-secondary)]">Workspaces</p>
          <p className="mt-2 text-3xl font-bold text-[var(--text-primary)]">{spaces.length}</p>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">total projects</p>
        </div>
        <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6">
          <p className="text-sm font-medium text-[var(--text-secondary)]">System Tables</p>
          <p className="mt-2 text-3xl font-bold text-[var(--text-primary)]">
            {tables.filter((t) => t.type === 'system').length}
          </p>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">auto-managed</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6">
        <p className="mb-4 text-sm font-semibold text-[var(--text-secondary)]">Quick Actions</p>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={() => setSpaceModalOpen(true)}>
            ➕ Create Workspace
          </Button>
          <Button variant="secondary" onClick={() => setModalOpen(true)} disabled={!currentProjectId}>
            📋 Create Table
          </Button>
          <Button variant="secondary" onClick={() => navigate('/projects/1/data-sources')}>
            🔗 Data Sources
          </Button>
          <Button variant="ghost" onClick={() => navigate('/users')}>
            👥 Manage Users
          </Button>
          <Button variant="ghost" onClick={() => navigate('/settings')}>
            ⚙️ Settings
          </Button>
        </div>
      </div>

      {/* Recent Tables */}
      {selectedSpace && projectTables.length > 0 && (
        <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-[var(--text-secondary)]">Tables in {selectedSpace.name}</p>
              <p className="text-xs text-[var(--text-tertiary)]">Click table name to open</p>
            </div>
            <Button variant="ghost" onClick={() => setModalOpen(true)}>
              Add Table
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {projectTables.map((table) => (
              <button
                key={table.id}
                type="button"
                onClick={() => navigate(`/tables/${table.id}`)}
                className="flex items-center justify-between rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] px-4 py-3 text-left transition hover:border-[var(--color-primary-400)]"
              >
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    {table.icon} {table.displayName ?? table.name}
                  </p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {table.type === 'system' ? '🔐 System' : '📝 Custom'}
                  </p>
                </div>
                <span className="text-xl">→</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Widget Examples */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Task List Widget */}
        <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6">
          <p className="mb-4 text-sm font-semibold text-[var(--text-secondary)]">📌 Quick Tasks</p>
          <div className="space-y-2">
            {[
              { task: 'Review Password Manager entries', done: false },
              { task: 'Update project settings', done: true },
              { task: 'Add new team member', done: false }
            ].map((item, idx) => (
              <label key={idx} className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-[var(--bg-tertiary)]">
                <input
                  type="checkbox"
                  defaultChecked={item.done}
                  className="h-4 w-4 rounded border-[var(--border-primary)]"
                />
                <span className={item.done ? 'text-sm text-[var(--text-tertiary)] line-through' : 'text-sm text-[var(--text-primary)]'}>
                  {item.task}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Activity Widget */}
        <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6">
          <p className="mb-4 text-sm font-semibold text-[var(--text-secondary)]">📊 Recent Activity</p>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-green-500/20 p-1 text-xs">✓</div>
              <div className="flex-1">
                <p className="text-sm text-[var(--text-primary)]">Password Manager created</p>
                <p className="text-xs text-[var(--text-tertiary)]">2 minutes ago</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-primary-500/20 p-1 text-xs">📝</div>
              <div className="flex-1">
                <p className="text-sm text-[var(--text-primary)]">Personal Space initialized</p>
                <p className="text-xs text-[var(--text-tertiary)]">5 minutes ago</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-purple-500/20 p-1 text-xs">👤</div>
              <div className="flex-1">
                <p className="text-sm text-[var(--text-primary)]">User logged in</p>
                <p className="text-xs text-[var(--text-tertiary)]">10 minutes ago</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6">
          <p className="text-center text-sm text-[var(--text-secondary)]">Loading dashboard data...</p>
        </div>
      )}

      <CreateTableModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        projectId={currentProjectId}
        projects={spaces.map((space) => ({ id: space.id, name: space.name }))}
      />
      <CreateSpaceModal
        open={spaceModalOpen}
        onOpenChange={setSpaceModalOpen}
        onCreated={handleSpaceCreated}
      />
    </section>
  );
};

export default ProjectsPage;
