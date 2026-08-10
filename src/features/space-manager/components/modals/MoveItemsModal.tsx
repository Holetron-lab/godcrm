/**
 * MoveItemsModal - Modal for moving items to another project/folder
 */

import { logger } from '@/shared/utils/logger';
import { useState, useMemo } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui/Button';
import { useSpaceManagerStore, parseItemId } from '../../store/spaceManagerStore';
import { useBatchOperations } from '../../hooks/useBatchOperations';
import type { TreeNode } from '../../types/space-manager.types';
import { Folder, ChevronRight, ChevronDown, Loader2, AlertCircle } from 'lucide-react';

interface MoveItemsModalProps {
  spaceId: number;
  tree: TreeNode[];
  onSuccess: () => void;
}

export const MoveItemsModal = ({ spaceId, tree, onSuccess }: MoveItemsModalProps) => {
  const { moveModalOpen, moveModalItems, closeMoveModal } = useSpaceManagerStore();
  const { moveItems, isLoading } = useBatchOperations(spaceId);
  
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<number>>(new Set());
  
  // Get projects from tree
  const projects = useMemo(() => {
    return tree.filter(n => n.type === 'project');
  }, [tree]);
  
  // Get folders for selected project
  const folders = useMemo(() => {
    if (!selectedProjectId) return [];
    
    const project = projects.find(p => {
      const { numericId } = parseItemId(p.id);
      return numericId === selectedProjectId;
    });
    
    if (!project) return [];
    
    const findFolders = (nodes: TreeNode[]): TreeNode[] => {
      return nodes.flatMap(n => {
        if (n.type === 'folder') {
          return [n, ...findFolders(n.children)];
        }
        return findFolders(n.children);
      });
    };
    
    return findFolders(project.children);
  }, [selectedProjectId, projects]);
  
  // Items being moved - exclude projects
  const itemsToMove = useMemo(() => {
    return moveModalItems.filter(id => {
      const { type } = parseItemId(id);
      return type !== 'project';
    });
  }, [moveModalItems]);
  
  const toggleProjectExpand = (projectId: number) => {
    const next = new Set(expandedProjects);
    if (next.has(projectId)) {
      next.delete(projectId);
    } else {
      next.add(projectId);
    }
    setExpandedProjects(next);
  };
  
  const handleMove = async () => {
    if (!selectedProjectId) return;
    
    try {
      await moveItems(itemsToMove, {
        projectId: selectedProjectId,
        folderId: selectedFolderId
      });
      onSuccess();
      closeMoveModal();
    } catch (err) {
      logger.error('Move failed:', err);
    }
  };
  
  // Recursive folder renderer
  const renderFolders = (nodes: TreeNode[], projectId: number, depth: number): JSX.Element[] => {
    return nodes
      .filter(n => n.type === 'folder')
      .map(folder => {
        const { numericId: folderId } = parseItemId(folder.id);
        const isFolderSelected = selectedProjectId === projectId && selectedFolderId === folderId;
        const hasSubfolders = folder.children.some(c => c.type === 'folder');
        
        return (
          <div key={folder.id}>
            <div
              onClick={() => {
                setSelectedProjectId(projectId);
                setSelectedFolderId(folderId);
              }}
              style={{ paddingLeft: `${depth * 16 + 12}px` }}
              className={`
                flex items-center gap-2 py-2 pr-3 cursor-pointer
                ${isFolderSelected 
                  ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]' 
                  : 'hover:bg-[var(--bg-secondary)]'
                }
              `}
            >
              <Folder className="w-4 h-4" />
              <span className="text-sm truncate">{folder.name}</span>
            </div>
            {hasSubfolders && renderFolders(folder.children, projectId, depth + 1)}
          </div>
        );
      });
  };
  
  if (!moveModalOpen) return null;
  
  return (
    <Modal
      open={moveModalOpen}
      onOpenChange={(open) => !open && closeMoveModal()}
      title="Move Items"
      size="md"
    >
      <div className="space-y-4">
        {/* Info */}
        <div className="flex items-start gap-2 p-3 bg-[var(--bg-secondary)] rounded-lg">
          <AlertCircle className="w-5 h-5 text-[var(--accent-primary)] flex-shrink-0 mt-0.5" />
          <div className="text-sm text-[var(--text-secondary)]">
            Moving <strong className="text-[var(--text-primary)]">{itemsToMove.length}</strong> item{itemsToMove.length > 1 ? 's' : ''} to a new location.
            {itemsToMove.length === 0 && (
              <span className="text-amber-500 block mt-1">
                Projects cannot be moved between spaces.
              </span>
            )}
          </div>
        </div>
        
        {/* Project/Folder Selection */}
        <div className="max-h-[300px] overflow-y-auto border border-[var(--border-primary)] rounded-lg">
          {projects.map(project => {
            const { numericId: projectId } = parseItemId(project.id);
            const isExpanded = expandedProjects.has(projectId);
            const isSelected = selectedProjectId === projectId && !selectedFolderId;
            const projectFolders = folders.filter(f => {
              // Only show folders from this project
              const findFolderInProject = (nodes: TreeNode[]): boolean => {
                return nodes.some(n => {
                  if (n.id === f.id) return true;
                  return findFolderInProject(n.children);
                });
              };
              return selectedProjectId === projectId || findFolderInProject(project.children);
            });
            
            return (
              <div key={project.id}>
                {/* Project Row */}
                <div
                  onClick={() => {
                    setSelectedProjectId(projectId);
                    setSelectedFolderId(null);
                  }}
                  className={`
                    flex items-center gap-2 px-3 py-2 cursor-pointer
                    ${isSelected 
                      ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]' 
                      : 'hover:bg-[var(--bg-secondary)]'
                    }
                  `}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleProjectExpand(projectId);
                    }}
                    className="p-1 hover:bg-[var(--bg-tertiary)] rounded"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </button>
                  
                  <span className="text-lg">{project.icon}</span>
                  <span className="text-sm font-medium">{project.name}</span>
                  <span className="text-xs text-[var(--text-tertiary)]">(root)</span>
                </div>
                
                {/* Folders - recursive render */}
                {isExpanded && (
                  <div className="ml-6 border-l border-[var(--border-secondary)]">
                    {renderFolders(project.children, projectId, 0)}
                    
                    {project.children.filter(c => c.type === 'folder').length === 0 && (
                      <div className="px-3 py-2 text-sm text-[var(--text-tertiary)] italic">
                        No folders
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        
        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={closeMoveModal}>
            Cancel
          </Button>
          <Button
            onClick={handleMove}
            disabled={!selectedProjectId || itemsToMove.length === 0 || isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Moving...
              </>
            ) : (
              'Move'
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default MoveItemsModal;
