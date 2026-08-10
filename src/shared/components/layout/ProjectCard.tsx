import { useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import type { TableModel } from '@/features/tables/types/table.types';
import { TableGroup } from './TableGroup';

export interface ProjectCardProps {
  project: { id: number; name: string; icon?: string | null; logo?: string | null };
  projectTables: TableModel[];
  isActive: boolean;
  activeTableId: string | null;
  t: (key: string) => string;
  onNavigate: (projectId: number) => void;
}

export const ProjectCard = ({ project, projectTables, isActive, activeTableId, t, onNavigate }: ProjectCardProps) => {
  const handleClick = useCallback(() => {
    onNavigate(project.id);
  }, [project.id, onNavigate]);

  return (
    <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)]">
      <button
        type="button"
        onClick={handleClick}
        className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold transition ${
          isActive
            ? 'text-[var(--color-primary-500)]'
            : 'text-[var(--text-primary)] hover:text-[var(--color-primary-400)]'
        }`}
      >
        <span>{project.name}</span>
        {isActive && (
          <span className="text-xs text-[var(--text-tertiary)]">{projectTables.length}</span>
        )}
      </button>
      {isActive && (
        <div className="border-t border-[var(--border-primary)]">
          {projectTables.length === 0 ? (
            <p className="px-4 py-2 text-xs text-[var(--text-tertiary)]">
              {t('tables.noProjectTables')}
            </p>
          ) : (
            <div className="flex flex-col gap-1 p-2">
              {/* Root tables (no parent) */}
              {projectTables
                .filter(table => !table.parent_table_id)
                .map((table) => {
                  const tableIdNum = parseInt(table.id);
                  const childTables = projectTables.filter(t => t.parent_table_id === tableIdNum);
                  const hasChildren = childTables.length > 0;

                  if (hasChildren) {
                    // Table group (folder)
                    return (
                      <TableGroup
                        key={table.id}
                        parentTable={table}
                        childTables={childTables}
                        activeTableId={activeTableId}
                      />
                    );
                  }

                  // Regular table
                  return (
                    <NavLink
                      key={table.id}
                      to={`/tables/${table.id}`}
                      className={({ isActive: linkActive }) =>
                        `rounded-lg px-3 py-1 text-sm transition ${
                          linkActive || activeTableId === table.id
                            ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)]'
                            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                        }`
                      }
                    >
                      {table.displayName ?? table.name}
                    </NavLink>
                  );
                })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
