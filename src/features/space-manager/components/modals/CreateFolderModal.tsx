/**
 * CreateFolderModal - Modal for creating a new folder
 */

import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/components/ui/Modal';
import { Input } from '@/shared/components/ui/Input';
import { Button } from '@/shared/components/ui/Button';
import { useSpaceManagerStore, parseItemId } from '../../store/spaceManagerStore';
import { spaceManagerApi } from '../../api/spaceManagerApi';
import type { TreeNode } from '../../types/space-manager.types';
import { toast } from 'react-hot-toast';
import { Folder, Loader2 } from 'lucide-react';

interface CreateFolderModalProps {
  spaceId: number;
  tree: TreeNode[];
  onSuccess: () => void;
}

const FOLDER_ICONS = ['📁', '📂', '🗂️', '📋', '📑', '📊', '📈', '📉', '🗃️', '📦'];

export const CreateFolderModal = ({ spaceId, tree, onSuccess }: CreateFolderModalProps) => {
  const queryClient = useQueryClient();
  const { 
    createFolderModalOpen, 
    createFolderParentId,
    closeCreateFolderModal,
    focusedItem
  } = useSpaceManagerStore();
  
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📁');
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  
  // Get projects from tree
  const projects = useMemo(() => {
    return tree.filter(n => n.type === 'project');
  }, [tree]);
  
  // Auto-select project from focused item
  useMemo(() => {
    if (focusedItem && !selectedProjectId) {
      const { type, numericId } = parseItemId(focusedItem);
      if (type === 'project') {
        setSelectedProjectId(numericId);
      } else {
        // Find parent project
        const findProject = (nodes: TreeNode[], targetId: string): number | null => {
          for (const node of nodes) {
            if (node.type === 'project') {
              const hasTarget = (children: TreeNode[]): boolean => {
                return children.some(c => c.id === targetId || hasTarget(c.children));
              };
              if (hasTarget(node.children)) {
                const { numericId } = parseItemId(node.id);
                return numericId;
              }
            }
          }
          return null;
        };
        const projectId = findProject(tree, focusedItem);
        if (projectId) setSelectedProjectId(projectId);
      }
    }
  }, [focusedItem, selectedProjectId, tree]);
  
  // Create mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProjectId) throw new Error('Select a project');
      if (!name.trim()) throw new Error('Name is required');
      
      return spaceManagerApi.createFolder(selectedProjectId, {
        name: name.trim(),
        icon,
        parent_folder_id: createFolderParentId ?? undefined
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-tree', spaceId] });
      toast.success('Folder created');
      onSuccess();
      handleClose();
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to create folder');
    }
  });
  
  const handleClose = () => {
    setName('');
    setIcon('📁');
    setSelectedProjectId(null);
    closeCreateFolderModal();
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate();
  };
  
  if (!createFolderModalOpen) return null;
  
  return (
    <Modal
      open={createFolderModalOpen}
      onOpenChange={(open) => !open && handleClose()}
      title="Create Folder"
      size="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Project Selection */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
            Project
          </label>
          <select
            value={selectedProjectId ?? ''}
            onChange={(e) => setSelectedProjectId(e.target.value ? parseInt(e.target.value) : null)}
            className="
              w-full px-3 py-2
              bg-[var(--bg-secondary)] border border-[var(--border-primary)]
              rounded-lg text-[var(--text-primary)]
              focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50
            "
          >
            <option value="">Select project...</option>
            {projects.map(project => {
              const { numericId } = parseItemId(project.id);
              return (
                <option key={project.id} value={numericId}>
                  {project.icon} {project.name}
                </option>
              );
            })}
          </select>
        </div>
        
        {/* Icon */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
            Icon
          </label>
          <div className="flex flex-wrap gap-1">
            {FOLDER_ICONS.map(emoji => (
              <button
                key={emoji}
                type="button"
                onClick={() => setIcon(emoji)}
                className={`
                  p-2 text-xl rounded-lg transition-colors
                  ${icon === emoji 
                    ? 'bg-[var(--accent-primary)]/20 ring-2 ring-[var(--accent-primary)]' 
                    : 'hover:bg-[var(--bg-secondary)]'
                  }
                `}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
        
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
            Name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Folder name"
            autoFocus
          />
        </div>
        
        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!name.trim() || !selectedProjectId || createMutation.isPending}
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Creating...
              </>
            ) : (
              <>
                <Folder className="w-4 h-4 mr-2" />
                Create
              </>
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default CreateFolderModal;
