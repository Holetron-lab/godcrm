import { Inbox, Send, FileText, Archive, Trash2, type LucideIcon } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import type { MailFolder, MailFolderId } from '../types';

const ICONS: Record<MailFolderId, LucideIcon> = {
  inbox: Inbox,
  sent: Send,
  drafts: FileText,
  archive: Archive,
  trash: Trash2,
};

interface MailNavProps {
  folders: MailFolder[];
  selected: MailFolderId;
  onSelect: (id: MailFolderId) => void;
}

export function MailNav({ folders, selected, onSelect }: MailNavProps) {
  return (
    <nav aria-label="Mail folders" className="flex flex-col gap-1 p-2">
      {folders.map((folder) => {
        const Icon = ICONS[folder.id];
        const active = folder.id === selected;
        return (
          <button
            key={folder.id}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelect(folder.id)}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-[var(--bg-tertiary)] font-medium text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
            )}
          >
            <Icon size={16} aria-hidden="true" />
            <span className="flex-1 text-left">{folder.label}</span>
            {folder.unread ? (
              <span className="rounded-full bg-[var(--color-primary-600)] px-2 py-0.5 text-xs text-white">
                {folder.unread}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
