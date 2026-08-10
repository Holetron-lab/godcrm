import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTablesStore } from '@/features/tables/store/tablesStore';
import { useDeleteWidget, widgetKeys } from '@/features/widgets/hooks/useWidgets';
import { useDeleteTable } from '@/features/tables/hooks/useDeleteTable';
import { spacesKeys } from '@/features/spaces/hooks/useSpacesQuery';
import { showToast } from '@/shared/hooks/useToast';
import { logger } from '@/shared/utils/logger';
import type { Widget } from '@/features/widgets/types/widget.types';
import { Table, Database, Edit, Folder, MoreVertical, Trash2, Download, Upload, GitMerge, Columns3, FolderPlus } from 'lucide-react';

interface CurrentProject {
  id: number;
  name: string;
  space_id?: number | null;
}

interface CurrentSpace {
  id: number;
  name: string;
}

interface CurrentTable {
  id: string;
  name: string;
  displayName?: string | null;
  projectId?: number | null;
}

export interface HeaderActionsMenuProps {
  t: (key: string) => string;
  isActionsMenuOpen: boolean;
  setIsActionsMenuOpen: (open: boolean) => void;
  currentProject: CurrentProject | null;
  currentSpace: CurrentSpace | null;
  currentTable: CurrentTable | null;
  currentWidgetId: string | null;
  currentWidget: Widget | null;
  setIsCreateTableModalOpen: (open: boolean) => void;
  setIsCreateProjectModalOpen: (open: boolean) => void;
  setIsDataSourceWizardOpen: (open: boolean) => void;
  setIsEditWidgetSettingsModalOpen: (open: boolean) => void;
  setEditProjectId: (id: number | null) => void;
  setIsEditProjectModalOpen: (open: boolean) => void;
  setIsEditSpaceModalOpen: (open: boolean) => void;
  setIsEditTableModalOpen: (open: boolean) => void;
  setIsDeleteSpaceModalOpen: (open: boolean) => void;
  openDeleteProjectModal: (projectId: number) => void;
}

export const HeaderActionsMenu = ({
  t,
  isActionsMenuOpen,
  setIsActionsMenuOpen,
  currentProject,
  currentSpace,
  currentTable,
  currentWidgetId,
  currentWidget,
  setIsCreateTableModalOpen,
  setIsCreateProjectModalOpen,
  setIsDataSourceWizardOpen,
  setIsEditWidgetSettingsModalOpen,
  setEditProjectId,
  setIsEditProjectModalOpen,
  setIsEditSpaceModalOpen,
  setIsEditTableModalOpen,
  setIsDeleteSpaceModalOpen,
  openDeleteProjectModal,
}: HeaderActionsMenuProps) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deleteWidgetMutation = useDeleteWidget();
  const deleteTableMutation = useDeleteTable();
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative">
      <button
        ref={menuButtonRef}
        type="button"
        onClick={() => setIsActionsMenuOpen(!isActionsMenuOpen)}
        className="inline-flex items-center justify-center rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm font-medium text-[var(--text-primary)] shadow-sm hover:bg-[var(--bg-tertiary)] transition"
        title="Actions"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {isActionsMenuOpen && (
        <>
          {/* Overlay to close menu */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsActionsMenuOpen(false)}
          />

          {/* Dropdown Menu */}
          <div className="absolute right-0 top-full mt-2 w-64 z-50 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-lg overflow-hidden">

            {/* === CREATE SECTION === */}
            {/* Create Table */}
            <button
              onClick={() => {
                setIsActionsMenuOpen(false);
                setIsCreateTableModalOpen(true);
              }}
              disabled={!currentProject}
              className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Table className="w-4 h-4 text-[var(--color-primary-500)]" />
              <div className="flex-1">
                <div className="font-semibold">{t('tables.createButton')}</div>
                <div className="text-xs text-[var(--text-tertiary)]">{t('tables.emptyState')}</div>
              </div>
            </button>

            {/* Create Project */}
            <button
              onClick={() => {
                setIsActionsMenuOpen(false);
                setIsCreateProjectModalOpen(true);
              }}
              disabled={!currentSpace}
              className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FolderPlus className="w-4 h-4 text-purple-500" />
              <div className="flex-1">
                <div className="font-semibold">{t('projects.createButton')}</div>
                <div className="text-xs text-[var(--text-tertiary)]">{t('projects.modalDescription')}</div>
              </div>
            </button>

            {/* Add Data Source */}
            <button
              onClick={() => {
                setIsActionsMenuOpen(false);
                setIsDataSourceWizardOpen(true);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition"
            >
              <Database className="w-4 h-4 text-yellow-500" />
              <div className="flex-1">
                <div className="font-semibold">{t('dataSources.createButton')}</div>
                <div className="text-xs text-[var(--text-tertiary)]">{t('dataSources.subtitle')}</div>
              </div>
            </button>

            {/* Schema Editor */}
            <button
              onClick={() => {
                setIsActionsMenuOpen(false);
                if (currentSpace) {
                  navigate(`/spaces/${currentSpace.id}/schema`);
                }
              }}
              disabled={!currentSpace}
              className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <GitMerge className="w-4 h-4 text-cyan-500" />
              <div className="flex-1">
                <div className="font-semibold">{t('headerActions.schemaEditorTitle')}</div>
                <div className="text-xs text-[var(--text-tertiary)]">{t('headerActions.schemaEditorSubtitle')}</div>
              </div>
            </button>

            {/* === TABLE ACTIONS === */}
            {currentTable && (
              <>
                <div className="border-t border-[var(--border-primary)]" />

                {/* Export Table (unified JSON/CSV) */}
                <button
                  onClick={() => {
                    setIsActionsMenuOpen(false);
                    useTablesStore.getState().setExportModalOpen(true);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition"
                >
                  <Download className="w-4 h-4 text-green-500" />
                  <div className="flex-1">
                    <div className="font-semibold">{t('table.export')}</div>
                    <div className="text-xs text-[var(--text-tertiary)]">JSON / CSV</div>
                  </div>
                </button>

                {/* Import Table (unified JSON/CSV) */}
                <button
                  onClick={() => {
                    setIsActionsMenuOpen(false);
                    useTablesStore.getState().setImportModalOpen(true);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition"
                >
                  <Upload className="w-4 h-4 text-purple-500" />
                  <div className="flex-1">
                    <div className="font-semibold">{t('table.import')}</div>
                    <div className="text-xs text-[var(--text-tertiary)]">JSON / CSV</div>
                  </div>
                </button>
              </>
            )}

            {/* === WIDGET ACTIONS === */}
            {currentWidgetId && currentWidget && (
              <>
                <div className="border-t border-[var(--border-primary)]" />

                {/* Edit Widget - opens settings modal for all widget types */}
                <button
                  onClick={() => {
                    setIsActionsMenuOpen(false);
                    setIsEditWidgetSettingsModalOpen(true);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition"
                >
                  <Columns3 className="w-4 h-4 text-cyan-500" />
                  <div className="flex-1">
                    <div className="font-semibold">{t('headerActions.editWidget')}</div>
                    <div className="text-xs text-[var(--text-tertiary)]">
                      {t('headerActions.editWidgetSubtitle')}
                    </div>
                  </div>
                </button>

                {/* Edit Widget Code - only for custom widgets */}
                {currentWidget.widget_type !== 'preset' && (
                  <button
                    onClick={() => {
                      setIsActionsMenuOpen(false);
                      navigate(`/widgets/${currentWidgetId}/edit`);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition"
                  >
                    <Edit className="w-4 h-4 text-purple-500" />
                    <div className="flex-1">
                      <div className="font-semibold">{t('headerActions.editWidgetCode')}</div>
                      <div className="text-xs text-[var(--text-tertiary)]">
                        {t('headerActions.editWidgetCodeSubtitle')}
                      </div>
                    </div>
                  </button>
                )}
              </>
            )}

            {/* === EDIT SECTION === */}
            <div className="border-t border-[var(--border-primary)]" />

            {/* Edit Project */}
            {currentProject && (
              <button
                onClick={() => {
                  setIsActionsMenuOpen(false);
                  setEditProjectId(null);
                  setIsEditProjectModalOpen(true);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition"
              >
                <Edit className="w-4 h-4 text-primary-500" />
                <div className="flex-1">
                  <div className="font-semibold">{t('projects.edit.title')}</div>
                  <div className="text-xs text-[var(--text-tertiary)]">{currentProject.name}</div>
                </div>
              </button>
            )}

            {/* Edit Space */}
            {currentSpace && (
              <button
                onClick={() => {
                  setIsActionsMenuOpen(false);
                  setIsEditSpaceModalOpen(true);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition"
              >
                <Folder className="w-4 h-4 text-purple-500" />
                <div className="flex-1">
                  <div className="font-semibold">{t('spaces.edit.title')}</div>
                  <div className="text-xs text-[var(--text-tertiary)]">{currentSpace.name}</div>
                </div>
              </button>
            )}

            {/* === DELETE SECTION === */}
            <div className="border-t border-[var(--border-primary)]" />

            {/* Edit Table (with delete inside) */}
            {currentTable && !currentWidgetId && (
              <button
                onClick={() => {
                  setIsActionsMenuOpen(false);
                  setIsEditTableModalOpen(true);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition"
              >
                <Table className="w-4 h-4 text-green-500" />
                <div className="flex-1">
                  <div className="font-semibold">{t('headerActions.editTable')}</div>
                  <div className="text-xs text-[var(--text-tertiary)]">{currentTable.displayName || currentTable.name}</div>
                </div>
              </button>
            )}

            {/* Delete Widget */}
            {currentWidgetId && (
              <button
                onClick={async () => {
                  setIsActionsMenuOpen(false);
                  if (confirm(t('headerActions.deleteWidgetConfirm'))) {
                    try {
                      const widgetIdNum = typeof currentWidgetId === 'string' ? parseInt(currentWidgetId, 10) : currentWidgetId;
                      await deleteWidgetMutation.mutateAsync(widgetIdNum);
                      // Invalidate all related queries to refresh sidebar and dashboards
                      await queryClient.invalidateQueries({ queryKey: spacesKeys.lists() });
                      await queryClient.invalidateQueries({ queryKey: widgetKeys.lists() });
                      await queryClient.invalidateQueries({ queryKey: ['project-dashboard'] });
                      showToast(t('headerActions.widgetDeleted'), 'success');
                      navigate(-1);
                    } catch (error) {
                      logger.error('Failed to delete widget:', error);
                      showToast(t('headerActions.widgetDeleteFailed'), 'error');
                    }
                  }
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-medium text-[var(--color-error)] hover:bg-[var(--bg-secondary)] transition"
              >
                <Trash2 className="w-4 h-4" />
                <div className="flex-1">
                  <div className="font-semibold">{t('headerActions.deleteWidget')}</div>
                  <div className="text-xs text-[var(--text-tertiary)]">{t('headerActions.moduleLabel')} #{currentWidgetId}</div>
                </div>
              </button>
            )}

            {/* Delete Project */}
            {currentProject && !currentTable && !currentWidgetId && (
              <button
                onClick={() => {
                  setIsActionsMenuOpen(false);
                  openDeleteProjectModal(currentProject.id);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-medium text-[var(--color-error)] hover:bg-[var(--bg-secondary)] transition"
              >
                <Trash2 className="w-4 h-4" />
                <div className="flex-1">
                  <div className="font-semibold">{t('projects.delete.title')}</div>
                  <div className="text-xs text-[var(--text-tertiary)]">{currentProject.name}</div>
                </div>
              </button>
            )}

            {/* Delete Space */}
            {currentSpace && !currentProject && !currentTable && !currentWidgetId && currentSpace.id !== 1 && (
              <button
                onClick={() => {
                  setIsActionsMenuOpen(false);
                  setIsDeleteSpaceModalOpen(true);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-medium text-[var(--color-error)] hover:bg-[var(--bg-secondary)] transition"
              >
                <Trash2 className="w-4 h-4" />
                <div className="flex-1">
                  <div className="font-semibold">{t('spaces.delete.title')}</div>
                  <div className="text-xs text-[var(--text-tertiary)]">{currentSpace.name}</div>
                </div>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};
