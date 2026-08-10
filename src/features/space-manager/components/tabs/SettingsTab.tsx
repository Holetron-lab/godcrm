/**
 * SettingsTab - Space settings with Access Control
 */

import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/shared/components/ui/Input';
import { Button } from '@/shared/components/ui/Button';
import { spacesApi } from '@/features/spaces/api/spacesApi';
import { useSpacesStore, useSpaces } from '@/features/spaces/store/spacesStore';
import { useSpacesQuery } from '@/features/spaces/hooks/useSpacesQuery';
import { useSpacesOrder } from '@/features/spaces/hooks/useSpacesOrder';
import { UserAccessPanel } from '@/shared/components/access/UserAccessPanel';
import type { UserAccessLevel } from '@/shared/types/user-access.types';
import { toast } from 'react-hot-toast';
import { Loader2, Save, ArrowUpDown, Trash2 } from 'lucide-react';

interface SettingsTabProps {
  spaceId: number;
  onDeleteSpace?: () => void;
}

const SPACE_ICONS = [
  '📁', '💼', '🏢', '🚀', '⚡', '🎯', '🌟', '💡', '🔥', '🎨', '📊', '🛠️',
  '⭐', '✨', '🎭', '🎪', '🎬', '🎮', '🎲', '🎰', '🃏', '🎴', '🀄', '🎖️',
  '🏆', '🏅', '🥇', '🥈', '🥉', '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐',
];

export const SettingsTab = ({ spaceId, onDeleteSpace }: SettingsTabProps) => {
  const queryClient = useQueryClient();
  const { currentSpace, updateSpace: updateStoreSpace } = useSpacesStore();
  const { data: spaces = [] } = useSpacesQuery();
  const space = spaces.find(s => s.id === spaceId);
  
  // Current user's access level
  const currentUserLevel: UserAccessLevel = 'owner_owner';
  
  // General settings
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('📁');
  const [showIconPicker, setShowIconPicker] = useState(false);
  
  // Load current values
  useEffect(() => {
    if (currentSpace) {
      setName(currentSpace.name || '');
      setDescription(currentSpace.description || '');
      setIcon(currentSpace.icon || '📁');
    }
  }, [currentSpace, space?.id]);
  
  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async () => {
      return spacesApi.update(spaceId, {
        name: name.trim(),
        description: description.trim() || null,
        icon
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
      queryClient.invalidateQueries({ queryKey: ['space', spaceId] });
      updateStoreSpace(spaceId, { name, description, icon });
      toast.success('Space updated');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update space');
    }
  });
  
  const handleSave = () => {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    updateMutation.mutate();
  };
  
  return (
    <div className="flex justify-center px-4">
      <div className="w-full max-w-xl space-y-4">
      {/* General Settings */}
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className="relative">
          <button
            onClick={() => setShowIconPicker(!showIconPicker)}
            className="text-3xl hover:bg-[var(--bg-tertiary)] rounded-lg p-2 transition-colors"
            title="Click to change icon"
          >
            {icon}
          </button>
          
          {showIconPicker && (
            <div className="absolute top-full left-0 mt-1 p-2 z-10 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl grid grid-cols-8 gap-1 max-h-40 overflow-y-auto w-64">
              {SPACE_ICONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    setIcon(emoji);
                    setShowIconPicker(false);
                  }}
                  className={`
                    p-1.5 text-lg rounded hover:bg-[var(--bg-secondary)] transition-colors
                    ${icon === emoji ? 'bg-[var(--accent-primary)]/20 ring-1 ring-[var(--accent-primary)]' : ''}
                  `}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
        
        {/* Name + Description */}
        <div className="flex-1 space-y-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Space name"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description..."
            rows={2}
            className="w-full px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]/50 resize-none"
          />
        </div>
      </div>
      
      {/* Access Control Section */}
      <UserAccessPanel
        entityType="space"
        entityId={spaceId}
        spaceId={spaceId}
        currentUserLevel={currentUserLevel}
      />
      
      {/* Personalization Section */}
      <PersonalizationSection spaceId={spaceId} />
      
      {/* Danger Zone */}
      {onDeleteSpace && (
        <div className="border border-red-500/30 rounded-lg p-4 bg-red-500/5">
          <h4 className="text-sm font-medium text-red-400 mb-2">Danger Zone</h4>
          <p className="text-xs text-[var(--text-tertiary)] mb-3">
            Deleting a space will remove all its projects, tables, and widgets. This action cannot be undone.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDeleteSpace}
            className="text-red-500 hover:bg-red-500/10 gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete Space
          </Button>
        </div>
      )}
      
      {/* Save Button - at bottom right */}
      <div className="pt-3 border-t border-[var(--border-primary)] flex justify-end">
        <Button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          size="sm"
          className="gap-1.5"
        >
          {updateMutation.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          Save Changes
        </Button>
      </div>
      </div>
    </div>
  );
};

/**
 * Personalization Section Component
 * Allows setting order for spaces in sidebar
 */
interface PersonalizationSectionProps {
  spaceId: number;
}

const PersonalizationSection = ({ spaceId }: PersonalizationSectionProps) => {
  const spaces = useSpaces();
  const { data: spacesData = [] } = useSpacesQuery();
  const { spacesOrder, getSpaceOrder, updateSpaceOrder, isUpdating } = useSpacesOrder();
  
  // Find current space to get type
  const space = spacesData.find(s => s.id === spaceId);
  const spaceType = space?.type || 'business';
  
  // Local order state for this space
  const currentOrder = getSpaceOrder(spaceId, spaceType);
  const [orderInput, setOrderInput] = useState(currentOrder.toString());
  const [showHelp, setShowHelp] = useState(false);
  
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
  
  // Get all spaces with their orders for the help section
  const spacesWithOrder = useMemo(() => {
    return spaces
      .map(s => ({
        id: s.id,
        name: s.name,
        icon: s.icon || '📁',
        type: s.type,
        order: getSpaceOrder(s.id, s.type)
      }))
      .sort((a, b) => a.order - b.order);
  }, [spaces, spacesOrder, getSpaceOrder]);
  
  // Check if this is a fixed space (personal or admin)
  const isFixed = spaceType === 'personal' || spaceType === 'admin';
  
  return (
    <div className="border border-[var(--border-primary)] rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 p-3 bg-[var(--bg-secondary)]">
        <ArrowUpDown className="w-4 h-4 text-[var(--accent-primary)]" />
        <span className="text-sm font-medium text-[var(--text-primary)]">Sidebar Order</span>
      </div>
      
      <div className="p-3 space-y-3 border-t border-[var(--border-primary)]">
        <div className="flex items-center justify-between">
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
              className={`w-20 px-3 py-1.5 text-center text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]/20 ${
                isFixed ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            />
            <span className="text-xs text-[var(--text-tertiary)]">
              Lower number = higher in list
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowHelp(!showHelp)}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition text-xs"
          >
            {showHelp ? 'Hide' : 'Show all'}
          </button>
        </div>
        
        {isFixed && (
          <p className="text-xs text-[var(--text-tertiary)]">
            {spaceType === 'personal' 
              ? '🏠 Personal Space is always first (order: 1)' 
              : '⚙️ Admin Space is always last (order: 99)'}
          </p>
        )}
        
        {showHelp && (
          <div className="space-y-1 mt-2 p-2 bg-[var(--bg-tertiary)] rounded-lg max-h-32 overflow-y-auto">
            {spacesWithOrder.map((s) => (
              <div 
                key={s.id}
                className={`flex items-center justify-between px-2 py-1 rounded text-xs ${
                  s.id === spaceId 
                    ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]' 
                    : 'text-[var(--text-secondary)]'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span>{s.icon}</span>
                  <span className="truncate max-w-[120px]">{s.name}</span>
                </div>
                <span className="font-mono">{s.order}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsTab;
