import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/components/ui/Modal';
import { Input } from '@/shared/components/ui/Input';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { spacesApi } from '../api/spacesApi';
import { useSpacesOrder } from '../hooks/useSpacesOrder';
import { UserAccessPanel } from '@/shared/components/access/UserAccessPanel';
import type { UserAccessLevel } from '@/shared/types/user-access.types';
import { EmojiPicker } from '@/features/tables/components/UniversalTable/EmojiPicker';
// Space Manager imports
import { useSpaceManagerStore } from '@/features/space-manager/store/spaceManagerStore';
import { useSpaceTree } from '@/features/space-manager/hooks/useSpaceTree';
import { StructureTab } from '@/features/space-manager/components/tabs/StructureTab';
import { MoveItemsModal } from '@/features/space-manager/components/modals/MoveItemsModal';
import { CreateFolderModal } from '@/features/space-manager/components/modals/CreateFolderModal';
import { CreateProjectModal } from '@/features/space-manager/components/modals/CreateProjectModal';
import { DeleteConfirmModal } from '@/features/space-manager/components/modals/DeleteConfirmModal';
// Export/Import modals
import { ExportModal } from '@/features/tables/components/modals/ExportModal';
import { ImportModal } from '@/features/tables/components/modals/ImportModal';
import { SpaceVariablesTab } from './SpaceVariablesTab';
import { SpaceVisibilitySettings } from './SpaceVisibilitySettings';
import { SpaceInvitations } from './SpaceInvitations';
// Space Access Manager (extracted sub-components)
import { SpaceAccessManager } from './space-access';
import { SpaceConnectorsTab } from '@/features/connectors/components/SpaceConnectorsTab';
import { SpaceSecretsTab } from '@/features/secrets/components/SpaceSecretsTab';
import { FolderTree, Settings, Shield, Calculator, Loader2, Users, Mail, Plug, KeyRound } from 'lucide-react';

interface EditSpaceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleteClick?: () => void;
  onOpenSpaceManager?: () => void;
  space: {
    id: number;
    name: string;
    description?: string | null;
    icon?: string | null;
    type: 'personal' | 'business' | 'admin';
  };
}

type TabId = 'display' | 'structure' | 'variables' | 'access' | 'users' | 'invitations' | 'connectors' | 'secrets';

export const EditSpaceModal = ({ open, onOpenChange, onDeleteClick, space }: EditSpaceModalProps) => {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabId>('display');
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description || '');
  const [icon, setIcon] = useState(space.icon || '📁');
  const [error, setError] = useState('');

  // Current user's access level (owner for space creator)
  const currentUserLevel: UserAccessLevel = 'owner_owner';

  // Space Manager hooks
  const {
    searchQuery,
    setSearchQuery,
    setSpaceId,
    moveModalOpen,
    createFolderModalOpen,
    createProjectModalOpen,
    deleteConfirmOpen,
    exportModalOpen,
    importModalOpen,
    closeExportModal,
    closeImportModal,
    reset: resetSpaceManager
  } = useSpaceManagerStore();

  const { tree, isLoading: isTreeLoading, filterTree, invalidate: invalidateTree } = useSpaceTree(space.id);

  // Filter tree by search
  const filteredTree = useMemo(() => {
    return filterTree(tree, searchQuery);
  }, [tree, searchQuery, filterTree]);

  // Stats for footer
  const stats = useMemo(() => {
    let projects = 0;
    let tables = 0;
    let widgets = 0;

    const countNodes = (nodes: typeof tree) => {
      nodes.forEach(node => {
        if (node.type === 'project') projects++;
        else if (node.type === 'table') tables++;
        else if (node.type === 'widget') widgets++;
        countNodes(node.children);
      });
    };

    countNodes(tree);
    return { projects, tables, widgets };
  }, [tree]);

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async () => {
      return spacesApi.update(space.id, {
        name: name.trim(),
        description: description.trim() || null,
        icon: icon || '📁'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to update space');
    }
  });

  // Reset form when space changes
  useEffect(() => {
    setName(space.name);
    setDescription(space.description || '');
    setIcon(space.icon || '📁');
    setError('');
    setActiveTab('display');
    setSpaceId(space.id);
  }, [space.id, space.name, space.description, space.icon]);

  // Cleanup space manager on close
  useEffect(() => {
    if (!open) {
      resetSpaceManager();
    }
  }, [open]);

  const handleSubmit = () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    updateMutation.mutate();
  };

  const handleDeleteClick = () => {
    onOpenChange(false);
    onDeleteClick?.();
  };

  const tabs: { id: TabId; label: string; icon?: React.ReactNode }[] = [
    { id: 'display', label: 'Отображение', icon: <Settings className="w-4 h-4" /> },
    { id: 'structure', label: 'Структура', icon: <FolderTree className="w-4 h-4" /> },
    { id: 'variables', label: 'Переменные', icon: <Calculator className="w-4 h-4" /> },
    { id: 'connectors', label: 'Коннекторы', icon: <Plug className="w-4 h-4" /> },
    { id: 'secrets', label: 'Секреты', icon: <KeyRound className="w-4 h-4" /> },
    { id: 'access', label: 'Доступ', icon: <Shield className="w-4 h-4" /> },
    { id: 'users', label: 'Пользователи', icon: <Users className="w-4 h-4" /> },
    { id: 'invitations', label: 'Приглашения', icon: <Mail className="w-4 h-4" /> },
  ];

  return (
    <>
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`${space.name} (ID: ${space.id})`}
      description="Редактирование пространства"
      size="xl"
      fixedHeight={true}
      heightOffset={200}
      footer={
        <div className="flex-1 flex items-center gap-2">
          {onDeleteClick && (
            <button
              type="button"
              onClick={handleDeleteClick}
              className="h-9 px-4 text-sm font-medium text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 hover:border-red-500/50 transition-colors"
            >
              {t('spaces.delete.deleteButton')}
            </button>
          )}
          {activeTab === 'structure' && (
            <span className="text-sm text-[var(--text-tertiary)] ml-2">
              {stats.projects} проектов · {stats.tables} таблиц · {stats.widgets} виджетов
            </span>
          )}
        </div>
      }
      primaryAction={{
        label: updateMutation.isPending ? 'Сохранение...' : t('common.save'),
        onClick: handleSubmit,
        disabled: updateMutation.isPending
      }}
      secondaryAction={{
        label: t('common.cancel'),
        variant: 'ghost',
        onClick: () => onOpenChange(false)
      }}
    >
      <div className="flex flex-col h-full">
        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400 mb-4 shrink-0">
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-[var(--bg-secondary)] rounded-lg mb-4 shrink-0 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center justify-center gap-1 px-2.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content - scrollable */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Display Tab */}
          {activeTab === 'display' && (
            <div className="space-y-4">
              <div className="flex gap-3 items-end">
                <EmojiPicker
                  value={icon}
                  onChange={setIcon}
                  label={t('spaces.fields.icon')}
                  size="md"
                  portal
                />
                <div className="flex-1">
                  <Input
                    id="space-name"
                    label={t('spaces.fields.name')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('spaces.fields.namePlaceholder')}
                    autoComplete="off"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="space-description" className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                  {t('spaces.fields.description')}
                </label>
                <textarea
                  id="space-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('spaces.fields.descriptionPlaceholder')}
                  autoComplete="off"
                  rows={5}
                  className="w-full px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/20 focus:border-[var(--color-primary-500)] resize-none"
                />
              </div>

              {/* Personalization - Order */}
              <PersonalizationSection
                spaceId={space.id}
                spaceType={space.type}
              />

              {/* Visibility Settings (moved from separate tab) */}
              <div className="pt-2 mt-2 border-t border-[var(--border-primary)]">
                <SpaceVisibilitySettings spaceId={space.id} />
              </div>
            </div>
          )}

          {/* Structure Tab */}
          {activeTab === 'structure' && (
            <div className="h-full">
              {isTreeLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-6 h-6 animate-spin text-[var(--accent-primary)]" />
                </div>
              ) : (
                <StructureTab
                  tree={filteredTree}
                  spaceId={space.id}
                  onRefresh={invalidateTree}
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                />
              )}
            </div>
          )}

          {/* Access Tab - access settings only */}
          {activeTab === 'access' && (
            <UserAccessPanel
              entityType="space"
              entityId={space.id}
              spaceId={space.id}
              currentUserLevel={currentUserLevel}
            />
          )}

          {/* Users Tab - granular per-user access management */}
          {activeTab === 'users' && (
            <SpaceAccessManager
              spaceId={space.id}
              currentUserLevel={currentUserLevel}
            />
          )}

          {/* Invitations Tab */}
          {activeTab === 'invitations' && (
            <SpaceInvitations spaceId={space.id} />
          )}

          {/* Variables Tab (ADR-026) */}
          {activeTab === 'variables' && (
            <SpaceVariablesTab spaceId={space.id} />
          )}

          {/* Connectors Tab (ADR-0028) */}
          {activeTab === 'connectors' && (
            <SpaceConnectorsTab spaceId={space.id} />
          )}

          {/* Secrets Tab (ADR-0040 P2) — owner-only */}
          {activeTab === 'secrets' && (
            <SpaceSecretsTab spaceId={space.id} />
          )}

        </div>
      </div>
    </Modal>

    {/* Space Manager Sub-modals */}
    {moveModalOpen && (
      <MoveItemsModal
        spaceId={space.id}
        tree={tree}
        onSuccess={invalidateTree}
      />
    )}

    {createFolderModalOpen && (
      <CreateFolderModal
        spaceId={space.id}
        tree={tree}
        onSuccess={invalidateTree}
      />
    )}

    {createProjectModalOpen && (
      <CreateProjectModal
        spaceId={space.id}
        onSuccess={invalidateTree}
      />
    )}

    {deleteConfirmOpen && (
      <DeleteConfirmModal
        spaceId={space.id}
        onSuccess={invalidateTree}
      />
    )}

    {/* Export Modal */}
    {exportModalOpen && (
      <ExportModal
        isOpen={exportModalOpen}
        onClose={closeExportModal}
        tableId=""
        tableName={space.name}
        rowsCount={stats.tables}
        initialFormat="json"
      />
    )}

    {/* Import Modal */}
    {importModalOpen && (
      <ImportModal
        isOpen={importModalOpen}
        onClose={closeImportModal}
        spaceId={String(space.id)}
        spaceName={space.name}
        initialFormat="json"
      />
    )}
    </>
  );
};

/**
 * Personalization Section Component
 * Inline section for setting space order in sidebar
 */
interface PersonalizationSectionProps {
  spaceId: number;
  spaceType: 'personal' | 'business' | 'admin';
}

const PersonalizationSection = ({ spaceId, spaceType }: PersonalizationSectionProps) => {
  const { spacesOrder, getSpaceOrder, updateSpaceOrder, isUpdating } = useSpacesOrder();

  // Local order state for this space
  const currentOrder = getSpaceOrder(spaceId, spaceType);
  const [orderInput, setOrderInput] = useState(currentOrder.toString());

  // Update local state when spacesOrder changes
  useEffect(() => {
    setOrderInput(getSpaceOrder(spaceId, spaceType).toString());
  }, [spacesOrder, spaceId, spaceType]);

  const handleOrderChange = async () => {
    const newOrder = parseInt(orderInput, 10);
    if (!isNaN(newOrder) && newOrder !== currentOrder) {
      await updateSpaceOrder(spaceId, newOrder);
    }
  };

  // Check if this is a fixed space (personal or admin)
  const isFixed = spaceType === 'personal' || spaceType === 'admin';

  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
        Порядок в меню
      </label>
      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
        <div className="flex items-center gap-3">
          <input
            type="number"
            min="1"
            max="999"
            value={orderInput}
            onChange={(e) => setOrderInput(e.target.value)}
            onBlur={handleOrderChange}
            onKeyDown={(e) => e.key === 'Enter' && handleOrderChange()}
            disabled={isFixed || isUpdating}
            className={`w-20 px-3 py-2 text-center rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] focus:border-[var(--color-primary-500)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/20 ${
              isFixed ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          />
          <span className="text-sm text-[var(--text-tertiary)]">
            {isFixed
              ? (spaceType === 'personal' ? '🏠 Personal всегда первый' : '⚙️ Admin всегда последний')
              : 'Меньше число = выше в списке'
            }
          </span>
        </div>
      </div>
    </div>
  );
};
