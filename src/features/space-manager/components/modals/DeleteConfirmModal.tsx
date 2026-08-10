/**
 * DeleteConfirmModal - Confirm deletion of items with safety input
 */

import { logger } from '@/shared/utils/logger';
import { useMemo, useState, useEffect } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui/Button';
import { Input } from '@/shared/components/ui/Input';
import { useSpaceManagerStore, parseItemId } from '../../store/spaceManagerStore';
import { useBatchOperations } from '../../hooks/useBatchOperations';
import type { TreeNode } from '../../types/space-manager.types';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';

// Random words for delete confirmation
const RANDOM_WORDS = [
  'chaos', 'doom', 'nuke', 'boom', 'wipe', 'burn', 'gone', 'poof', 'zap', 'bye',
  'yolo', 'yeet', 'rip', 'dead', 'end', 'void', 'null', 'zero', 'dust', 'ash',
  'fire', 'rage', 'fury', 'pain', 'loss', 'fail', 'drop', 'kill', 'smash', 'crash',
  'blast', 'torch', 'erase', 'purge', 'clear', 'clean', 'sweep', 'flush', 'drain', 'empty',
  'trash', 'junk', 'scrap', 'waste', 'dump', 'toss', 'chuck', 'ditch', 'axe', 'cut',
  'slice', 'chop', 'hack', 'raze', 'wreck', 'break', 'crush', 'grind', 'shred', 'tear',
  'rip', 'snap', 'crack', 'split', 'burst', 'pop', 'bang', 'kaboom', 'splat', 'thud',
  'oops', 'damn', 'crap', 'dang', 'yikes', 'sheesh', 'bruh', 'oof', 'meh', 'blah',
  'chaos', 'havoc', 'mayhem', 'panic', 'alarm', 'crisis', 'danger', 'peril', 'risk', 'threat',
  'final', 'last', 'omega', 'ultra', 'mega', 'super', 'hyper', 'turbo', 'max', 'extreme',
  'wild', 'crazy', 'insane', 'mad', 'nuts', 'bonkers', 'wacky', 'silly', 'goofy', 'weird',
  'epic', 'legendary', 'mythic', 'rare', 'unique', 'special', 'magic', 'cosmic', 'galactic', 'stellar',
  'atomic', 'nuclear', 'plasma', 'quantum', 'cyber', 'digital', 'virtual', 'pixel', 'binary', 'code',
  'savage', 'brutal', 'fierce', 'deadly', 'lethal', 'fatal', 'mortal', 'doom', 'grave', 'dark',
  'shadow', 'night', 'black', 'void', 'abyss', 'deep', 'lost', 'gone', 'fade', 'vanish',
  'panda', 'ninja', 'pirate', 'robot', 'zombie', 'ghost', 'dragon', 'phoenix', 'tiger', 'wolf',
  'storm', 'thunder', 'lightning', 'tornado', 'hurricane', 'tsunami', 'quake', 'volcano', 'meteor', 'comet',
  'blaze', 'inferno', 'ember', 'spark', 'flame', 'scorch', 'sear', 'char', 'crisp', 'roast',
  'frozen', 'arctic', 'glacial', 'icy', 'cold', 'chill', 'frost', 'snow', 'blizzard', 'polar',
  'venom', 'toxic', 'poison', 'acid', 'corrosive', 'caustic', 'noxious', 'viral', 'plague', 'blight'
];

interface DeleteConfirmModalProps {
  spaceId: number;
  onSuccess: () => void;
}

export const DeleteConfirmModal = ({ spaceId, onSuccess }: DeleteConfirmModalProps) => {
  const { 
    deleteConfirmOpen, 
    deleteConfirmItems, 
    closeDeleteConfirm,
    tree
  } = useSpaceManagerStore();
  
  const { deleteItems, isLoading } = useBatchOperations(spaceId);
  const [confirmInput, setConfirmInput] = useState('');
  const [randomWord, setRandomWord] = useState('');
  
  // Generate random word when modal opens
  useEffect(() => {
    if (deleteConfirmOpen) {
      const word = RANDOM_WORDS[Math.floor(Math.random() * RANDOM_WORDS.length)];
      setRandomWord(word);
      setConfirmInput('');
    }
  }, [deleteConfirmOpen]);
  
  // Find nodes by IDs
  const itemsToDelete = useMemo(() => {
    const findNode = (nodes: TreeNode[], id: string): TreeNode | null => {
      for (const node of nodes) {
        if (node.id === id) return node;
        const found = findNode(node.children, id);
        if (found) return found;
      }
      return null;
    };
    
    return deleteConfirmItems
      .map(id => findNode(tree, id))
      .filter((n): n is TreeNode => n !== null);
  }, [deleteConfirmItems, tree]);
  
  // Group by type
  const groupedItems = useMemo(() => {
    const groups: Record<string, TreeNode[]> = {};
    itemsToDelete.forEach(item => {
      if (!groups[item.type]) groups[item.type] = [];
      groups[item.type].push(item);
    });
    return groups;
  }, [itemsToDelete]);
  
  // Check if has projects (warning)
  const hasProjects = useMemo(() => {
    return itemsToDelete.some(i => i.type === 'project');
  }, [itemsToDelete]);
  
  // Expected confirmation text
  const expectedText = `delete ${itemsToDelete.length} ${randomWord} items`;
  const canDelete = confirmInput.toLowerCase().trim() === expectedText;
  
  const handleDelete = async () => {
    if (!canDelete) return;
    try {
      await deleteItems(deleteConfirmItems);
      onSuccess();
      closeDeleteConfirm();
    } catch (err) {
      logger.error('Delete failed:', err);
    }
  };
  
  const handleClose = () => {
    setConfirmInput('');
    closeDeleteConfirm();
  };
  
  if (!deleteConfirmOpen) return null;
  
  return (
    <Modal
      open={deleteConfirmOpen}
      onOpenChange={(open) => !open && handleClose()}
      title="Delete Items"
      size="sm"
    >
      <div className="space-y-4">
        {/* Warning */}
        <div className={`
          flex items-start gap-3 p-3 rounded-lg
          ${hasProjects ? 'bg-red-500/10' : 'bg-amber-500/10'}
        `}>
          <AlertTriangle className={`
            w-5 h-5 flex-shrink-0 mt-0.5
            ${hasProjects ? 'text-red-500' : 'text-amber-500'}
          `} />
          <div className="text-sm">
            {hasProjects ? (
              <p className="text-red-500 font-medium">
                You are about to delete {itemsToDelete.length} item{itemsToDelete.length > 1 ? 's' : ''} including projects!
                This will permanently delete all tables, widgets, and data within those projects.
              </p>
            ) : (
              <p className="text-[var(--text-secondary)]">
                Are you sure you want to delete {itemsToDelete.length} item{itemsToDelete.length > 1 ? 's' : ''}?
                This action cannot be undone.
              </p>
            )}
          </div>
        </div>
        
        {/* Items List */}
        <div className="max-h-[200px] overflow-y-auto border border-[var(--border-primary)] rounded-lg divide-y divide-[var(--border-secondary)]">
          {Object.entries(groupedItems).map(([type, items]) => (
            <div key={type}>
              <div className="px-3 py-1.5 bg-[var(--bg-secondary)] text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                {type}s ({items.length})
              </div>
              {items.map(item => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 px-3 py-2 overflow-hidden"
                >
                  <span className="text-base flex-shrink-0">{item.icon}</span>
                  <span className="text-sm text-[var(--text-primary)] truncate">{item.name}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        
        {/* Confirmation Input */}
        <div className="space-y-2">
          <p className="text-sm text-[var(--text-secondary)]">
            To confirm, type: <code className="px-1.5 py-0.5 bg-[var(--bg-tertiary)] text-red-400 rounded font-mono text-xs">{expectedText}</code>
          </p>
          <Input
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder="Type the confirmation text..."
            className="font-mono text-sm"
          />
        </div>
        
        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleDelete}
            disabled={isLoading || !canDelete}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4 mr-2" />
                Delete {itemsToDelete.length} item{itemsToDelete.length > 1 ? 's' : ''}
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default DeleteConfirmModal;
