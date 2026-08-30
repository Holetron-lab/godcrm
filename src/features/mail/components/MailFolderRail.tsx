import {
  Archive,
  Trash2,
  Inbox,
  Send as SendIcon,
  FileText,
  Star,
  Tag,
  Clock,
  ListChecks,
  Plus,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
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
  /** Favorites = starred across the selected folders (view filter). */
  starredOnly: boolean;
  onStarredOnlyChange: (v: boolean) => void;
  /** Collapsed (icons only) vs. expanded (icons + labels). Toolbar hamburger drives it. */
  expanded: boolean;
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

// Icon + Russian label per real folder for the vertical rail.
const FOLDER_META: Record<MailFolderId, { icon: typeof Inbox; label: string }> = {
  inbox: { icon: Inbox, label: 'Входящие' },
  sent: { icon: SendIcon, label: 'Исходящие' },
  drafts: { icon: FileText, label: 'Черновики' },
  archive: { icon: Archive, label: 'Архив' },
  trash: { icon: Trash2, label: 'Корзина' },
};

/**
 * ADR-158 — vertical folder rail down the left edge of the mail module (moved out
 * of the horizontal toolbar). Collapsed by default → icon-only; the toolbar's
 * hamburger expands it to reveal labels. Each folder is a row: icon · label ·
 * unread badge. Clicking a folder selects only it (single select); the
 * multiselect toggle at the bottom (above Favorites) flips clicks to add/remove
 * so the list can merge several folders. Below the divider: Favorites (starred
 * filter) + server labels.
 */
export function MailFolderRail({
  folders,
  selectedFolders,
  onFoldersChange,
  multiSelect,
  onMultiSelectChange,
  starredOnly,
  onStarredOnlyChange,
  expanded,
  labels,
  activeLabelIds,
  onSelectLabel,
  onAddLabel,
  scheduledActive,
  onSelectScheduled,
  scheduledCount,
}: MailFolderRailProps) {
  const selectFolder = (id: MailFolderId) => {
    if (!multiSelect) {
      // Single select — the clicked folder becomes the whole selection.
      onFoldersChange([id]);
      return;
    }
    const has = selectedFolders.includes(id);
    onFoldersChange(has ? selectedFolders.filter((f) => f !== id) : [...selectedFolders, id]);
  };

  const rowClass = (active: boolean) =>
    cn(
      'group relative flex w-full items-center rounded-md py-2 text-sm transition-colors',
      expanded ? 'gap-2.5 px-2.5' : 'justify-center px-0',
      active
        ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
    );

  return (
    <nav
      aria-label="Папки"
      className={cn(
        'flex flex-shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[var(--border-primary)] bg-[var(--bg-primary)] p-2 transition-[width] duration-150',
        expanded ? 'w-48' : 'w-14'
      )}
    >
      {folders.map((f) => {
        const meta = FOLDER_META[f.id];
        if (!meta) return null;
        const Icon = meta.icon;
        const active = selectedFolders.includes(f.id) && !scheduledActive;
        return (
          <button
            key={f.id}
            type="button"
            aria-pressed={active}
            title={expanded ? undefined : meta.label}
            onClick={() => selectFolder(f.id)}
            className={rowClass(active)}
          >
            <Icon size={16} className="flex-shrink-0" />
            {expanded && <span className="flex-1 truncate text-left">{meta.label}</span>}
            {!!f.unread &&
              (expanded ? (
                <span className="min-w-[20px] rounded-full bg-[var(--color-primary-600)] px-1.5 text-center text-[11px] font-semibold leading-5 text-white">
                  {f.unread}
                </span>
              ) : (
                <span className="absolute right-1 top-1 min-w-[15px] rounded-full bg-[var(--color-primary-600)] px-1 text-center text-[9px] font-semibold leading-[15px] text-white">
                  {f.unread > 99 ? '99+' : f.unread}
                </span>
              ))}
          </button>
        );
      })}

      {/* ADR-158 §P6 — "Отложенные" (the outbox queue). Sits directly above the
          Мультивыбор toggle, below the real folders: it's a mutually-exclusive
          view toggle, NOT a folder that participates in the merged multiselect,
          so it reads as its own item rather than one of the selectable folders. */}
      <button
        type="button"
        aria-pressed={scheduledActive}
        title={expanded ? undefined : 'Отложенные'}
        onClick={onSelectScheduled}
        className={rowClass(scheduledActive)}
      >
        <Clock size={16} className="flex-shrink-0" />
        {expanded && <span className="flex-1 truncate text-left">Отложенные</span>}
        {scheduledCount > 0 &&
          (expanded ? (
            <span className="min-w-[20px] rounded-full bg-[var(--color-warning,#eab308)] px-1.5 text-center text-[11px] font-semibold leading-5 text-white">
              {scheduledCount}
            </span>
          ) : (
            <span className="absolute right-1 top-1 min-w-[15px] rounded-full bg-[var(--color-warning,#eab308)] px-1 text-center text-[9px] font-semibold leading-[15px] text-white">
              {scheduledCount > 99 ? '99+' : scheduledCount}
            </span>
          ))}
      </button>

      {/* Mode toggle — off: clicking a folder/label picks only it; on: clicks
          add/remove so the list merges them. Grouped with the folders, directly
          above the divider. */}
      <button
        type="button"
        aria-pressed={multiSelect}
        title={expanded ? undefined : multiSelect ? 'Мультивыбор: вкл' : 'Мультивыбор папок и ярлыков'}
        onClick={() => onMultiSelectChange(!multiSelect)}
        className={rowClass(multiSelect)}
      >
        <ListChecks size={16} className="flex-shrink-0" />
        {expanded && <span className="flex-1 truncate text-left">Мультивыбор</span>}
      </button>

      <div className="my-1 h-px bg-[var(--border-primary)]" aria-hidden="true" />

      {/* Favorites — starred across the selected folders (view filter). */}
      <button
        type="button"
        aria-pressed={starredOnly}
        title={expanded ? undefined : 'Избранные'}
        onClick={() => onStarredOnlyChange(!starredOnly)}
        className={rowClass(starredOnly)}
      >
        <Star
          size={16}
          className={cn('flex-shrink-0', starredOnly && 'fill-current text-[var(--color-warning,#eab308)]')}
        />
        {expanded && <span className="flex-1 truncate text-left">Избранные</span>}
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
            {!!label.messageCount &&
              (expanded ? (
                <span className="min-w-[20px] rounded-full bg-[var(--bg-tertiary)] px-1.5 text-center text-[11px] font-semibold leading-5 text-[var(--text-secondary)]">
                  {label.messageCount}
                </span>
              ) : (
                <span className="absolute right-1 top-1 min-w-[15px] rounded-full bg-[var(--bg-tertiary)] px-1 text-center text-[9px] font-semibold leading-[15px] text-[var(--text-secondary)]">
                  {label.messageCount > 99 ? '99+' : label.messageCount}
                </span>
              ))}
          </button>
        );
      })}

      {/* Add a label — jumps to Settings → Ярлыки on a fresh draft. */}
      <button
        type="button"
        title="Новый ярлык"
        onClick={onAddLabel}
        className={cn(rowClass(false), 'text-[var(--text-tertiary)]')}
      >
        <Plus size={16} className="flex-shrink-0" />
        {expanded && <span className="flex-1 truncate text-left">Новый ярлык</span>}
      </button>
    </nav>
  );
}
