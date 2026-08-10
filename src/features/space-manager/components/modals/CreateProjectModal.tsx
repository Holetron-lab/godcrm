/**
 * CreateProjectModal - Modal for creating a new project in space
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/components/ui/Modal';
import { Input } from '@/shared/components/ui/Input';
import { Button } from '@/shared/components/ui/Button';
import { useSpaceManagerStore } from '../../store/spaceManagerStore';
import { apiClient } from '@/shared/utils/apiClient';
import { toast } from 'react-hot-toast';
import { Loader2, Plus } from 'lucide-react';
import { EmojiPicker } from '@/features/tables/components/UniversalTable/EmojiPicker';

interface CreateProjectModalProps {
  spaceId: number;
  onSuccess: () => void;
}

const PROJECT_TYPES = [
  { value: 'data', label: 'Data Project', icon: '📊' },
  { value: 'workflow', label: 'Workflow', icon: '⚡' },
  { value: 'crm', label: 'CRM', icon: '👥' },
  { value: 'other', label: 'Other', icon: '📁' }
];

export const CreateProjectModal = ({ spaceId, onSuccess }: CreateProjectModalProps) => {
  const queryClient = useQueryClient();
  const { createProjectModalOpen, closeCreateProjectModal } = useSpaceManagerStore();
  
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('📊');
  const [type, setType] = useState('data');
  
  // Create mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Name is required');
      
      const response = await apiClient.request<{ data: { id: number } }>('/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          icon,
          type,
          space_id: spaceId
        })
      });
      
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-tree', spaceId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project created');
      onSuccess();
      handleClose();
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to create project');
    }
  });
  
  const handleClose = () => {
    setName('');
    setDescription('');
    setIcon('📊');
    setType('data');
    closeCreateProjectModal();
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate();
  };
  
  if (!createProjectModalOpen) return null;
  
  return (
    <Modal
      open={createProjectModalOpen}
      onOpenChange={(open) => !open && handleClose()}
      title="Create Project"
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Icon */}
        <div>
          <EmojiPicker
            value={icon}
            onChange={setIcon}
            label="Иконка"
            size="md"
          />
        </div>
        
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
            Name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            autoFocus
          />
        </div>
        
        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description..."
            rows={2}
            className="
              w-full px-3 py-2
              bg-[var(--bg-secondary)] border border-[var(--border-primary)]
              rounded-lg text-[var(--text-primary)]
              placeholder:text-[var(--text-tertiary)]
              focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50
              resize-none
            "
          />
        </div>
        
        {/* Type */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
            Type
          </label>
          <div className="grid grid-cols-2 gap-2">
            {PROJECT_TYPES.map(pt => (
              <button
                key={pt.value}
                type="button"
                onClick={() => setType(pt.value)}
                className={`
                  flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left
                  ${type === pt.value
                    ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                    : 'border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]'
                  }
                `}
              >
                <span className="text-lg">{pt.icon}</span>
                <span className="text-sm">{pt.label}</span>
              </button>
            ))}
          </div>
        </div>
        
        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-2" />
                Create Project
              </>
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default CreateProjectModal;
