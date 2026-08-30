import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Modal } from '@/shared/components/ui';
import { AccountSwitcher, useConnectedAccounts, SpaceConnectorsTab } from '@/features/connectors';
import { useCurrentSpace } from '@/features/spaces/store/spacesStore';
import { MailList } from './components/MailList';
import { MailDisplay } from './components/MailDisplay';
import { MailReplyBar, type ComposeMode } from './components/MailReplyBar';
import { MailToolbar } from './components/MailToolbar';
import { MailReadToolbar } from './components/MailReadToolbar';
import { MailLinkBar } from './components/MailLinkBar';
import { MailFolderRail } from './components/MailFolderRail';
import { MailScheduledList } from './components/MailScheduledList';
import { MailSettingsPanel } from './components/MailSettingsPanel';
import { loadMailSettings, saveMailSettings, type MailSettings } from './settings';
import {
  useMailFolders,
  useMailMessagesMulti,
  useMailMessage,
  useSyncMail,
  useUpdateMessage,
  useScheduledMail,
  useCancelScheduled,
} from './hooks/useMail';
import {
  useMailLabels,
  useCreateLabel,
  useTagMessage,
} from './hooks/useMailLabels';
import { useMailLabelColorize } from './labelPrefs';
import { MailLabelBar } from './components/MailLabelBar';
import { MailBulkActions } from './components/MailBulkActions';
import type { MailPatch } from './api/mailApi';
import { useMailHotkeys } from './hooks/useMailHotkeys';
import type { MailFolder, MailFolderId, MailMessage, MailScheduled } from './types';
import './mail.css';

// Resizable list-column bounds (px). Default matches the old fixed w-72 (288px)
// so nothing shifts on first paint.
const LIST_WIDTH_DEFAULT = 288;
const LIST_WIDTH_MIN = 220;
const LIST_WIDTH_MAX = 560;

// Nav skeleton for first paint — the server returns the same list with live unread
// counts once useMailFolders resolves; this just avoids an empty rail on load.
const FALLBACK_FOLDERS: MailFolder[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'sent', label: 'Sent' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'archive', label: 'Archive' },
  { id: 'trash', label: 'Trash' },
];

/**
 * P1 mail shell (ADR-158) wired to the live mail bridge (ADR-160). Three-pane
 * inbox on our own `ui/` kit + design tokens. Selection state is local `useState`;
 * data comes from TanStack Query over `/api/v3/spaces/:id/mail/*`, scoped to the
 * active connected mailbox (account switcher → `connector_id`).
 */
export interface MailPageProps {
  /**
   * Space to scope the mailbox to. Omitted on the standalone `/mail` route
   * (falls back to the active space); the dashboard widget passes its own
   * `space_id` because the `/widgets/:id` route doesn't hydrate the spaces store.
   */
  spaceId?: number;
}

export function MailPage({ spaceId: spaceIdProp }: MailPageProps = {}) {
  const currentSpace = useCurrentSpace();
  const spaceId = spaceIdProp ?? currentSpace?.id;
  const queryClient = useQueryClient();

  // Folder selection defaults to single-select (click a folder → show only it).
  // The rail's "Мультивыбор" toggle flips `folderMultiSelect` on, after which the
  // list merges every selected folder. Defaults to Inbox.
  const [folders, setFolders] = useState<MailFolderId[]>(['inbox']);
  const [folderMultiSelect, setFolderMultiSelect] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Batch-selection set for the row checkboxes (bulk actions await backend
  // endpoints — same follow-up as the disabled Archive/Delete buttons).
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  // View filters (client-side over the loaded page): unread-only, and the
  // "Favorites" pseudo-folder (starred across the selected real folders).
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  // Left folder rail — collapsed (icons only) by default; the toolbar hamburger
  // expands it to reveal labels.
  const [railOpen, setRailOpen] = useState(false);
  // ADR-158 §P4 — active label *filter(s)* layered on the current folder; empty =
  // no label filter. The rail's "Мультивыбор" toggle governs labels too: off →
  // clicking a label sets it as the sole filter (or clears it); on → clicks
  // add/remove and a message passing ANY active label stays in the list.
  const [activeLabelIds, setActiveLabelIds] = useState<number[]>([]);
  // ADR-158 §P6 — "Отложенные" pseudo-folder: the center pane shows the outbox
  // queue instead of a message list. Mutually exclusive with folders/labels.
  const [showScheduled, setShowScheduled] = useState(false);
  // ADR-158 §P6 — the queued send currently open in the composer (edit/reschedule).
  const [editingScheduled, setEditingScheduled] = useState<MailScheduled | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  // Inline composer state: the reading pane's docked composer is a reply by
  // default and flips to forward when the user picks Forward; the "new message"
  // pane (composer only, no thread above it) is a separate surface on the right.
  const [inlineMode, setInlineMode] = useState<ComposeMode>('reply');
  const [newCompose, setNewCompose] = useState(false);
  // Body view-type (rendered HTML vs. raw source), driven by the toolbar selector.
  const [renderHtml, setRenderHtml] = useState(true);

  // ADR-158 §P5 — deep-link from a MailMessageChip: `/mail?msg=<id>&folder=<f>`
  // preselects the message (and its folder) in the reader, then strips the params
  // so a manual reselection isn't overridden and the URL stays clean.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const msg = searchParams.get('msg');
    if (!msg) return;
    const folder = searchParams.get('folder') as MailFolderId | null;
    const VALID: MailFolderId[] = ['inbox', 'sent', 'drafts', 'archive', 'trash'];
    if (folder && VALID.includes(folder)) {
      setShowScheduled(false);
      setActiveLabelIds([]);
      setFolders([folder]);
    }
    setSelectedId(msg);
    const next = new URLSearchParams(searchParams);
    next.delete('msg');
    next.delete('folder');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  // Client-side mail preferences (Gmail-style Settings) + the Settings dialog.
  const [settings, setSettings] = useState<MailSettings>(() => loadMailSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Which tab the Settings surface opens on, and whether to jump straight into a
  // fresh label draft (the rail's "+" under labels sets both).
  const [settingsTab, setSettingsTab] = useState<'general' | 'labels'>('general');
  const [settingsNewLabel, setSettingsNewLabel] = useState(false);
  // Width of the left message-list column, in px. The full-height divider drags
  // this; the reading pane's left edge follows it so the two stay aligned.
  const [listWidth, setListWidth] = useState(LIST_WIDTH_DEFAULT);
  const paneRef = useRef<HTMLDivElement>(null);

  // ADR-159 — active connected account (view concern; server-side default
  // per module instance is a backend follow-up).
  const [activeAccountId, setActiveAccountId] = useState<number | null>(null);
  const { data: accounts } = useConnectedAccounts(spaceId, 'mail');

  // Default to the first connected mailbox once accounts load.
  useEffect(() => {
    if (activeAccountId === null && accounts && accounts.length > 0) {
      setActiveAccountId(accounts[0].id);
    }
  }, [accounts, activeAccountId]);

  // Open the connect surface in place — a full-page nav out of a dashboard
  // widget is jarring and, in the widget route, `spaceId` used to be undefined
  // so the old navigate() silently no-op'd. The modal reuses SpaceConnectorsTab,
  // the same surface as Space settings / EditSpaceModal.
  const openConnect = () => setConnectOpen(true);

  // Persist mail preferences whenever the Settings dialog changes them.
  useEffect(() => {
    saveMailSettings(settings);
  }, [settings]);

  const labelsQuery = useMailLabels(spaceId);
  const createLabel = useCreateLabel(spaceId);
  const tagMessage = useTagMessage(spaceId);
  // Client-side "tint the row" pref per label (edited in Settings → Ярлыки).
  const { colorizeIds } = useMailLabelColorize();

  // One-time migration (ADR-158 §P4): the old client-only "types" become real
  // server labels (manual-only), then the localStorage key is cleared so it never
  // re-imports. Names already present as labels are skipped.
  const importedTypesRef = useRef(false);
  useEffect(() => {
    if (importedTypesRef.current || !Number.isFinite(spaceId) || labelsQuery.isLoading) return;
    let names: string[] = [];
    try {
      const raw = localStorage.getItem('mail.customTypes');
      names = raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      names = [];
    }
    importedTypesRef.current = true;
    if (!names.length) return;
    const existing = new Set((labelsQuery.data ?? []).map((l) => l.name.toLowerCase()));
    const fresh = names.filter((n) => n && !existing.has(n.toLowerCase()));
    void Promise.allSettled(
      fresh.map((name) => createLabel.mutateAsync({ name, rules: { match: 'any', conditions: [] } }))
    ).finally(() => {
      try {
        localStorage.removeItem('mail.customTypes');
      } catch {
        /* storage unavailable — retry on next mount */
      }
    });
  }, [spaceId, labelsQuery.isLoading, labelsQuery.data, createLabel]);

  const foldersQuery = useMailFolders(spaceId, activeAccountId);
  const folderList = foldersQuery.data ?? FALLBACK_FOLDERS;

  // Message source is always the selected real folder(s). Labels are a *filter*
  // layered on top (in the `messages` memo below), not a separate view — clicking
  // a label narrows whatever folder is in view, it does not pull every message
  // with that label across all folders.
  const messagesQuery = useMailMessagesMulti(spaceId, folders, activeAccountId);
  const allMessages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);

  const sync = useSyncMail(spaceId, activeAccountId);

  // ADR-158 §P6 — the outbox queue: powers the rail badge and the "Отложенные"
  // view. Polls so the list drains as the worker sends rows.
  const scheduledQuery = useScheduledMail(spaceId);
  const scheduledItems = scheduledQuery.data ?? [];
  const cancelScheduled = useCancelScheduled(spaceId);

  // Client-side search + view filters over the loaded page (server-side search
  // is a follow-up). Unread-only and Favorites (starred) narrow the list.
  const messages = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allMessages.filter((m) => {
      if (unreadOnly && m.read) return false;
      if (starredOnly && !m.starred) return false;
      // Label filter (ADR-158 §P4) — narrows the current folder like the
      // unread/starred toggles; a message passes if it carries ANY active label.
      if (activeLabelIds.length && !(m.labels ?? []).some((l) => activeLabelIds.includes(l.id))) {
        return false;
      }
      if (q && !`${m.subject} ${m.fromName} ${m.to?.join(' ') ?? ''} ${m.preview}`.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [allMessages, query, unreadOnly, starredOnly, activeLabelIds]);

  // Opening a message fetches the fresh row (and marks it read server-side); fall
  // back to the list row while the detail request is in flight.
  const detailQuery = useMailMessage(spaceId, selectedId);
  const selected = useMemo(
    () => detailQuery.data ?? allMessages.find((m) => m.id === selectedId) ?? null,
    [detailQuery.data, allMessages, selectedId]
  );

  const changeFolders = (next: MailFolderId[]) => {
    // Switching folders leaves the scheduled view but KEEPS any active label
    // filter — a label narrows whichever folder is in view (filter, not folder).
    setShowScheduled(false);
    setEditingScheduled(null);
    // Never allow an empty selection — fall back to Inbox.
    setFolders(next.length ? next : ['inbox']);
    setSelectedId(null);
    setCheckedIds(new Set());
  };
  // Flip folder+label picking mode. Leaving multiselect collapses a multi-folder
  // view down to the first folder, and a multi-label view down to the first
  // label, so single-select doesn't inherit a merged selection.
  const changeMultiSelect = (v: boolean) => {
    setFolderMultiSelect(v);
    if (!v) {
      if (folders.length > 1) setFolders([folders[0]]);
      if (activeLabelIds.length > 1) setActiveLabelIds([activeLabelIds[0]]);
    }
  };
  // Toggle a label filter over the current folder. With multiselect off, the
  // clicked label becomes the sole filter (or clears it); on, it adds/removes
  // from the active filter set (OR — a message with any active label passes).
  const selectLabel = (labelId: number) => {
    setShowScheduled(false);
    setEditingScheduled(null);
    setSelectedId(null);
    setCheckedIds(new Set());
    setActiveLabelIds((prev) => {
      const has = prev.includes(labelId);
      if (!folderMultiSelect) return has ? [] : [labelId];
      return has ? prev.filter((id) => id !== labelId) : [...prev, labelId];
    });
  };
  // Enter the "Отложенные" view — close any open reader/composer and drop the
  // label view; the folder multiselect keeps its state for when we return.
  const selectScheduled = () => {
    setShowScheduled(true);
    setEditingScheduled(null);
    setActiveLabelIds([]);
    setSelectedId(null);
    setNewCompose(false);
    setCheckedIds(new Set());
  };
  // Open a queued send in the composer (edit / reschedule / send now).
  const openScheduledEditor = (item: MailScheduled) => setEditingScheduled(item);
  const closeScheduledEditor = () => setEditingScheduled(null);

  const toggleChecked = (id: string) =>
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Select-all header checkbox — operates over the currently-visible (filtered)
  // list. `allChecked` drives the checked box, `someChecked && !allChecked` the
  // indeterminate dash. Toggling clears the visible rows when all are already
  // selected, otherwise adds every visible id (rows hidden by a filter keep
  // their state).
  const visibleIds = useMemo(() => messages.map((m) => m.id), [messages]);
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => checkedIds.has(id));
  const someChecked = visibleIds.some((id) => checkedIds.has(id));
  const toggleSelectAll = () =>
    setCheckedIds((prev) => {
      const next = new Set(prev);
      const everyVisibleChecked =
        visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
      visibleIds.forEach((id) => (everyVisibleChecked ? next.delete(id) : next.add(id)));
      return next;
    });

  // Clicking a row toggles its reader: open it (docked composer defaults to
  // reply) or close it if it's already open. Opening a row also dismisses the
  // standalone new-message pane.
  const toggleSelected = (id: string) => {
    setNewCompose(false);
    setInlineMode('reply');
    setSelectedId((prev) => (prev === id ? null : id));
  };

  // Flag/bookmark + archive/trash over the shared PATCH endpoint (optimistic).
  const updateMessage = useUpdateMessage(spaceId);
  const toggleStar = (m: MailMessage) =>
    updateMessage.mutate({ id: m.id, patch: { starred: !m.starred } });
  // Read/unread toggle for the open message. The optimistic PATCH doesn't re-GET
  // the message (only lists are invalidated), so marking unread stays unread and
  // doesn't bounce back on the server's mark-read-on-fetch.
  const toggleRead = (m: MailMessage) =>
    updateMessage.mutate({ id: m.id, patch: { is_read: !m.read } });
  const moveToFolder = (m: MailMessage, folder: MailFolderId) => {
    // If the row being moved out is open, close the reader — it's leaving the view.
    if (selectedId === m.id) setSelectedId(null);
    updateMessage.mutate({ id: m.id, patch: { folder } });
  };
  // Archive is a toggle: a message already in Archive goes back to Inbox, anything
  // else goes to Archive. (Fixes "can't un-archive" — the icon used to be one-way.)
  const toggleArchive = (m: MailMessage) =>
    moveToFolder(m, m.folder === 'archive' ? 'inbox' : 'archive');

  // Bulk actions over the checkbox selection (top toolbar). Unlike the row/reader
  // actions these are one-directional (mark read, star on, move to archive) — the
  // selection is heterogeneous, so a per-row toggle would be ambiguous. Each fans
  // out over the shared optimistic PATCH; label tagging reuses the tag mutation.
  const bulkPatch = (patch: MailPatch) =>
    checkedIds.forEach((id) => updateMessage.mutate({ id, patch }));
  const bulkMarkRead = () => bulkPatch({ is_read: true });
  const bulkMarkUnread = () => bulkPatch({ is_read: false });
  const bulkStar = () => bulkPatch({ starred: true });
  const bulkArchive = () => {
    // Rows leave the current view once archived — close any open one and clear
    // the now-stale selection.
    checkedIds.forEach((id) => {
      if (selectedId === id) setSelectedId(null);
      updateMessage.mutate({ id, patch: { folder: 'archive' } });
    });
    setCheckedIds(new Set());
  };
  const bulkTag = (labelId: number) =>
    checkedIds.forEach((id) => tagMessage.mutate({ msgId: id, labelId }));

  // Drag the full-height divider to resize the list column.
  const onDividerDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const rect = paneRef.current?.getBoundingClientRect();
    if (!rect) return;
    const move = (ev: MouseEvent) => {
      const next = Math.min(LIST_WIDTH_MAX, Math.max(LIST_WIDTH_MIN, ev.clientX - rect.left));
      setListWidth(next);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.userSelect = '';
    };
    // Kill text selection while dragging.
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, []);
  // Sync pulls fresh IMAP for every folder currently in view.
  const syncSelected = () => folders.forEach((f) => sync.mutate(f));

  // "Написать письмо" — open the standalone composer pane on the right (input
  // only, no thread above it). Clear any open reader so the pane stands alone.
  const openNewCompose = () => {
    setInlineMode('reply');
    setSelectedId(null);
    setNewCompose(true);
  };
  // Reply / forward act on the open message by re-seeding the docked composer —
  // no modal. `openForward` opens the given row first (list row action).
  const handleReply = () => setInlineMode('reply');
  const handleForward = () => setInlineMode('forward');
  const openForward = (m: MailMessage) => {
    setNewCompose(false);
    setInlineMode('forward');
    setSelectedId(m.id);
  };

  // Prev/next stepping through the currently-shown (filtered) list. The list is
  // newest-first, so the earlier index is the *newer* message (Gmail's ‹ / k).
  const selectedIndex = useMemo(
    () => messages.findIndex((m) => m.id === selectedId),
    [messages, selectedId]
  );
  const canPrev = selectedIndex > 0;
  const canNext = selectedIndex >= 0 && selectedIndex < messages.length - 1;
  const goPrev = () => canPrev && setSelectedId(messages[selectedIndex - 1].id);
  const goNext = () => canNext && setSelectedId(messages[selectedIndex + 1].id);

  const handlePrint = () => window.print();
  const focusSearch = () => {
    const el = document.querySelector<HTMLInputElement>('input[aria-label="Search mail"]');
    el?.focus();
  };

  // Gmail-style shortcuts. Handlers no-op when there's no selection. Gated by the
  // "Быстрые клавиши" preference in Settings.
  useMailHotkeys(
    {
      onCompose: openNewCompose,
      onSearch: focusSearch,
      onReply: () => selected && handleReply(),
      onForward: () => selected && handleForward(),
      onNext: goNext,
      onPrev: goPrev,
      onBack: () => {
        setNewCompose(false);
        setSelectedId(null);
      },
    },
    settings.hotkeys
  );

  return (
    <>
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
      <MailToolbar
        query={query}
        onQueryChange={setQuery}
        onCompose={openNewCompose}
        onSync={syncSelected}
        syncing={sync.isPending}
        canSync={!!activeAccountId}
        railOpen={railOpen}
        onToggleRail={() => setRailOpen((v) => !v)}
        unreadOnly={unreadOnly}
        onUnreadOnlyChange={setUnreadOnly}
        onOpenSettings={() => {
          setSettingsTab('general');
          setSettingsNewLabel(false);
          setSettingsOpen((v) => !v);
        }}
        allChecked={allChecked}
        someChecked={someChecked}
        onToggleSelectAll={toggleSelectAll}
        selectAllDisabled={messages.length === 0}
        bulkSlot={
          checkedIds.size > 0 ? (
            <MailBulkActions
              count={checkedIds.size}
              labels={labelsQuery.data ?? []}
              onMarkRead={bulkMarkRead}
              onMarkUnread={bulkMarkUnread}
              onArchive={bulkArchive}
              onStar={bulkStar}
              onTagLabel={bulkTag}
              onClear={() => setCheckedIds(new Set())}
            />
          ) : undefined
        }
        accountSwitcher={
          <AccountSwitcher
            spaceId={spaceId}
            compatibleWith="mail"
            activeId={activeAccountId}
            onSwitch={setActiveAccountId}
            onConnect={openConnect}
          />
        }
      />
      <div className="flex min-h-0 flex-1">
        <MailFolderRail
          folders={folderList}
          selectedFolders={folders}
          onFoldersChange={changeFolders}
          multiSelect={folderMultiSelect}
          onMultiSelectChange={changeMultiSelect}
          starredOnly={starredOnly}
          onStarredOnlyChange={setStarredOnly}
          expanded={railOpen}
          labels={labelsQuery.data ?? []}
          activeLabelIds={activeLabelIds}
          onSelectLabel={selectLabel}
          onAddLabel={() => {
            setSettingsTab('labels');
            setSettingsNewLabel(true);
            setSettingsOpen(true);
          }}
          scheduledActive={showScheduled}
          onSelectScheduled={selectScheduled}
          scheduledCount={scheduledItems.length}
        />
      <div
        ref={paneRef}
        className="relative min-h-0 flex-1"
        style={{ '--list-w': `${listWidth}px` } as React.CSSProperties}
      >
        {settingsOpen ? (
          <MailSettingsPanel
            settings={settings}
            onChange={setSettings}
            spaceId={spaceId}
            initialTab={settingsTab}
            autoNewLabel={settingsNewLabel}
            onClose={() => setSettingsOpen(false)}
          />
        ) : showScheduled ? (
          // ADR-158 §P6 — the outbox queue. Rows read like inbox rows; clicking a
          // pending one overlays the composer (edit / reschedule / send now),
          // mirroring the reading-pane overlay used for real messages.
          <div className="relative h-full">
            <div className="h-full overflow-auto">
              <MailScheduledList
                scheduled={scheduledItems}
                isLoading={scheduledQuery.isLoading}
                isError={scheduledQuery.isError}
                onRetry={() => scheduledQuery.refetch()}
                onOpen={openScheduledEditor}
                onCancel={(id) => cancelScheduled.mutate(id)}
                listWidth={listWidth}
                showSnippets={settings.showSnippets}
                openId={editingScheduled?.id ?? null}
                cancelingId={cancelScheduled.isPending ? (cancelScheduled.variables ?? null) : null}
              />
            </div>
            {editingScheduled && (
              <aside className="absolute inset-y-0 left-0 right-0 z-10 flex flex-col bg-[var(--bg-primary)] shadow-xl md:left-[var(--list-w)]">
                <div className="flex items-center gap-2 border-b border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Закрыть"
                    title="Закрыть"
                    onClick={closeScheduledEditor}
                  >
                    <ArrowLeft size={16} />
                  </Button>
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    Отложенное письмо
                  </span>
                </div>
                <MailReplyBar
                  mode="scheduled"
                  scheduled={editingScheduled}
                  fill
                  spaceId={spaceId}
                  connectorId={editingScheduled.connectorId ?? activeAccountId}
                  onSent={closeScheduledEditor}
                />
              </aside>
            )}
          </div>
        ) : (
        <>
        {/* Message list — always full-width. Each row is [resizable meta | glued
            body preview]. The reading pane overlays the preview column on open, so
            the list keeps scrolling underneath and you can still pick another row. */}
        <div className="h-full overflow-auto">
          {messagesQuery.isLoading ? (
            <div className="flex h-full items-center justify-center p-6 text-sm text-[var(--text-tertiary)]">
              Loading messages…
            </div>
          ) : messagesQuery.isError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-[var(--text-tertiary)]">
              <span>Couldn’t load messages</span>
              <Button variant="secondary" size="sm" onClick={() => messagesQuery.refetch()}>
                Retry
              </Button>
            </div>
          ) : (
            <MailList
              messages={messages}
              spaceId={spaceId}
              selectedId={selectedId}
              listWidth={listWidth}
              onSelect={toggleSelected}
              onForward={openForward}
              onStar={toggleStar}
              onArchive={toggleArchive}
              onDelete={(m) => moveToFolder(m, 'trash')}
              checkedIds={checkedIds}
              onToggleChecked={toggleChecked}
              settings={settings}
              colorizeIds={colorizeIds}
            />
          )}
        </div>

        {/* Full-height divider between the list column and the preview/reading
            pane. Draggable to resize the list column; sits above the reading pane
            (z-20) so you can resize while a message is open. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize message list"
          onMouseDown={onDividerDrag}
          className="group absolute inset-y-0 z-20 -ml-1 hidden w-2 cursor-col-resize md:block"
          style={{ left: listWidth }}
        >
          <div className="mx-auto h-full w-px bg-[var(--border-primary)] transition-colors group-hover:bg-[var(--color-primary-500)]" />
        </div>

        {/* Reading pane — overlays the body-preview column (left edge aligned to
            the list's w-72 meta column). Full body fills the height with a
            chat-style quick-reply docked at the bottom, mounted the moment a row
            opens. */}
        {(selected || newCompose) && (
          <aside
            className="absolute inset-y-0 left-0 right-0 z-10 flex flex-col bg-[var(--bg-primary)] shadow-xl md:left-[var(--list-w)]"
          >
            {newCompose ? (
              <>
                {/* Написать письмо — composer only, no thread window above it. */}
                <div className="flex items-center gap-2 border-b border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Закрыть"
                    title="Закрыть (u)"
                    onClick={() => setNewCompose(false)}
                  >
                    <ArrowLeft size={16} />
                  </Button>
                  <span className="text-sm font-medium text-[var(--text-primary)]">Новое письмо</span>
                </div>
                <MailReplyBar
                  mode="new"
                  fill
                  spaceId={spaceId}
                  connectorId={activeAccountId}
                  onSent={() => setNewCompose(false)}
                />
              </>
            ) : selected ? (
              <>
                <MailReadToolbar
                  onBack={() => setSelectedId(null)}
                  read={selected.read}
                  onToggleRead={() => toggleRead(selected)}
                  isArchived={selected.folder === 'archive'}
                  onToggleArchive={() => toggleArchive(selected)}
                  onDelete={() => moveToFolder(selected, 'trash')}
                  starred={!!selected.starred}
                  onToggleStar={() => toggleStar(selected)}
                  renderHtml={renderHtml}
                  onRenderHtmlChange={setRenderHtml}
                  mode={inlineMode}
                  onReply={handleReply}
                  onForward={handleForward}
                  onPrint={handlePrint}
                  onPrev={goPrev}
                  onNext={goNext}
                  canPrev={canPrev}
                  canNext={canNext}
                  labelSlot={<MailLabelBar spaceId={spaceId} message={selected} />}
                  linkSlot={<MailLinkBar spaceId={spaceId} message={selected} />}
                />
                <div className="min-h-0 flex-1 overflow-hidden">
                  <MailDisplay message={selected} renderHtml={renderHtml} />
                </div>
                {/* Docked composer — reply by default, forward when the toolbar
                    flips it; a sent forward drops back to reply on the same thread. */}
                <MailReplyBar
                  message={selected}
                  mode={inlineMode}
                  spaceId={spaceId}
                  connectorId={activeAccountId}
                  onSent={inlineMode === 'forward' ? () => setInlineMode('reply') : undefined}
                />
              </>
            ) : null}
          </aside>
        )}
        </>
        )}
      </div>
      </div>
    </div>

    <Modal
      open={connectOpen}
      onOpenChange={(open) => {
        setConnectOpen(open);
        // A freshly-linked mailbox should surface in the account switcher, which
        // reads the compatible-accounts query — invalidate it as the modal closes.
        if (!open) {
          void queryClient.invalidateQueries({ queryKey: ['connectors', 'compatible'] });
        }
      }}
      title="Connect a mailbox"
      description="Link an IMAP/SMTP account or OAuth provider to this space."
      size="lg"
    >
      {spaceId ? (
        <SpaceConnectorsTab spaceId={spaceId} initialExpandedSlug="imap" />
      ) : (
        <p className="text-sm text-[var(--text-tertiary)]">
          Не удалось определить пространство. Откройте почту из дашборда пространства и попробуйте снова.
        </p>
      )}
    </Modal>
    </>
  );
}
