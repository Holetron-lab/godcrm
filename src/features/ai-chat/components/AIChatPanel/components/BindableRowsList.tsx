/**
 * BindableRowsList — two-line row cards for header panels (Tickets, Documents,
 * Favourites). Visual parity with the attach/bind row picker (RowList) so the
 * user sees the same card everywhere — table-icon + title on row 1, then
 * type/status/priority pills + description preview + per-row mini toolbar on
 * row 2.
 *
 * Behaviour:
 *   - Click on the row body → opens the row's bound chat. Lazy-creates via
 *     `/chat/conversations/ensure-row-chat` when none exists. If the user is
 *     currently inside an unbound chat, surfaces the bind/create prompt.
 *   - Per-row mini toolbar (right side of row 2): ✏️ edit | 📎 attach to
 *     message draft | 🔗 bind current chat | 💬 (with msg-count + unread dot)
 *     for explicit chat open. The toolbar is always visible — no select-then-
 *     act flow (per UX 2026-05-07).
 *   - Stripe colour: per-row `color` column → row colour; otherwise dict
 *     colour from status/priority/category.
 *   - Pills: type → status → priority order, coloured from dict (relation) or
 *     inline `select.options[].color`. Same self-healing dict resolution as
 *     RowList: case-insensitive lookup for value→entry, multi-shape config
 *     parse for tableId, alias-based column resolution for sparse configs.
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Loader2, MessageSquare, Paperclip, Pencil, Link2, Table as TableIcon, Settings2, Maximize2, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import { useTableColumns } from '@/features/tables/hooks/useTableColumns';
import { useRowBoundChats } from '../hooks/useRowBoundChats';
import { BindRowChatPrompt } from './BindRowChatPrompt';
import RowViewerModal from './ChatMessages/RowViewerModal';

const TITLE_ALIASES = ['title', 'name', 'what', 'subject', 'label', 'Название'];
const ICON_ALIASES = ['icon', 'emoji', 'Иконка', 'иконка'];
const COLOR_ALIASES = ['color', 'colour', 'Цвет', 'цвет'];
const DESC_ALIASES = ['description', 'why', 'summary', 'preview', 'desc'];
const STATUS_ALIASES = ['state', 'status', 'status_id'];
const PRIORITY_ALIASES = ['priority', 'priority_id', 'urgency'];
const TYPE_ALIASES = ['type', 'category', 'category_id', 'task_type', 'kind', 'Тип'];

interface DictEntry { id: number | string; name: string; color?: string }

export interface BindableSource {
  tableId: number;
  tableName: string;
  tableIcon?: string;
  iconColumn?: string;
  displayColumn?: string;
  descriptionColumn?: string;
  statusColumn?: string;
  priorityColumn?: string;
  categoryColumn?: string;
  statusDictTableId?: number;
  priorityDictTableId?: number;
  categoryDictTableId?: number;
}

export interface BindableRow {
  id: number;
  data: Record<string, unknown>;
}

export interface BindableRowsListProps {
  source: BindableSource;
  rows: BindableRow[];
  isLoading?: boolean;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  /** Current chat the user is in. Drives "bind this chat?" branch. */
  currentConversationId: number | null;
  /** Current chat's bound row ref, used to know if it's "free" to be bound. */
  currentBoundRowId?: number | null;
  /** Callback to open a conversation by id. Used as fallback when
   *  `openTaskChat` isn't supplied. */
  selectConversation: (id: number) => void;
  /** Preferred opener for row-bound chats: sets chatMode='people',
   *  chatPartner={type:'group'} and boundRows so the header refreshes.
   *  When unset, falls back to `selectConversation`. */
  openTaskChat?: (chat: { conversationId: number; tableId: number; rowId: number; rowTitle?: string }) => void;
  /** Close the panel after navigation. */
  closePanel: () => void;
  /** Replace bound rows of the active chat (for the toolbar's "🔗 bind"). */
  setBoundRows: (rows: Array<{ table_id: number; row_id: number; table_name?: string; table_icon?: string; row_title?: string }>) => void;
  setShowBoundRowsBar: (v: boolean) => void;
  /** Attach a row reference into the message draft (toolbar 📎 button). */
  onAttachToMessage?: (b: { table_id: number; row_id: number; table_name?: string; table_icon?: string; row_title?: string }) => void;
  /** Server-side total for the registry (for `loaded / total` in the footer). */
  total?: number;
  /** Optional "change source" handler — renders a ⚙ button in the footer. */
  onChangeSource?: () => void;
  /** Current panel size — drives the maximize/restore icon in the footer. */
  panelMode?: 'collapsed' | 'default' | 'expanded' | 'fullscreen';
  /** Toggle panel size (default → fullscreen → default). Renders a ⤢ button. */
  onTogglePanelMode?: () => void;
}

function readField(data: Record<string, unknown>, col?: string): unknown {
  if (!col) return undefined;
  if (col in data) return data[col];
  const lower = col.toLowerCase();
  for (const k of Object.keys(data)) {
    if (k.toLowerCase() === lower) return data[k];
  }
  return undefined;
}

async function fetchDict(tableId: number): Promise<DictEntry[]> {
  const r = await apiClient.get<{ success: boolean; data: { rows: Array<{ id: number; data: Record<string, unknown> }> } }>(
    `/tables/${tableId}/rows?limit=200`
  );
  if (!r.success) return [];
  return (r.data.rows || []).map(row => ({
    id: row.id,
    name: String(row.data['name'] || row.data['title'] || row.data['label'] || ''),
    color: (row.data['color'] || row.data['colour']) as string | undefined,
  }));
}

export function BindableRowsList({
  source,
  rows,
  isLoading,
  hasMore,
  isLoadingMore,
  onLoadMore,
  currentConversationId,
  currentBoundRowId,
  selectConversation,
  openTaskChat,
  closePanel,
  setBoundRows,
  setShowBoundRowsBar,
  onAttachToMessage,
  total,
  onChangeSource,
  panelMode,
  onTogglePanelMode,
}: BindableRowsListProps) {
  const [editorRow, setEditorRow] = useState<{ tableId: number; rowId: number } | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<{ id: number; title: string } | null>(null);

  const { map: rowChats, refetch } = useRowBoundChats(source.tableId);
  const { data: columns = [] } = useTableColumns(source.tableId ? String(source.tableId) : undefined);

  // Same dict resolution machinery as RowList — kept inline rather than
  // extracted to keep BindableRowsList drop-in for the panels (future cleanup
  // pass: extract `useRowDecorations` hook used by both).
  const dictByColumnKey = useMemo(() => {
    const m = new Map<string, number>();
    const toNum = (v: unknown): number | undefined => {
      const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? v : NaN;
      return Number.isFinite(n) ? n : undefined;
    };
    for (const c of columns) {
      const cfg = (c.config || {}) as Record<string, unknown>;
      const rel = (cfg?.relation || {}) as Record<string, unknown>;
      const dictId =
        toNum(cfg?.relatedTableId) ??
        toNum(cfg?.relationTableId) ??
        toNum(cfg?.target_table_id) ??
        toNum(rel?.tableId) ??
        toNum(rel?.target_table_id);
      if (!dictId) continue;
      const keys = [c.name, c.displayName].filter(Boolean) as string[];
      for (const k of keys) m.set(k.toLowerCase(), dictId);
    }
    return m;
  }, [columns]);

  const inlineDictByColumnKey = useMemo(() => {
    const m = new Map<string, DictEntry[]>();
    type Opt = { value?: unknown; label?: unknown; color?: unknown };
    for (const c of columns) {
      const cfg = (c.config || {}) as Record<string, unknown>;
      const opts = cfg?.options;
      if (!Array.isArray(opts) || opts.length === 0) continue;
      const dict: DictEntry[] = (opts as Opt[]).map(o => ({
        id: String(o?.value ?? o?.label ?? ''),
        name: String(o?.label ?? o?.value ?? ''),
        color: typeof o?.color === 'string' ? o.color : undefined,
      })).filter(d => d.id !== '' || d.name !== '');
      const keys = [c.name, c.displayName].filter(Boolean) as string[];
      for (const k of keys) m.set(k.toLowerCase(), dict);
    }
    return m;
  }, [columns]);

  const resolveDictId = (configured: number | undefined, col?: string): number | undefined => {
    if (configured) return configured;
    if (!col) return undefined;
    return dictByColumnKey.get(col.toLowerCase());
  };

  const inlineDictFor = (col?: string): DictEntry[] | undefined => {
    if (!col) return undefined;
    return inlineDictByColumnKey.get(col.toLowerCase());
  };

  const columnNameSet = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of columns) {
      if (c.name) m.set(c.name.toLowerCase(), c.name);
      if (c.displayName) m.set(c.displayName.toLowerCase(), c.displayName);
    }
    return m;
  }, [columns]);
  const findAlias = (aliases: string[]): string | undefined => {
    for (const a of aliases) {
      const hit = columnNameSet.get(a.toLowerCase());
      if (hit) return hit;
    }
    return undefined;
  };
  const effStatusCol = source.statusColumn || findAlias(STATUS_ALIASES);
  const effPriorityCol = source.priorityColumn || findAlias(PRIORITY_ALIASES);
  const effCategoryCol = source.categoryColumn || findAlias(TYPE_ALIASES);
  const effDescCol = source.descriptionColumn || findAlias(DESC_ALIASES);

  const statusDictId = resolveDictId(source.statusDictTableId, effStatusCol);
  const priorityDictId = resolveDictId(source.priorityDictTableId, effPriorityCol);
  const categoryDictId = resolveDictId(source.categoryDictTableId, effCategoryCol);

  const colorColumnName = useMemo(() => {
    const names = new Set<string>();
    for (const c of columns) {
      if (c.name) names.add(c.name.toLowerCase());
      if (c.displayName) names.add(c.displayName.toLowerCase());
    }
    for (const a of COLOR_ALIASES) {
      if (names.has(a.toLowerCase())) return a;
    }
    return undefined;
  }, [columns]);

  const [statusDictRemote, setStatusDictRemote] = useState<DictEntry[]>([]);
  const [priorityDictRemote, setPriorityDictRemote] = useState<DictEntry[]>([]);
  const [categoryDictRemote, setCategoryDictRemote] = useState<DictEntry[]>([]);
  useEffect(() => {
    if (!statusDictId) { setStatusDictRemote([]); return; }
    let cancel = false;
    fetchDict(statusDictId).then(d => { if (!cancel) setStatusDictRemote(d); });
    return () => { cancel = true; };
  }, [statusDictId]);
  useEffect(() => {
    if (!priorityDictId) { setPriorityDictRemote([]); return; }
    let cancel = false;
    fetchDict(priorityDictId).then(d => { if (!cancel) setPriorityDictRemote(d); });
    return () => { cancel = true; };
  }, [priorityDictId]);
  useEffect(() => {
    if (!categoryDictId) { setCategoryDictRemote([]); return; }
    let cancel = false;
    fetchDict(categoryDictId).then(d => { if (!cancel) setCategoryDictRemote(d); });
    return () => { cancel = true; };
  }, [categoryDictId]);

  const statusDict = statusDictRemote.length ? statusDictRemote : (inlineDictFor(effStatusCol) || []);
  const priorityDict = priorityDictRemote.length ? priorityDictRemote : (inlineDictFor(effPriorityCol) || []);
  const categoryDict = categoryDictRemote.length ? categoryDictRemote : (inlineDictFor(effCategoryCol) || []);

  const lookup = (dict: DictEntry[], val: unknown): DictEntry | undefined => {
    if (val == null || val === '') return undefined;
    const sval = String(val);
    const idMatch = dict.find(d => String(d.id) === sval);
    if (idMatch) return idMatch;
    const slow = sval.toLowerCase();
    return dict.find(d => d.name.toLowerCase() === slow);
  };

  const openConversation = useCallback((conversationId: number, rowId: number, title: string) => {
    if (openTaskChat) {
      openTaskChat({ conversationId, tableId: source.tableId, rowId, rowTitle: title });
    } else {
      selectConversation(conversationId);
    }
    closePanel();
  }, [openTaskChat, selectConversation, source.tableId, closePanel]);

  const ensureAndOpen = useCallback(async (rowId: number, title: string) => {
    try {
      const r = await apiClient.post<{ success: boolean; data: { id: number } }>(
        `/chat/conversations/ensure-row-chat`,
        { table_id: source.tableId, row_id: rowId, title }
      );
      const convId = r?.data?.id;
      if (convId) {
        await refetch();
        openConversation(convId, rowId, title);
      } else {
        logger.warn('[BindableRowsList] ensure-row-chat returned no id');
      }
    } catch (e) {
      logger.warn('[BindableRowsList] ensure-row-chat failed:', e);
    }
  }, [source.tableId, refetch, openConversation]);

  const bindCurrentChatToRow = useCallback(async (rowId: number, title: string) => {
    if (!currentConversationId) return;
    try {
      await apiClient.patch(`/chat/conversations/${currentConversationId}`, {
        bound_table_id: source.tableId,
        bound_row_id: rowId,
      });
      setBoundRows([{
        table_id: source.tableId,
        row_id: rowId,
        table_name: source.tableName,
        table_icon: source.tableIcon,
        row_title: title,
      }]);
      setShowBoundRowsBar(true);
      await refetch();
      closePanel();
    } catch (e) {
      logger.warn('[BindableRowsList] bind current chat failed:', e);
    }
  }, [currentConversationId, source, setBoundRows, setShowBoundRowsBar, refetch, closePanel]);

  const handleRowClick = useCallback((rowId: number, title: string) => {
    const chat = rowChats.get(rowId);
    if (chat) {
      openConversation(chat.conversationId, rowId, title);
      return;
    }
    if (currentConversationId && !currentBoundRowId) {
      setPendingPrompt({ id: rowId, title });
      return;
    }
    void ensureAndOpen(rowId, title);
  }, [rowChats, currentConversationId, currentBoundRowId, openConversation, ensureAndOpen]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">Нет записей</div>
        ) : (
          <>
            {rows.map(row => {
              const data = row.data;
              const titleRaw = readField(data, source.displayColumn);
              let title = titleRaw ? String(titleRaw) : '';
              if (!title) {
                for (const a of TITLE_ALIASES) {
                  const v = readField(data, a);
                  if (v) { title = String(v); break; }
                }
              }
              if (!title) title = `#${row.id}`;
              const descRaw = readField(data, effDescCol);
              const desc = typeof descRaw === 'string' ? descRaw : descRaw == null ? '' : String(descRaw);
              const status = lookup(statusDict, readField(data, effStatusCol));
              const priority = lookup(priorityDict, readField(data, effPriorityCol));
              const category = lookup(categoryDict, readField(data, effCategoryCol));
              const hasMeta = !!(status || priority || category || desc);

              let stripe: string | undefined;
              if (colorColumnName) {
                const rcvRaw = readField(data, colorColumnName);
                const rcv = typeof rcvRaw === 'string' ? rcvRaw.trim() : '';
                stripe = rcv && /^#?[0-9a-f]{3,8}$/i.test(rcv)
                  ? (rcv.startsWith('#') ? rcv : `#${rcv}`)
                  : 'var(--border-secondary)';
              } else {
                const stripeRaw = status?.color || priority?.color || category?.color;
                stripe = stripeRaw && /^#?[0-9a-f]{3,8}$/i.test(stripeRaw)
                  ? (stripeRaw.startsWith('#') ? stripeRaw : `#${stripeRaw}`)
                  : undefined;
              }

              let emoji = String(readField(data, source.iconColumn) || '').trim();
              if (!emoji) {
                for (const a of ICON_ALIASES) {
                  const v = readField(data, a);
                  if (v) { emoji = String(v).trim(); break; }
                }
              }
              if (!emoji) emoji = String(source.tableIcon || '').trim();

              const chat = rowChats.get(row.id);

              return (
                <BindableRowCard
                  key={row.id}
                  title={title}
                  emoji={emoji}
                  desc={desc}
                  status={status}
                  priority={priority}
                  category={category}
                  hasMeta={hasMeta}
                  stripe={stripe}
                  chat={chat}
                  onOpen={() => handleRowClick(row.id, title)}
                  onEdit={() => setEditorRow({ tableId: source.tableId, rowId: row.id })}
                  onAttach={onAttachToMessage ? () => onAttachToMessage({
                    table_id: source.tableId,
                    row_id: row.id,
                    table_name: source.tableName,
                    table_icon: source.tableIcon,
                    row_title: title,
                  }) : undefined}
                  onBind={currentConversationId ? () => {
                    if (currentBoundRowId) {
                      // eslint-disable-next-line no-alert
                      if (!window.confirm('У этого чата уже есть привязанная строка. Заменить?')) return;
                    }
                    void bindCurrentChatToRow(row.id, title);
                  } : undefined}
                />
              );
            })}
            {hasMore && (
              <div className="px-3 py-2 border-t border-[var(--border-secondary)]">
                <button
                  type="button"
                  onClick={() => onLoadMore?.()}
                  disabled={isLoadingMore}
                  className="w-full py-2 text-xs text-[var(--color-primary-500)] hover:bg-[var(--bg-tertiary)] rounded transition-colors disabled:opacity-50"
                >
                  {isLoadingMore ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Загрузить ещё'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-[var(--border-secondary)] bg-[var(--bg-tertiary)] flex items-center justify-between gap-2 text-[10px] text-[var(--text-tertiary)] flex-shrink-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {source.tableIcon
            ? <span className="flex-shrink-0">{source.tableIcon}</span>
            : <TableIcon className="w-3 h-3 flex-shrink-0" />}
          <span className="truncate">{source.tableName}</span>
          <span className="flex-shrink-0">·</span>
          <span className="flex-shrink-0">
            {rows.length}{typeof total === 'number' && total > 0 ? ` / ${total}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {onChangeSource && (
            <button
              type="button"
              onClick={onChangeSource}
              title="Сменить источник"
              className="p-1 rounded hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
            >
              <Settings2 className="w-3 h-3" />
            </button>
          )}
          {onTogglePanelMode && (
            <button
              type="button"
              onClick={onTogglePanelMode}
              title={panelMode === 'fullscreen' ? 'Свернуть' : 'Развернуть'}
              className="p-1 rounded hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
            >
              {panelMode === 'fullscreen' ? <ChevronDown className="w-3 h-3" /> :
               panelMode === 'collapsed' ? <ChevronUp className="w-3 h-3" /> :
               <Maximize2 className="w-3 h-3" />}
            </button>
          )}
        </div>
      </div>

      {pendingPrompt && (
        <BindRowChatPrompt
          rowTitle={pendingPrompt.title}
          onBindCurrent={() => { void bindCurrentChatToRow(pendingPrompt.id, pendingPrompt.title); setPendingPrompt(null); }}
          onCreateNew={() => { void ensureAndOpen(pendingPrompt.id, pendingPrompt.title); setPendingPrompt(null); }}
          onClose={() => setPendingPrompt(null)}
        />
      )}

      {editorRow && (
        <RowViewerModal
          isOpen
          mode="view"
          tableId={editorRow.tableId}
          rowId={editorRow.rowId}
          onClose={() => setEditorRow(null)}
        />
      )}
    </div>
  );
}

interface BindableRowCardProps {
  title: string;
  emoji: string;
  desc: string;
  status?: DictEntry;
  priority?: DictEntry;
  category?: DictEntry;
  hasMeta: boolean;
  stripe?: string;
  chat?: { conversationId: number; msgCount: number; unread: number };
  onOpen: () => void;
  onEdit: () => void;
  onAttach?: () => void;
  onBind?: () => void;
}

function BindableRowCard({
  title, emoji, desc, status, priority, category, hasMeta, stripe, chat,
  onOpen, onEdit, onAttach, onBind,
}: BindableRowCardProps) {
  // Two-row card. Row 1: emoji + title (clickable, opens chat).
  // Row 2: pills + description (clickable) + per-row toolbar (right-aligned,
  // independent buttons). Toolbar lives in row 2 so the card stays at exactly
  // two visual rows even on narrow header panels — no wrap to a third line.
  return (
    <div
      style={stripe ? { boxShadow: `inset 3px 0 0 ${stripe}` } : undefined}
      className="group px-3 py-2 border-b border-[var(--border-secondary)] last:border-0 hover:bg-[var(--bg-tertiary)] transition-colors"
    >
      <button
        type="button"
        onClick={onOpen}
        className="w-full flex items-center gap-2 text-left"
        title={chat ? `Открыть чат (${chat.msgCount})` : 'Открыть/создать чат'}
      >
        <span className="flex-shrink-0 leading-none">
          {emoji
            ? <span className="text-base">{emoji}</span>
            : <TableIcon className="w-4 h-4 text-[var(--text-tertiary)]" />}
        </span>
        <span className="flex-1 min-w-0 text-sm text-[var(--text-primary)] truncate">{title}</span>
      </button>
      <div className="mt-1 flex items-center gap-1 min-w-0">
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 min-w-0 flex items-center gap-1 text-left"
          title={chat ? `Открыть чат (${chat.msgCount})` : 'Открыть/создать чат'}
        >
          {hasMeta ? (
            <>
              {category && <Pill label={category.name} color={category.color} />}
              {status && <Pill label={status.name} color={status.color} />}
              {priority && <Pill label={priority.name} color={priority.color} />}
              {desc && (
                <span className="text-[10px] text-[var(--text-tertiary)] truncate flex-1 min-w-0">
                  {desc}
                </span>
              )}
            </>
          ) : (
            <span className="text-[10px] text-[var(--text-tertiary)] flex-1 min-w-0">&nbsp;</span>
          )}
        </button>
        <div className="flex items-center gap-px flex-shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
          <RowToolbarBtn
            icon={<Pencil className="w-3 h-3" />}
            title="Редактировать"
            onClick={onEdit}
          />
          {onAttach && (
            <RowToolbarBtn
              icon={<Paperclip className="w-3 h-3" />}
              title="Прикрепить к сообщению"
              onClick={onAttach}
            />
          )}
          {onBind && (
            <RowToolbarBtn
              icon={<Link2 className="w-3 h-3" />}
              title="Привязать текущий чат"
              onClick={onBind}
            />
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            className={cn(
              'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] transition-colors',
              chat
                ? 'text-[var(--color-primary-400)] hover:bg-[var(--color-primary-500)]/15'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
            )}
            title={chat ? `Открыть чат (${chat.msgCount} сообщений)` : 'Открыть/создать чат'}
            aria-label={chat ? 'Открыть чат' : 'Создать чат'}
          >
            <MessageSquare className="w-3 h-3" />
            {chat && chat.msgCount > 0 && <span>{chat.msgCount}</span>}
            {chat && chat.unread > 0 && (
              <span className="ml-0.5 inline-block w-1.5 h-1.5 rounded-full bg-red-500" aria-hidden />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function RowToolbarBtn({ icon, title, onClick }: { icon: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      className="inline-flex items-center justify-center w-5 h-5 rounded text-[var(--text-secondary)] hover:text-[var(--color-primary-400)] hover:bg-[var(--bg-secondary)] transition-colors"
    >
      {icon}
    </button>
  );
}

function Pill({ label, color }: { label: string; color?: string }) {
  if (!label) return null;
  const safe = color && /^#?[0-9a-f]{3,8}$/i.test(color) ? (color.startsWith('#') ? color : `#${color}`) : undefined;
  return (
    <span
      className="inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium leading-tight flex-shrink-0"
      style={safe
        ? { background: `${safe}22`, color: safe, border: `1px solid ${safe}44` }
        : { background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-secondary)' }}
    >{label}</span>
  );
}
