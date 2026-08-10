/**
 * SpaceManagerModal - XL Modal for Space Management
 * Based on ADR-004: Space Manager XL Modal
 * 
 * Features:
 * - Tree view of all projects, folders, tables, widgets
 * - Batch operations (move, duplicate, delete)
 * - Drag-and-drop sorting
 * - Search and filter
 * - Create folders and projects
 */

import { useState, useEffect, useMemo } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { Input } from '@/shared/components/ui/Input';
import { Button } from '@/shared/components/ui/Button';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useSpaceManagerStore } from '../store/spaceManagerStore';
import { useSpaceTree } from '../hooks/useSpaceTree';
import { useBatchOperations } from '../hooks/useBatchOperations';
import { StructureTab } from './tabs/StructureTab';
import { SettingsTab } from './tabs/SettingsTab';
import { MoveItemsModal } from './modals/MoveItemsModal';
import { CreateFolderModal } from './modals/CreateFolderModal';
import { CreateProjectModal } from './modals/CreateProjectModal';
import { DeleteConfirmModal } from './modals/DeleteConfirmModal';
import type { SpaceManagerTab } from '../types/space-manager.types';
import { 
  Search, 
  Settings, 
  FolderTree, 
  Files, 
  Shield,
  ChevronDown,
  Plus,
  FolderPlus,
  Loader2,
  Trash2
} from 'lucide-react';

interface SpaceManagerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: number;
  spaceName: string;
  spaceIcon?: string;
  initialTab?: SpaceManagerTab;
}

const TABS: { id: SpaceManagerTab; label: string; icon: React.ReactNode }[] = [
  { id: 'structure', label: 'Structure', icon: <FolderTree className="w-4 h-4" /> },
  { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
];

export const SpaceManagerModal = ({
  open,
  onOpenChange,
  spaceId,
  spaceName,
  spaceIcon = '📁',
  initialTab = 'structure'
}: SpaceManagerModalProps) => {
  const { t } = useLanguage();
  const {
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    setSpaceId,
    selectedItems,
    deselectAll,
    openMoveModal,
    openCreateFolderModal,
    openCreateProjectModal,
    openDeleteConfirm,
    moveModalOpen,
    createFolderModalOpen,
    createProjectModalOpen,
    deleteConfirmOpen,
    reset
  } = useSpaceManagerStore();
  
  const { tree, isLoading, filterTree, invalidate } = useSpaceTree(spaceId);
  const { deleteSelected, isLoading: isBatchLoading } = useBatchOperations(spaceId);
  
  // Delete space confirmation state
  const [showDeleteSpaceConfirm, setShowDeleteSpaceConfirm] = useState(false);
  
  // Initialize
  useEffect(() => {
    if (open) {
      setSpaceId(spaceId);
      setActiveTab(initialTab);
    } else {
      reset();
    }
  }, [open, spaceId, initialTab]);
  
  // Filter tree by search
  const filteredTree = useMemo(() => {
    return filterTree(tree, searchQuery);
  }, [tree, searchQuery, filterTree]);
  
  // Stats
  const stats = useMemo(() => {
    let projects = 0;
    let tables = 0;
    let widgets = 0;
    let folders = 0;
    
    const countNodes = (nodes: typeof tree) => {
      nodes.forEach(node => {
        if (node.type === 'project') projects++;
        else if (node.type === 'table') tables++;
        else if (node.type === 'widget') widgets++;
        else if (node.type === 'folder') folders++;
        countNodes(node.children);
      });
    };
    
    countNodes(tree);
    return { projects, tables, widgets, folders };
  }, [tree]);
  
  const selectedCount = selectedItems.size;
  
  const handleClose = () => {
    onOpenChange(false);
  };
  
  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        size="xl"
        fixedHeight
        heightOffset={200}
        title={`${spaceIcon} ${spaceName} (ID: ${spaceId})`}
        description="Управление структурой пространства"
        footer={
          <div className="flex-1 flex items-center gap-3 text-sm text-[var(--text-tertiary)]">
            <span>{stats.projects} проектов · {stats.tables} таблиц · {stats.widgets} виджетов</span>
          </div>
        }
        secondaryAction={{
          label: 'Закрыть',
          variant: 'ghost',
          onClick: handleClose
        }}
      >
        <div className="flex flex-col h-full">
          {/* Tabs */}
          <div className="flex gap-1 p-1 bg-[var(--bg-secondary)] rounded-lg mb-4 shrink-0">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors rounded-md
                  ${activeTab === tab.id
                    ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                  }
                `}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
          
          {/* Content Area */}
          <div className="flex-1 min-h-0 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-6 h-6 animate-spin text-[var(--accent-primary)]" />
              </div>
            ) : activeTab === 'structure' ? (
              <StructureTab 
                tree={filteredTree} 
                spaceId={spaceId}
                onRefresh={invalidate}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
              />
            ) : activeTab === 'settings' ? (
              <SettingsTab spaceId={spaceId} onDeleteSpace={() => setShowDeleteSpaceConfirm(true)} />
            ) : null}
          </div>
        </div>
      </Modal>
      
      {/* Delete Space Confirmation Modal */}
      <Modal
        open={showDeleteSpaceConfirm}
        onOpenChange={setShowDeleteSpaceConfirm}
        title="Delete Space"
        size="sm"
      >
        <div className="py-4">
          <p className="text-[var(--text-secondary)] mb-4">
            Are you sure you want to delete <strong className="text-[var(--text-primary)]">{spaceName}</strong>?
          </p>
          <p className="text-sm text-red-400 bg-red-500/10 p-3 rounded-lg">
            ⚠️ This action cannot be undone. All projects, tables, widgets, and data within this space will be permanently deleted.
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t border-[var(--border-primary)]">
          <Button variant="secondary" onClick={() => setShowDeleteSpaceConfirm(false)}>
            Cancel
          </Button>
          <Button 
            variant="danger" 
            onClick={() => {
              // TODO: Implement space deletion API call
              setShowDeleteSpaceConfirm(false);
              onOpenChange(false);
            }}
          >
            Delete Space
          </Button>
        </div>
      </Modal>
      
      {/* Sub-modals */}
      {moveModalOpen && (
        <MoveItemsModal 
          spaceId={spaceId} 
          tree={tree}
          onSuccess={invalidate}
        />
      )}
      
      {createFolderModalOpen && (
        <CreateFolderModal 
          spaceId={spaceId}
          tree={tree}
          onSuccess={invalidate}
        />
      )}
      
      {createProjectModalOpen && (
        <CreateProjectModal 
          spaceId={spaceId}
          onSuccess={invalidate}
        />
      )}
      
      {deleteConfirmOpen && (
        <DeleteConfirmModal 
          spaceId={spaceId}
          onSuccess={invalidate}
        />
      )}
    </>
  );
};

export default SpaceManagerModal;
