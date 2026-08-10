import { useState } from 'react';
import { FOLDER_EMOJIS } from './utils';
import type { WidgetFolder } from './types';

// ============================================================================
// Inline Create Folder Form (accordion style)
// ============================================================================
interface InlineCreateFolderProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, icon?: string) => void;
}

export function InlineCreateFolder({ isOpen, onClose, onCreate }: InlineCreateFolderProps) {
  const [name, setName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState<string>('📁');
  const [customEmoji, setCustomEmoji] = useState('');

  const handleSubmit = () => {
    if (name.trim()) {
      onCreate(name.trim(), customEmoji.trim() || selectedIcon || undefined);
      setName('');
      setSelectedIcon('📁');
      setCustomEmoji('');
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  // Current displayed emoji (custom or selected from grid)
  const displayedEmoji = customEmoji || selectedIcon;

  return (
    <div className="px-2 py-1.5 space-y-1.5 border-t border-[var(--border-secondary)] bg-[var(--bg-tertiary)]/50">
      {/* Emoji input + Name input in one row */}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={displayedEmoji}
          onChange={(e) => {
            const val = e.target.value;
            setCustomEmoji(val);
            if (!val) setSelectedIcon('📁');
          }}
          onKeyDown={handleKeyDown}
          placeholder="📁"
          className="w-7 h-7 text-center text-sm rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)] flex-shrink-0"
          title="Emoji icon"
        />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Folder name..."
          className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
          autoFocus
        />
      </div>

      {/* Emoji grid - centered, full width */}
      <div className="flex justify-center">
        <div className="grid grid-cols-8 gap-0.5">
          {FOLDER_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                setSelectedIcon(emoji);
                setCustomEmoji('');
              }}
              className={`w-5 h-5 flex items-center justify-center text-xs rounded hover:bg-[var(--bg-tertiary)] transition-colors ${
                selectedIcon === emoji && !customEmoji ? 'bg-[var(--color-primary-500)]/30 ring-1 ring-[var(--color-primary-500)]' : ''
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Buttons */}
      <div className="flex gap-1 justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-2 py-0.5 text-[10px] rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] transition"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!name.trim()}
          className="px-2 py-0.5 text-[10px] rounded bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)] transition disabled:opacity-50"
        >
          Create
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Inline Edit Folder Component (accordion style)
// ============================================================================
interface InlineEditFolderProps {
  folder: WidgetFolder;
  onClose: () => void;
  onSave: (folderId: string, name: string, icon?: string) => void;
  onDelete: (folderId: string) => void;
}

export function InlineEditFolder({ folder, onClose, onSave, onDelete }: InlineEditFolderProps) {
  const [name, setName] = useState(folder.name);
  const [selectedIcon, setSelectedIcon] = useState<string>(folder.icon || '📁');
  const [customEmoji, setCustomEmoji] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const displayedEmoji = customEmoji || selectedIcon;

  const handleSubmit = () => {
    if (name.trim()) {
      onSave(folder.id, name.trim(), customEmoji.trim() || selectedIcon || undefined);
      onClose();
    }
  };

  const handleDelete = () => {
    onDelete(folder.id);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (showDeleteConfirm) {
    return (
      <div className="ml-5 px-2 py-1.5 space-y-1.5 border-t border-[var(--border-secondary)] bg-[var(--bg-tertiary)]/50">
        <p className="text-[10px] text-[var(--text-secondary)]">
          Delete "{folder.name}"? {folder.items.length > 0 && (
            <span className="text-amber-500">
              ({folder.items.length} widgets → root)
            </span>
          )}
        </p>
        <div className="flex gap-1 justify-end">
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(false)}
            className="px-2 py-0.5 text-[10px] rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="px-2 py-0.5 text-[10px] rounded bg-red-500 text-white hover:bg-red-600 transition"
          >
            Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ml-5 px-2 py-1.5 space-y-1.5 border-t border-[var(--border-secondary)] bg-[var(--bg-tertiary)]/50">
      {/* Emoji input + Name input in one row */}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={displayedEmoji}
          onChange={(e) => {
            const val = e.target.value;
            setCustomEmoji(val);
            if (!val) setSelectedIcon(folder.icon || '📁');
          }}
          onKeyDown={handleKeyDown}
          placeholder="📁"
          className="w-7 h-7 text-center text-sm rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)] flex-shrink-0"
          title="Emoji icon"
        />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Folder name..."
          className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
          autoFocus
        />
      </div>

      {/* Emoji grid - centered */}
      <div className="flex justify-center">
        <div className="grid grid-cols-8 gap-0.5">
          {FOLDER_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                setSelectedIcon(emoji);
                setCustomEmoji('');
              }}
              className={`w-5 h-5 flex items-center justify-center text-xs rounded hover:bg-[var(--bg-tertiary)] transition-colors ${
                selectedIcon === emoji && !customEmoji ? 'bg-[var(--color-primary-500)]/30 ring-1 ring-[var(--color-primary-500)]' : ''
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Buttons */}
      <div className="flex gap-1 justify-between">
        <button
          type="button"
          onClick={() => setShowDeleteConfirm(true)}
          className="px-2 py-0.5 text-[10px] rounded text-red-500 hover:bg-red-500/10 transition"
        >
          Delete
        </button>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-0.5 text-[10px] rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="px-2 py-0.5 text-[10px] rounded bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)] transition disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
