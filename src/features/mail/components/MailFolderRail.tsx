import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  Trash2,
  Inbox,
  Send as SendIcon,
  FileText,
  Folder,
  FolderPlus,
  Pencil,
  Check,
  X,
  Star,
  Tag,
  Clock,
  Layers,
  ListChecks,
  Plus,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useLanguage, type LanguageContextValue } from '@/shared/i18n/LanguageContext';
import type { MailFolder, MailFolderId, MailLabel } from '../types';

export interface MailFolderRailProps {
  /** Raw folder list (server labels + live unread counts). */
  folders: MailFolder[];
  selectedFolders: MailFolderId[];
  onFoldersChange: (folders: MailFolderId[]) => void;
  /**
   * Folder + label picking mode. Off (default) → clicking a folder (or label)
   * selects only it (single select). On → clicking toggles it in/out of the
   * merged multiselect. The toggle sits with the folders, just above the divider.
   */
  multiSelect: boolean;
  onMultiSelectChange: (v: boolean) => void;
  /** Group the list into conversation threads (sits under Мультивыбор). */
  threads: boolean;
  onThreadsChange: (v: boolean) => void;
  /** Favorites = starred across the selected folders (view filter). */
  starredOnly: boolean;
  onStarredOnlyChange: (v: boolean) => void;
  /** Collapsed (icons only) vs. expanded (icons + labels). Toolbar hamburger drives it. */
  expanded: boolean;
  /**
   * User folders (Archive, Spam, …): create / rename / delete. Promises so the
   * inline editor closes only once the server accepted; a rejection keeps it
   * open with `folderError` under it.
   */
  onCreateFolder: (name: string) => Promise<unknown>;
  onRenameFolder: (id: MailFolderId, name: string) => Promise<unknown>;
  onDeleteFolder: (id: MailFolderId) => Promise<unknown>;
  folderError: string | null;
  /** ADR-158 §P4 — server-backed labels (rail rows + per-label message counts). */
  labels: MailLabel[];
  /** Active label "virtual folders" (`?label=`); empty when viewing real folders. */
  activeLabelIds: number[];
  /**
   * Toggle a label view. With multiSelect off the clicked label becomes the
   * whole label view (or clears it); on, it adds/removes from the merged set.
   */
  onSelectLabel: (labelId: number) => void;
  /** Open Settings → Ярлыки on a fresh label draft (the "+" under labels). */
  onAddLabel: () => void;
  /** ADR-158 §P6 — "Отложенные" pseudo-folder (the outbox queue), shown just above the Мультивыбор toggle. */
  scheduledActive: boolean;
  onSelectScheduled: () => void;
  /** Count of queued sends (pending/sending/failed) for the rail badge. */
  scheduledCount: number;
}

// Icon per system folder; the label comes from `mail.folders.*`. User folders
// fall back to a plain folder icon and the server-stored name (`folderLabel`).
const FOLDER_ICONS: Partial<Record<string, typeof Inbox>> = {
  inbox: Inbox,
  sent: SendIcon,
  drafts: FileText,
  archive: Archive,
  trash: Trash2,
};

/** Display name of a folder: user folders carry their own name, system ones are localized here. */
export function folderLabel(f: MailFolder, t: LanguageContextValue['t']): string {
  if (f.system === false) return f.label;
  return FOLDER_ICONS[f.id] ? t(`mail.folders.${f.id}`) : f.label;
}

const ICON_BTN =
  'rounded p-1 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]';

/** Inline name editor for a user folder (rename) or a new one (`onDelete` absent). */
function FolderNameEditor({
  initial,
  onSave,
  onCancel,
  onDelete,
}: {
  initial: string;
  onSave: (name: string) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const { t } = useLanguage();
  const [value, setValue] = useState(initial);
  // The editor replaces the row the user just clicked — focus follows that click.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <form
      className="flex items-center gap-0.5 py-1 pl-1.5 pr-1"
      onSubmit={(e) => {
        e.preventDefault();
        const name = value.trim();
        if (name) onSave(name);
      }}
    >
      <input
        ref={inputRef}
        aria-label={t('mail.rail.folderName')}
        placeholder={t('mail.rail.folderName')}
        value={value}
        maxLength={40}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
        className="min-w-0 flex-1 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-1.5 py-1 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--color-primary-500)]"
      />
      <button type="submit" aria-label={t('mail.common.save')} title={t('mail.common.save')} className={ICON_BTN}>
        <Check size={14} />
      </button>
      {onDelete && (
        <button
          type="button"
          aria-label={t('mail.rail.deleteFolder')}
          title={t('mail.rail.deleteFolder')}
          onClick={onDelete}
          className={cn(ICON_BTN, 'hover:text-[var(--color-danger,#ef4444)]')}
        >
          <Trash2 size={14} />
        </button>
      )}
      <button type="button" aria-label={t('mail.common.cancel')} title={t('mail.common.cancel')} onClick={onCancel} className={ICON_BTN}>
        <X size={14} />
      </button>
    </form>
  );
}

/**
 * ADR-158 — vertical folder rail down the left edge of the mail module (moved out
 * of the horizontal toolbar). Collapsed by default → icon-only; the toolbar's
 * hamburger expands it to reveal labels. Each folder is a row: icon · label ·
 * unread badge. Clicking a folder selects only it (single select); the
 * multiselect toggle at the bottom (above Favorites) flips clicks to add/remove
 * so the list can merge several folders. User folders (Archive, Spam, …) get a
 * rename pencil when expanded; "Новая папка" adds one. Below the divider:
 * Favorites (starred filter) + server labels.
 */
export function MailFolderRail({
  folders,
  selectedFolders,
  onFoldersChange,
  multiSelect,
  onMultiSelectChange,
  threads,
  onThreadsChange,
  starredOnly,
  onStarredOnlyChange,
  expanded,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  folderError,
  labels,
  activeLabelIds,
  onSelectLabel,
  onAddLabel,
  scheduledActive,
  onSelectScheduled,
  scheduledCount,
}: MailFolderRailProps) {
  const { t } = useLanguage();
  // Which folder is being renamed (`id`) or whether a new one is being named (`null`).
  const [editing, setEditing] = useState<{ id: MailFolderId | null; initial: string } | null>(null);

  const selectFolder = (id: MailFolderId) => {
    if (!multiSelect) {
      // Single select — the clicked folder becomes the whole selection.
      onFoldersChange([id]);
      return;
    }
    const has = selectedFolders.includes(id);
    onFoldersChange(has ? selectedFolders.filter((f) => f !== id) : [...selectedFolders, id]);
  };

  // A rejected promise keeps the editor open; `folderError` (from the parent's
  // mutation state) renders under it.
  const saveFolder = async (name: string) => {
    if (!editing) return;
    try {
      if (editing.id === null) await onCreateFolder(name);
      else await onRenameFolder(editing.id, name);
      setEditing(null);
    } catch {
      /* shown via folderError */
    }
  };
  const deleteFolder = async () => {
    if (!editing || editing.id === null) return;
    // ponytail: native confirm for a destructive, rarely-used action.
    if (!window.confirm(t('mail.rail.deleteFolderConfirm', { name: editing.initial }))) return;
    try {
      await onDeleteFolder(editing.id);
      setEditing(null);
    } catch {
      /* shown via folderError */
    }
  };

  const rowBase = (active: boolean) =>
    cn(
      'group relative flex w-full items-center rounded-md text-sm transition-colors',
      active
        ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
    );
  const rowClass = (active: boolean) =>
    cn(rowBase(active), 'py-2', expanded ? 'gap-2.5 px-2.5' : 'justify-center px-0');

  const badge = (count: number, tone: 'primary' | 'warning' | 'muted') => {
    const color =
      tone === 'primary'
        ? 'bg-[var(--color-primary-600)] text-white'
        : tone === 'warning'
          ? 'bg-[var(--color-warning,#eab308)] text-white'
          : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]';
    return expanded ? (
      <span className={cn('min-w-[20px] rounded-full px-1.5 text-center text-[11px] font-semibold leading-5', color)}>
        {count}
      </span>
    ) : (
      <span
        className={cn(
          'absolute right-1 top-1 min-w-[15px] rounded-full px-1 text-center text-[9px] font-semibold leading-[15px]',
          color
        )}
      >
        {count > 99 ? '99+' : count}
      </span>
    );
  };

  return (
    <nav
      aria-label={t('mail.toolbar.folders')}
      className={cn(
        'flex flex-shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[var(--border-primary)] bg-[var(--bg-primary)] p-2 transition-[width] duration-150',
        expanded ? 'max-h-[40dvh] w-full md:max-h-none md:w-48' : 'hidden md:flex md:w-14'
      )}
    >
      {folders.map((f) => {
        const Icon = FOLDER_ICONS[f.id] ?? Folder;
        const label = folderLabel(f, t);
        const active = selectedFolders.includes(f.id) && !scheduledActive;
        const editable = f.system === false;
        if (editing?.id === f.id) {
          return (
            <FolderNameEditor
              key={f.id}
              initial={editing.initial}
              onSave={saveFolder}
              onCancel={() => setEditing(null)}
              onDelete={deleteFolder}
            />
          );
        }
        return (
          <div key={f.id} className={rowBase(active)}>
            <button
              type="button"
              aria-pressed={active}
              title={expanded ? undefined : label}
              onClick={() => selectFolder(f.id)}
              className={cn(
                'flex min-w-0 flex-1 items-center py-2',
                expanded ? 'gap-2.5 pl-2.5 pr-1' : 'justify-center px-0'
              )}
            >
              <Icon size={16} className="flex-shrink-0" />
              {expanded && <span className="flex-1 truncate text-left">{label}</span>}
              {!!f.unread && badge(f.unread, 'primary')}
            </button>
            {expanded && editable && (
              <button
                type="button"
                aria-label={t('mail.rail.renameFolder', { name: label })}
                title={t('mail.common.rename')}
                onClick={() => setEditing({ id: f.id, initial: label })}
                className={cn(ICON_BTN, 'mr-1 opacity-0 focus-visible:opacity-100 group-hover:opacity-100')}
              >
                <Pencil size={12} />
              </button>
            )}
          </div>
        );
      })}

      {/* New user folder — inline name editor (expanded rail only; collapsed has no room to type). */}
      {expanded &&
        (editing?.id === null ? (
          <FolderNameEditor initial="" onSave={saveFolder} onCancel={() => setEditing(null)} />
        ) : (
          <button
            type="button"
            title={t('mail.rail.newFolder')}
            onClick={() => setEditing({ id: null, initial: '' })}
            className={cn(rowClass(false), 'text-[var(--text-tertiary)]')}
          >
            <FolderPlus size={16} className="flex-shrink-0" />
            <span className="flex-1 truncate text-left">{t('mail.rail.newFolder')}</span>
          </button>
        ))}
      {editing && folderError && (
        <p role="alert" className="px-2 text-[11px] text-[var(--color-danger,#ef4444)]">
          {folderError}
        </p>
      )}

      {/* ADR-158 §P6 — "Отложенные" (the outbox queue). Sits directly above the
          Мультивыбор toggle, below the real folders: it's a mutually-exclusive
          view toggle, NOT a folder that participates in the merged multiselect,
          so it reads as its own item rather than one of the selectable folders. */}
      <button
        type="button"
        aria-pressed={scheduledActive}
        title={expanded ? undefined : t('mail.rail.scheduled')}
        onClick={onSelectScheduled}
        className={rowClass(scheduledActive)}
      >
        <Clock size={16} className="flex-shrink-0" />
        {expanded && <span className="flex-1 truncate text-left">{t('mail.rail.scheduled')}</span>}
        {scheduledCount > 0 && badge(scheduledCount, 'warning')}
      </button>

      {/* Mode toggle — off: clicking a folder/label picks only it; on: clicks
          add/remove so the list merges them. Grouped with the folders, directly
          above the divider. */}
      <button
        type="button"
        aria-pressed={multiSelect}
        title={expanded ? undefined : multiSelect ? t('mail.rail.multiSelectOn') : t('mail.rail.multiSelectHint')}
        onClick={() => onMultiSelectChange(!multiSelect)}
        className={rowClass(multiSelect)}
      >
        <ListChecks size={16} className="flex-shrink-0" />
        {expanded && <span className="flex-1 truncate text-left">{t('mail.rail.multiSelect')}</span>}
      </button>

      {/* Threads — group the list into conversations (same subject + counterpart). */}
      <button
        type="button"
        aria-pressed={threads}
        title={expanded ? undefined : threads ? t('mail.rail.threadsOn') : t('mail.rail.threadsHint')}
        onClick={() => onThreadsChange(!threads)}
        className={rowClass(threads)}
      >
        <Layers size={16} className="flex-shrink-0" />
        {expanded && <span className="flex-1 truncate text-left">{t('mail.rail.threads')}</span>}
      </button>

      <div className="my-1 h-px bg-[var(--border-primary)]" aria-hidden="true" />

      {/* Favorites — starred across the selected folders (view filter). */}
      <button
        type="button"
        aria-pressed={starredOnly}
        title={expanded ? undefined : t('mail.rail.starred')}
        onClick={() => onStarredOnlyChange(!starredOnly)}
        className={rowClass(starredOnly)}
      >
        <Star
          size={16}
          className={cn('flex-shrink-0', starredOnly && 'fill-current text-[var(--color-warning,#eab308)]')}
        />
        {expanded && <span className="flex-1 truncate text-left">{t('mail.rail.starred')}</span>}
      </button>

      {/* ADR-158 §P4 — server-backed labels. Clicking one opens its virtual
          folder (`?label=`, across every real folder); the count is the total
          tagged, not unread. Rules/toolbar visibility are edited in the manager. */}
      {labels.map((label) => {
        const active = activeLabelIds.includes(label.id);
        const tint = label.color ?? undefined;
        return (
          <button
            key={label.id}
            type="button"
            aria-pressed={active}
            title={expanded ? undefined : label.name}
            onClick={() => onSelectLabel(label.id)}
            className={rowClass(active)}
          >
            <Tag size={16} className="flex-shrink-0" style={tint ? { color: tint } : undefined} />
            {expanded && <span className="flex-1 truncate text-left">{label.name}</span>}
            {!!label.messageCount && badge(label.messageCount, 'muted')}
          </button>
        );
      })}

      {/* Add a label — jumps to Settings → Ярлыки on a fresh draft. */}
      <button
        type="button"
        title={t('mail.rail.newLabel')}
        onClick={onAddLabel}
        className={cn(rowClass(false), 'text-[var(--text-tertiary)]')}
      >
        <Plus size={16} className="flex-shrink-0" />
        {expanded && <span className="flex-1 truncate text-left">{t('mail.rail.newLabel')}</span>}
      </button>
    </nav>
  );
}
