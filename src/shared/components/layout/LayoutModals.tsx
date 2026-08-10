import { useNavigate } from 'react-router-dom';
import { CreateSpaceModal } from '@/features/spaces/components/CreateSpaceModal';
import { EditSpaceModal } from '@/features/spaces/components/EditSpaceModal';
import { SpaceManagerModal } from '@/features/space-manager';
import { DeleteSpaceModal } from '@/features/spaces/components/DeleteSpaceModal';
import { EditProjectModal } from '@/features/projects/components/EditProjectModal';
import { DeleteProjectModal } from '@/features/projects/components/DeleteProjectModal';
import { CreateProjectModal } from '@/features/projects/components/CreateProjectModal';
import { CreateTableModal } from '@/features/tables/components/CreateTableModal';
import { EditTableDisplayModal } from '@/features/tables/components/EditTableDisplayModal';
import { EditTableModal } from '@/features/tables/components/EditTableModal';
import { EditWidgetSettingsModal } from '@/features/widgets/components/modals/EditWidgetSettingsModal';
import { DataSourceWizard } from '@/features/data-sources/components/DataSourceWizard';
import { MissingColumnDialog } from '@/shared/components/dialogs/MissingColumnDialog';
import { VerificationGateModal } from '@/features/tables/components/modals/VerificationGateModal';
import { DesktopSettingsModal } from '@/shared/components/desktop/DesktopSettingsModal';
import { UpdateNotification } from '@/shared/components/desktop/UpdateNotification';
import { useDeleteTable } from '@/features/tables/hooks/useDeleteTable';
import type { Widget } from '@/features/widgets/types/widget.types';
import { logger } from '@/shared/utils/logger';
import { FloatingChatButton } from './FloatingChatButton';
import { ChatNotificationOrchestrator } from '@/shared/services/chatNotificationOrchestrator';

interface ModalProject {
  id: number;
  name: string;
  icon?: string | null;
  logo?: string | null;
  space_id?: number | null;
  owner_id?: number;
  description?: string | null;
  theme_primary?: string;
  theme_secondary?: string;
  theme_tertiary?: string;
  is_public?: boolean;
}

interface ModalSpace {
  id: number;
  name: string;
  icon?: string | null;
  type: string;
}

interface ModalTable {
  id: string;
  name: string;
  displayName?: string | null;
  projectId?: number | null;
}

export interface LayoutModalsProps {
  t: (key: string) => string;
  // Space modals
  isCreateSpaceModalOpen: boolean;
  setIsCreateSpaceModalOpen: (open: boolean) => void;
  isEditSpaceModalOpen: boolean;
  setIsEditSpaceModalOpen: (open: boolean) => void;
  isSpaceManagerModalOpen: boolean;
  setIsSpaceManagerModalOpen: (open: boolean) => void;
  isDeleteSpaceModalOpen: boolean;
  setIsDeleteSpaceModalOpen: (open: boolean) => void;
  spaceForEdit: ModalSpace | null;
  currentSpace: ModalSpace | null;
  editSpaceId: number | null;
  setEditSpaceId: (id: number | null) => void;
  // Project modals
  isCreateProjectModalOpen: boolean;
  setIsCreateProjectModalOpen: (open: boolean) => void;
  isEditProjectModalOpen: boolean;
  handleEditProjectModalChange: (open: boolean) => void;
  isDeleteProjectModalOpen: boolean;
  handleDeleteProjectModalChange: (open: boolean) => void;
  projectForEdit: ModalProject | null;
  projectForDelete: ModalProject | null;
  openDeleteProjectModal: (projectId: number) => void;
  targetSpaceId: number | null;
  setTargetSpaceId: (id: number | null) => void;
  selectProject: (id: number | null) => void;
  projects: ModalProject[];
  currentProject: ModalProject | null;
  // Table modals
  isCreateTableModalOpen: boolean;
  setIsCreateTableModalOpen: (open: boolean) => void;
  isEditTableDisplayModalOpen: boolean;
  setIsEditTableDisplayModalOpen: (open: boolean) => void;
  isEditTableModalOpen: boolean;
  setIsEditTableModalOpen: (open: boolean) => void;
  currentTable: ModalTable | null;
  currentWidgetId: string | null;
  // Widget modals
  isEditWidgetSettingsModalOpen: boolean;
  setIsEditWidgetSettingsModalOpen: (open: boolean) => void;
  currentWidget: Widget | null;
  // Data source
  isDataSourceWizardOpen: boolean;
  setIsDataSourceWizardOpen: (open: boolean) => void;
  // Desktop
  isSettingsOpen: boolean;
  closeSettings: () => void;
}

export const LayoutModals = ({
  t,
  isCreateSpaceModalOpen,
  setIsCreateSpaceModalOpen,
  isEditSpaceModalOpen,
  setIsEditSpaceModalOpen,
  isSpaceManagerModalOpen,
  setIsSpaceManagerModalOpen,
  isDeleteSpaceModalOpen,
  setIsDeleteSpaceModalOpen,
  spaceForEdit,
  currentSpace,
  editSpaceId,
  setEditSpaceId,
  isCreateProjectModalOpen,
  setIsCreateProjectModalOpen,
  isEditProjectModalOpen,
  handleEditProjectModalChange,
  isDeleteProjectModalOpen,
  handleDeleteProjectModalChange,
  projectForEdit,
  projectForDelete,
  openDeleteProjectModal,
  targetSpaceId,
  setTargetSpaceId,
  selectProject,
  projects,
  currentProject,
  isCreateTableModalOpen,
  setIsCreateTableModalOpen,
  isEditTableDisplayModalOpen,
  setIsEditTableDisplayModalOpen,
  isEditTableModalOpen,
  setIsEditTableModalOpen,
  currentTable,
  currentWidgetId,
  isEditWidgetSettingsModalOpen,
  setIsEditWidgetSettingsModalOpen,
  currentWidget,
  isDataSourceWizardOpen,
  setIsDataSourceWizardOpen,
  isSettingsOpen,
  closeSettings,
}: LayoutModalsProps) => {
  const navigate = useNavigate();
  const deleteTableMutation = useDeleteTable();

  return (
    <>
      <CreateSpaceModal
        open={isCreateSpaceModalOpen}
        onOpenChange={setIsCreateSpaceModalOpen}
      />
      <CreateProjectModal
        open={isCreateProjectModalOpen}
        onOpenChange={(open) => {
          setIsCreateProjectModalOpen(open);
          if (!open) setTargetSpaceId(null);
        }}
        spaceId={targetSpaceId}
        onCreated={(project) => {
          if (project?.id) {
            selectProject(project.id);
          }
          setTargetSpaceId(null);
        }}
      />
      {projectForEdit && (
        <EditProjectModal
          open={isEditProjectModalOpen}
          onOpenChange={handleEditProjectModalChange}
          onDeleteClick={() => openDeleteProjectModal(projectForEdit.id)}
          project={{ id: projectForEdit.id, name: projectForEdit.name, icon: projectForEdit.icon, space_id: projectForEdit.space_id ?? undefined, owner_id: projectForEdit.owner_id, description: projectForEdit.description, theme_primary: projectForEdit.theme_primary, theme_secondary: projectForEdit.theme_secondary, theme_tertiary: projectForEdit.theme_tertiary, is_public: projectForEdit.is_public }}
        />
      )}
      {projectForDelete && (
        <DeleteProjectModal
          open={isDeleteProjectModalOpen}
          onOpenChange={handleDeleteProjectModalChange}
          project={{
            id: projectForDelete.id,
            name: projectForDelete.name,
            space_id: projectForDelete.space_id ?? undefined
          }}
        />
      )}
      {spaceForEdit && (
        <EditSpaceModal
          open={isEditSpaceModalOpen}
          onOpenChange={(open) => {
            setIsEditSpaceModalOpen(open);
            if (!open) setEditSpaceId(null);
          }}
          onDeleteClick={() => {
            setIsEditSpaceModalOpen(false);
            setIsDeleteSpaceModalOpen(true);
          }}
          onOpenSpaceManager={() => {
            setIsEditSpaceModalOpen(false);
            setIsSpaceManagerModalOpen(true);
          }}
          space={{
            id: spaceForEdit.id,
            name: spaceForEdit.name,
            description: (spaceForEdit as any).description || null,
            icon: spaceForEdit.icon,
            type: spaceForEdit.type as 'personal' | 'business' | 'admin',
          }}
        />
      )}
      {spaceForEdit && (
        <SpaceManagerModal
          open={isSpaceManagerModalOpen}
          onOpenChange={(open) => {
            setIsSpaceManagerModalOpen(open);
            if (!open) setEditSpaceId(null);
          }}
          spaceId={spaceForEdit.id}
          spaceName={spaceForEdit.name}
          spaceIcon={spaceForEdit.icon || '📁'}
          initialTab="structure"
        />
      )}
      {currentSpace && currentSpace.id !== 1 && (
        <DeleteSpaceModal
          open={isDeleteSpaceModalOpen}
          onOpenChange={setIsDeleteSpaceModalOpen}
          space={{
            id: currentSpace.id,
            name: currentSpace.name
          }}
        />
      )}
      {currentProject && (
        <CreateTableModal
          open={isCreateTableModalOpen}
          onOpenChange={setIsCreateTableModalOpen}
          projectId={currentProject.id}
          projects={projects}
          onOpenDataSourceWizard={() => setIsDataSourceWizardOpen(true)}
        />
      )}
      {currentWidget && (
        <EditWidgetSettingsModal
          isOpen={isEditWidgetSettingsModalOpen}
          onClose={() => setIsEditWidgetSettingsModalOpen(false)}
          widget={currentWidget}
          onSaved={() => {
            // Refresh widget data
            window.location.reload();
          }}
        />
      )}
      {currentTable && !currentWidgetId && (
        <EditTableDisplayModal
          open={isEditTableDisplayModalOpen}
          onOpenChange={setIsEditTableDisplayModalOpen}
          tableId={currentTable.id}
          projectId={currentTable.projectId}
        />
      )}
      {currentTable && !currentWidgetId && (
        <EditTableModal
          open={isEditTableModalOpen}
          onOpenChange={setIsEditTableModalOpen}
          tableId={currentTable.id}
          projectId={currentTable.projectId}
          spaceId={currentProject?.space_id}
          onDeleteClick={async () => {
            if (confirm(t('tables.deleteTableConfirm'))) {
              try {
                await deleteTableMutation.mutateAsync(currentTable.id);
                if (currentProject) {
                  navigate(`/projects/${currentProject.id}/tables`);
                }
              } catch (error) {
                logger.error('Failed to delete table:', error);
                alert('Failed to delete table. Please try again.');
              }
            }
          }}
        />
      )}

      {/* Data Source Wizard Modal */}
      {isDataSourceWizardOpen && (
        <DataSourceWizard
          workspaceId={currentSpace?.id?.toString() || '1'}
          defaultSpaceId={currentSpace?.id ?? null}
          defaultProjectId={currentProject?.id ?? null}
          onClose={() => setIsDataSourceWizardOpen(false)}
          onSuccess={() => setIsDataSourceWizardOpen(false)}
        />
      )}

      {/* Floating AI Chat Button */}
      <FloatingChatButton />

      {/* ADR-0064: chat notifications fan-out (sound + toast + badge) */}
      <ChatNotificationOrchestrator />

      {/* Missing Column Resolution Dialog - ADR-031 */}
      <MissingColumnDialog />

      {/* ADR-0011 verification gate — global mount so documents widget and any
          other non-UniversalTable callers can surface the TOTP modal too. */}
      <VerificationGateModal />

      {/* Desktop Settings Modal */}
      <DesktopSettingsModal isOpen={isSettingsOpen} onClose={closeSettings} />

      {/* Desktop Update Notification */}
      <UpdateNotification />
    </>
  );
};
