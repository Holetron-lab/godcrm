import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { logger } from '@/shared/utils/logger';
import { Input } from '@/shared/components/ui';
import { Modal } from '@/shared/components/ui/Modal';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import { readPhotoCaptureDate } from '../../utils/photoCaptureDate';
import { CardAnalysisBlock } from './CardAnalysisBlock';
import { useIsPublicReadOnly } from '@/features/public/PublicViewContext';
import type { ColumnModel, ColumnOption } from '@/features/tables/types/table.types';
import type { AttachedFile, CardDetailModalProps } from './card-detail-types';
import { FilePreviewModal } from './FilePreviewModal';

/**
 * Detail popup for the gallery preset (ADR-0003 gallery surface).
 *
 * Layout is deliberately different from the universal `CardDetailModal`:
 * LEFT  — a short, explicitly configured list of "care" fields + one long
 *         summary block. Everything not on that list stays out of the popup;
 *         its content is expected to live inside the summary text.
 * RIGHT — title, subtitle, then the photo STRIP: every shot side by side at one
 *         frame height, newest first, each with its capture date UNDER it. The
 *         head of the strip is the narrow "+" tile that uploads. Swipe /
 *         mouse-drag / arrows / ←→ all scroll the same container.
 *
 * BELOW `sm` (a phone held upright) those two columns STACK instead: 340px of
 * fields + a photo pane does not fit across ~390 CSS px, and the side-by-side
 * form left the photos squeezed off the right edge — invisible. Stacked, the
 * photo pane comes FIRST (title, then one full-width shot per swipe), the field
 * list follows under it, and the whole stack is ONE scroll container instead of
 * two that never got room to scroll.
 *
 * Driven by widget config, no table-specific hardcoding:
 *   detailFields[]  — column names for the left column, in render order. A
 *                     NESTED ARRAY is one row rendered side by side:
 *                     `["a", ["b", "c"]]` = `a` on its own line, then `b` and
 *                     `c` sharing the next line.
 *   summaryColumn   — long-text column shown under them
 *   journalFields[] — further long-text columns, each its own COLLAPSED section
 *                     under the summary. Meant for accumulating logs (an AI
 *                     photo journal): the card must not open onto a wall of
 *                     history, but the history has to be reachable in one click.
 *   footerFields[]  — column names rendered BELOW the summary block
 *   galleryColumn   — image/file column holding the photo list
 *
 * Select fields read as the current value's coloured badge. A DOUBLE CLICK opens
 * the picker — coloured pill buttons, one click on a pill sets the value and
 * closes the picker; a click on the already-active pill clears the field.
 *   titleColumn / subtitleColumn — right-hand heading pair
 */

interface GalleryCardDetailModalProps extends CardDetailModalProps {
  /** `widget.config` — supplies the field layout. */
  config?: Record<string, unknown>;
}

/**
 * Height of one frame in the strip. Every photo is scaled to it and keeps its
 * own aspect ratio, so widths differ down the row — that is what makes the strip
 * read as a film strip and not as a grid of cropped squares.
 *
 * On a phone the frame is measured in `dvh`, not `vh`: Safari's `vh` is the tall
 * viewport WITH the toolbar hidden, so a `vh` frame runs under the toolbar and
 * the date caption below it never comes into view.
 */
const FRAME_HEIGHT =
  'h-[46dvh] min-h-[200px] sm:h-[52vh] sm:max-h-[520px] sm:min-h-[220px]';

const MEDIA_TYPES = new Set(['file', 'image', 'photo', 'attachment']);
const LONG_TEXT_TYPES = new Set(['long_text', 'rich_text', 'text']);

/**
 * A long-text column an automation appends to — a dated journal, not prose.
 * It must never win the summary slot: the summary is the one block a human
 * writes and reads first, and a board that happens to order the AI column
 * before it would otherwise show the log there and hide the summary entirely.
 */
const JOURNAL_NAME = /анализ|analysis|журнал|journal|истори|history|log\b/i;

const isJournalColumn = (column: ColumnModel): boolean =>
  JOURNAL_NAME.test(column.name) || JOURNAL_NAME.test(column.displayName || '');

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [];

/** Media cells store a single URL or a comma-separated list, oldest first. */
const parseMediaList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((v) => String(v ?? '').trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value.split(',').map((url) => url.trim()).filter(Boolean);
};

/** Keep relative URLs relative so images resolve against the current origin. */
const normalizeUrl = (url: string): string => {
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  return url.startsWith('/') ? url : `/${url}`;
};

/**
 * A hand-written capture date, `YYYY-MM-DD`. Built as a LOCAL date on purpose:
 * `new Date('2025-10-13')` is UTC midnight and renders as the 12th west of
 * Greenwich, which would show the wrong day for the same stored string.
 */
const parseDayString = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDay = (date: Date): string =>
  date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });

/** Select options live in `table_columns.config.options`; older rows carry `settings`. */
const columnOptions = (column: ColumnModel): ColumnOption[] => {
  const raw =
    column.config?.options ??
    (column as unknown as { settings?: { options?: unknown } }).settings?.options;
  return Array.isArray(raw) ? (raw as ColumnOption[]) : [];
};

const optionColor = (column: ColumnModel, value: unknown): string | undefined =>
  columnOptions(column).find((o) => o.value === String(value))?.color;

export function GalleryCardDetailModal({
  isOpen,
  onClose,
  card,
  columns,
  config,
  onSave,
  titleField,
}: GalleryCardDetailModalProps) {
  const isPublicReadOnly = useIsPublicReadOnly();
  const editHint = isPublicReadOnly ? undefined : 'Двойной клик для редактирования';

  /** Local mirror of the row — the parent keeps a snapshot, so saves land here. */
  const [rowData, setRowData] = useState<Record<string, unknown>>({});
  const [editingField, setEditingField] = useState<string | null>(null);
  const [draft, setDraft] = useState<unknown>('');
  const [saving, setSaving] = useState(false);
  const [previewFile, setPreviewFile] = useState<AttachedFile | null>(null);
  /** The horizontal film strip and how far it can still travel each way. */
  const trackRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState({ left: false, right: false });

  useEffect(() => {
    setRowData(card?.data ? { ...card.data } : {});
    setEditingField(null);
    // A different card always opens at the head of its strip.
    trackRef.current?.scrollTo({ left: 0, behavior: 'auto' });
  }, [card]);

  const cols = useMemo(() => (Array.isArray(columns) ? columns : []), [columns]);
  const columnByName = useMemo(() => {
    const map = new Map<string, ColumnModel>();
    cols.forEach((c) => map.set(c.name, c));
    return map;
  }, [cols]);

  const cfg = (config || {}) as Record<string, unknown>;

  const titleColumn =
    asString(cfg.titleColumn ?? cfg.title_column ?? titleField) ||
    cols.find((c) => c.type === 'text')?.name ||
    '';
  const subtitleColumn = asString(
    cfg.subtitleColumn ?? cfg.subtitle_column ?? cfg.descriptionColumn ?? cfg.description_column
  );
  const galleryColumn =
    asString(cfg.galleryColumn ?? cfg.gallery_column ?? cfg.coverColumn ?? cfg.cover_column) ||
    cols.find((c) => MEDIA_TYPES.has(c.type))?.name ||
    '';
  const summaryColumn =
    asString(cfg.summaryColumn ?? cfg.summary_column) ||
    cols.find((c) => c.type === 'long_text' && c.name !== titleColumn && !isJournalColumn(c))
      ?.name ||
    '';

  /**
   * Select columns named here fall back to a native dropdown. Everything else
   * of type `select` is edited with the one-click pills — that is the default.
   */
  const dropdownFields = useMemo(
    () => new Set(asStringArray(cfg.dropdownFields ?? cfg.dropdown_fields)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(cfg.dropdownFields ?? cfg.dropdown_fields)]
  );

  /** Fields that sit under the summary block instead of above it. */
  const footerColumns = useMemo<ColumnModel[]>(
    () =>
      asStringArray(cfg.footerFields ?? cfg.footer_fields)
        .map((name) => columnByName.get(name))
        .filter((c): c is ColumnModel => !!c),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnByName, JSON.stringify(cfg.footerFields ?? cfg.footer_fields)]
  );

  /**
   * Long-text columns rendered as their own journal window above the summary.
   * `journalFields` names them explicitly; with nothing configured the window
   * appears from the mere existence of an analysis column, so a board gets it
   * without anyone editing widget settings first. The summary column is
   * filtered out either way — it is already rendered, and a board that lists
   * it twice must not get it twice.
   */
  const journalColumns = useMemo<ColumnModel[]>(() => {
    const listed = asStringArray(cfg.journalFields ?? cfg.journal_fields);
    const names = listed.length
      ? listed
      : cols
          // Only the genuinely long types: a short `text` column called
          // «анализ» is a label, not a journal, and belongs in the field list.
          .filter((c) => (c.type === 'long_text' || c.type === 'rich_text') && isJournalColumn(c))
          .map((c) => c.name);
    return names
      .filter((name) => name !== summaryColumn)
      .map((name) => columnByName.get(name))
      .filter((c): c is ColumnModel => !!c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, columnByName, summaryColumn, JSON.stringify(cfg.journalFields ?? cfg.journal_fields)]);

  /**
   * The comment box: its own always-open field at the bottom of the left column,
   * never a `detailFields` row. Explicit `commentColumn` wins; otherwise the
   * first column whose name reads as a comment, so a board only has to add the
   * column — no widget config needed.
   */
  const commentColumnName = asString(cfg.commentColumn ?? cfg.comment_column);
  const commentColumn = useMemo<ColumnModel | undefined>(() => {
    if (commentColumnName) return columnByName.get(commentColumnName);
    return cols.find((c) => /коммент|comment/i.test(`${c.name} ${c.displayName || ''}`));
  }, [cols, columnByName, commentColumnName]);

  /**
   * Column holding hand-written capture dates: `{"<photo url>": "YYYY-MM-DD"}`.
   * Needed because most photos arrive without EXIF — an editor re-save or a
   * messenger strips it — and then the real shooting date exists nowhere in the
   * file. Explicit `photoDatesColumn` wins; otherwise the first column that
   * reads as one, so a board only has to add the column.
   */
  const photoDatesColumnName = asString(cfg.photoDatesColumn ?? cfg.photo_dates_column);
  const photoDatesColumn = useMemo<ColumnModel | undefined>(() => {
    if (photoDatesColumnName) return columnByName.get(photoDatesColumnName);
    return cols.find((c) =>
      // `\w` is ASCII-only in JS, so it cannot cross the "ы" in «даты_фото» —
      // the Cyrillic class and the `_` separator are what make a Russian
      // column name («даты_фото» / «Даты фото») detectable at all.
      /(дат[a-zа-яё]*[\s_]*фото|фото[a-zа-яё]*[\s_]*дат|photo[\s_]*dates?|dates?[\s_]*photo)/i.test(
        `${c.name} ${c.displayName || ''}`
      )
    );
  }, [cols, columnByName, photoDatesColumnName]);

  /**
   * Left column, already cut into ROWS. Explicit list wins; otherwise everything
   * short and non-media, one field per row. A nested array in `detailFields` is
   * a single row whose fields sit side by side — that is the only way to put two
   * short fields (a date and a place) on one line instead of stacking them.
   */
  const detailGroups = useMemo<ColumnModel[][]>(() => {
    const inFooter = new Set(footerColumns.map((c) => c.name));
    if (commentColumn) inFooter.add(commentColumn.name);
    // A journal has its own window below; listing it here too would print the
    // whole log twice, once unparsed.
    journalColumns.forEach((c) => inFooter.add(c.name));
    const raw = cfg.detailFields ?? cfg.detail_fields;
    const explicit = (Array.isArray(raw) ? raw : [])
      .map((entry) => asStringArray(Array.isArray(entry) ? entry : [entry]))
      .filter((names) => names.length > 0);
    if (explicit.length > 0) {
      return explicit
        .map((names) =>
          names
            // A name listed in both lists belongs to the footer — it wins, no duplicate row.
            .filter((name) => !inFooter.has(name))
            .map((name) => columnByName.get(name))
            .filter((c): c is ColumnModel => !!c)
        )
        .filter((group) => group.length > 0);
    }
    return cols
      .filter(
        (c) =>
          !MEDIA_TYPES.has(c.type) &&
          !LONG_TEXT_TYPES.has(c.type) &&
          !inFooter.has(c.name) &&
          c.name !== titleColumn &&
          c.name !== subtitleColumn
      )
      .map((c) => [c]);
    // cfg is re-created each render; the field lists it carries are stable strings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cols,
    columnByName,
    footerColumns,
    journalColumns,
    commentColumn,
    titleColumn,
    subtitleColumn,
    JSON.stringify(cfg.detailFields ?? cfg.detail_fields),
  ]);

  /** Flat view of the same fields — for lookups that do not care about rows. */
  const detailColumns = useMemo<ColumnModel[]>(() => detailGroups.flat(), [detailGroups]);

  /** Typed-but-unsaved comment text. Seeded from the card, never from `rowData`
   *  — a re-render mid-typing must not overwrite what is being written. */
  const [commentDraft, setCommentDraft] = useState('');

  useEffect(() => {
    const source = (card?.data ?? {}) as Record<string, unknown>;
    setCommentDraft(commentColumn ? String(source[commentColumn.name] ?? '') : '');
  }, [card, commentColumn]);

  const commentSaved = commentColumn ? String(rowData[commentColumn.name] ?? '') : '';
  const commentDirty = !!commentColumn && commentDraft !== commentSaved;

  /**
   * Optional gate — `commentWhen: { column, equals }`. The box exists only while
   * that cell holds one of the listed values (a comment that only makes sense
   * once the card is archived). No gate configured = the box is always there.
   */
  const commentGate = (cfg.commentWhen ?? cfg.comment_when) as
    | { column?: string; equals?: unknown }
    | undefined;
  const commentVisible = useMemo(() => {
    if (!commentColumn) return false;
    if (!commentGate?.column) return true;
    const expected = Array.isArray(commentGate.equals) ? commentGate.equals : [commentGate.equals];
    const current = String(rowData[commentGate.column] ?? '');
    return expected.some((value) => String(value ?? '') === current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentColumn, rowData, JSON.stringify(cfg.commentWhen ?? cfg.comment_when)]);

  /** Where the box sits: right under this detail field, or below the summary. */
  const commentAfter = asString(cfg.commentAfter ?? cfg.comment_after);

  const photos = useMemo(
    () => (galleryColumn ? parseMediaList(rowData[galleryColumn]) : []),
    [rowData, galleryColumn]
  );

  /**
   * Display order: newest first. The cell stores uploads oldest-first (the
   * widget cover reads its tail), but a card is opened to see what it looks
   * like NOW — so the carousel starts at the latest shot and walks back.
   */
  const orderedPhotos = useMemo(() => [...photos].reverse(), [photos]);

  /** Arrows exist only while the strip still has somewhere to go. */
  const syncArrows = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const max = track.scrollWidth - track.clientWidth;
    setCanScroll({ left: track.scrollLeft > 8, right: track.scrollLeft < max - 8 });
  }, []);

  /** Re-measure when the strip's content changes, not only when it scrolls. */
  useEffect(() => {
    syncArrows();
  }, [orderedPhotos.length, isOpen, syncArrows]);

  /** An arrow travels ~80% of the visible width, so one frame stays on screen. */
  const nudge = (direction: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * track.clientWidth * 0.8, behavior: 'smooth' });
  };

  /**
   * Grab-and-pan for mice: a vertical wheel does nothing to a horizontal strip,
   * so dragging it is the only mouse gesture that scrolls. Touch and trackpads
   * swipe natively and never enter this path.
   */
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  /** A drag that moved must not also open the photo it happened to end on. */
  const suppressClick = useRef(false);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || !trackRef.current) return;
    drag.current = { x: e.clientX, left: trackRef.current.scrollLeft, moved: false };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const track = trackRef.current;
    if (!state || !track) return;
    const delta = e.clientX - state.x;
    if (Math.abs(delta) > 4) state.moved = true;
    track.scrollLeft = state.left - delta;
  };

  const handlePointerUp = () => {
    suppressClick.current = !!drag.current?.moved;
    drag.current = null;
  };

  /**
   * EXIF capture date per photo URL: a timestamp once read, `null` when the file
   * has none. Missing key = still reading; the caption shows the upload date
   * meanwhile and swaps in place. Reads are cached per URL across openings.
   */
  const [captureDates, setCaptureDates] = useState<Record<string, number | null>>({});

  useEffect(() => {
    let cancelled = false;
    photos.forEach((url) => {
      const src = normalizeUrl(url);
      readPhotoCaptureDate(src).then((date) => {
        if (cancelled) return;
        setCaptureDates((prev) => ({ ...prev, [src]: date ? date.getTime() : null }));
      });
    });
    return () => {
      cancelled = true;
    };
  }, [photos]);

  const persist = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!onSave || !card) return;
      const next = { ...rowData, ...patch };
      setSaving(true);
      try {
        await onSave(String(card.id), next);
        setRowData(next);
        setEditingField(null);
      } catch (error) {
        logger.error('[GalleryCardDetailModal] save failed:', error);
      } finally {
        setSaving(false);
      }
    },
    [onSave, card, rowData]
  );

  const startEdit = (name: string) => {
    if (isPublicReadOnly || !onSave) return;
    setDraft(rowData[name] ?? '');
    setEditingField(name);
  };

  const handleRemovePhoto = async (url: string) => {
    if (!galleryColumn || !url) return;
    if (!window.confirm('Удалить это фото из карточки?')) return;
    const remaining = photos.filter((p) => p !== url);
    await persist({ [galleryColumn]: remaining.join(',') });
    // The strip is now shorter — the browser clamps scrollLeft, arrows re-measure.
    syncArrows();
  };

  if (!card) return null;

  const renderValue = (column: ColumnModel, value: unknown) => {
    if (value === null || value === undefined || value === '') {
      return <span className="text-sm italic text-[var(--text-tertiary)]">—</span>;
    }
    switch (column.type) {
      case 'select':
      case 'multi-select': {
        const values = Array.isArray(value) ? value : [value];
        return (
          <div className="flex flex-wrap gap-1">
            {values.map((v, i) => {
              const color = optionColor(column, v);
              return (
                <span
                  key={i}
                  className="inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium"
                  style={
                    color
                      ? { backgroundColor: `${color}20`, color }
                      : { backgroundColor: 'var(--bg-tertiary)' }
                  }
                >
                  {String(v)}
                </span>
              );
            })}
          </div>
        );
      }
      case 'checkbox':
        return (
          <span className={value ? 'text-sm text-green-500' : 'text-sm text-[var(--text-tertiary)]'}>
            {value ? '✓ Да' : '✗ Нет'}
          </span>
        );
      case 'date':
      case 'datetime':
        return (
          <span className="text-sm">
            {new Date(String(value)).toLocaleDateString('ru-RU', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            })}
          </span>
        );
      default:
        return <span className="text-sm text-[var(--text-primary)]">{String(value)}</span>;
    }
  };

  /**
   * The select EDITOR, opened by a double click on the badge: every option is
   * its own pill button, coloured like the badge it replaces. One click sets the
   * value (and `persist` closes the editor); a click on the active pill clears it.
   */
  const renderOptionButtons = (column: ColumnModel) => {
    const current = String(rowData[column.name] ?? '');
    return (
      <div className="flex flex-wrap gap-1.5">
        {columnOptions(column).map((opt) => {
          const value = String(opt.value);
          const active = current === value;
          // Options may carry no colour — fall back to the neutral chip palette.
          const color = opt.color || 'var(--text-secondary)';
          const background = opt.color ? `${opt.color}20` : 'var(--bg-tertiary)';
          return (
            <button
              key={value}
              type="button"
              disabled={saving}
              onClick={() => persist({ [column.name]: active ? '' : value })}
              title={active ? 'Нажмите ещё раз, чтобы очистить' : undefined}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
                active
                  ? ''
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:opacity-80'
              }`}
              style={
                active
                  ? {
                      backgroundColor: `${opt.color || 'var(--bg-tertiary)'}20`,
                      color,
                      boxShadow: `inset 0 0 0 1.5px ${color}`,
                    }
                  : undefined
              }
            >
              {opt.label || value}
            </button>
          );
        })}
      </div>
    );
  };

  const renderEditor = (column: ColumnModel) => {
    switch (column.type) {
      case 'checkbox':
        return (
          <input
            type="checkbox"
            checked={Boolean(draft)}
            onChange={(e) => setDraft(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--border-primary)]"
          />
        );
      case 'date':
      case 'datetime': {
        const raw = String(draft ?? '');
        const value = /^\d{4}-\d{2}-\d{2}$/.test(raw)
          ? raw
          : raw.includes('T')
            ? raw.split('T')[0]
            : '';
        return (
          <Input type="date" value={value} onChange={(e) => setDraft(e.target.value)} className="text-sm" />
        );
      }
      case 'number':
        return (
          <Input
            type="number"
            value={String(draft ?? '')}
            onChange={(e) => setDraft(e.target.value === '' ? '' : Number(e.target.value))}
            autoFocus
            className="text-sm"
          />
        );
      default:
        return (
          <Input
            type="text"
            value={String(draft ?? '')}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            className="text-sm"
          />
        );
    }
  };

  const editActions = (name: string) => (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => persist({ [name]: draft })}
        disabled={saving}
        className="rounded bg-[var(--color-primary-500)] px-2 py-0.5 text-xs text-white hover:bg-[var(--color-primary-600)] disabled:opacity-50"
      >
        {saving ? '...' : 'OK'}
      </button>
      <button
        onClick={() => setEditingField(null)}
        className="rounded px-2 py-0.5 text-xs text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
      >
        Отмена
      </button>
    </div>
  );

  /** One label+value row. Shared by the pre-summary list and the footer list. */
  const renderFieldBlock = (column: ColumnModel) => {
    const editable = !isPublicReadOnly && !!onSave;
    const asDropdown = column.type === 'select' && editable && dropdownFields.has(column.name);
    // A select shows its badge until double-clicked; then the pills are the editor.
    const asPills =
      column.type === 'select' && editable && !asDropdown && editingField === column.name;
    return (
      <div key={column.id || column.name}>
        <label className="mb-1 block text-xs font-medium text-[var(--text-tertiary)]">
          {column.icon ? `${column.icon} ` : ''}
          {column.displayName || column.name}
        </label>
        {asDropdown ? (
          <select
            value={String(rowData[column.name] ?? '')}
            disabled={saving}
            onChange={(e) => persist({ [column.name]: e.target.value })}
            className="w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)] disabled:opacity-50"
          >
            <option value="">—</option>
            {columnOptions(column).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label || opt.value}
              </option>
            ))}
          </select>
        ) : asPills ? (
          <div className="space-y-1.5">
            {renderOptionButtons(column)}
            <button
              onClick={() => setEditingField(null)}
              className="rounded px-2 py-0.5 text-xs text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            >
              Отмена
            </button>
          </div>
        ) : editingField === column.name ? (
          <div className="space-y-1.5">
            {renderEditor(column)}
            {editActions(column.name)}
          </div>
        ) : (
          <div
            className={`-mx-1 rounded px-1 py-0.5 transition${
              isPublicReadOnly ? '' : ' cursor-pointer hover:bg-[var(--bg-tertiary)]'
            }`}
            onDoubleClick={() => startEdit(column.name)}
            title={editHint}
          >
            {renderValue(column, rowData[column.name])}
          </div>
        )}
      </div>
    );
  };

  const summary = summaryColumn ? columnByName.get(summaryColumn) : undefined;
  const titleValue = String(rowData[titleColumn] ?? '') || 'Без названия';
  const subtitleValue = subtitleColumn ? String(rowData[subtitleColumn] ?? '') : '';

  /** Hand-written capture dates by photo URL, `{}` when the column is absent. */
  const manualPhotoDates = useMemo<Record<string, string>>(() => {
    if (!photoDatesColumn) return {};
    const raw = rowData[photoDatesColumn.name] ?? rowData[photoDatesColumn.displayName];
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
      const text = raw.trim();
      if (!text.startsWith('{')) return {};
      try {
        parsed = JSON.parse(text);
      } catch {
        return {};
      }
    }
    if (!parsed || typeof parsed !== 'object') return {};
    const map: Record<string, string> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([url, day]) => {
      if (typeof day === 'string' && day.trim()) map[normalizeUrl(url)] = day.trim();
    });
    return map;
  }, [rowData, photoDatesColumn]);

  /**
   * Caption under the frame: WHEN THE SHOT WAS TAKEN, nothing else. A written-in
   * date wins over EXIF — it is a human correcting the file. A photo whose date
   * is known from neither source gets no caption at all: the upload timestamp is
   * not a shooting date and must never be shown as one.
   */
  const photoDate = (url: string): string => {
    const key = normalizeUrl(url);
    const written = manualPhotoDates[key] ? parseDayString(manualPhotoDates[key]) : null;
    if (written) return formatDay(written);
    const captured = captureDates[key];
    return typeof captured === 'number' ? formatDay(new Date(captured)) : '';
  };

  /**
   * The comment box — always open, no double click needed: you type straight
   * into it and the Save button appears once it differs from what is stored.
   * Rendered either inline under `commentAfter` or directly above the summary.
   * No heading: the placeholder is the whole invitation to write, and a field
   * label over a farewell note turns it back into a form row.
   */
  const commentBox =
    commentColumn && commentVisible ? (
      <div>
        {isPublicReadOnly || !onSave ? (
          <div className="whitespace-pre-wrap rounded-lg bg-[var(--bg-secondary)] p-3 text-sm text-[var(--text-primary)]">
            {commentSaved || <span className="italic text-[var(--text-tertiary)]">—</span>}
          </div>
        ) : (
          <>
            <textarea
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setCommentDraft(commentSaved);
              }}
              rows={4}
              placeholder="почему меня не стало..🥀"
              className="w-full resize-y rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
            />
            {commentDirty && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <button
                  onClick={() => persist({ [commentColumn.name]: commentDraft })}
                  disabled={saving}
                  className="rounded bg-[var(--color-primary-500)] px-2 py-0.5 text-xs text-white hover:bg-[var(--color-primary-600)] disabled:opacity-50"
                >
                  {saving ? '...' : 'Сохранить'}
                </button>
                <button
                  onClick={() => setCommentDraft(commentSaved)}
                  className="rounded px-2 py-0.5 text-xs text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                >
                  Отмена
                </button>
              </div>
            )}
          </>
        )}
      </div>
    ) : null;

  /** Inline only if the anchor field is actually on screen; otherwise below the summary. */
  const commentInline = !!commentBox && detailColumns.some((c) => c.name === commentAfter);

  return (
    <>
      {/* `heightOffset` is a desktop margin; on a phone the popup takes the whole
          dynamic viewport. `!` is what beats Modal's inline `calc(100vh - …)`.
          The centering (`top-1/2` + `-translate-y-1/2`) is dropped there too:
          Safari lays a fixed element out against the viewport WITHOUT the
          toolbar, so a 100dvh box centred in it hangs off the bottom edge.
          Pinned to 0,0 the sheet is exactly the screen, whatever the toolbar does. */}
      <Modal
        open={isOpen}
        onOpenChange={(v) => !v && onClose()}
        size="2xl"
        fixedHeight
        heightOffset={100}
        className="!p-0 max-sm:!left-0 max-sm:!top-0 max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-[100vw] max-sm:!translate-x-0 max-sm:!translate-y-0"
      >
        <div className="-mr-2 -mt-4 flex h-full min-h-0 flex-col">
          {/* Stacked and scrolled as one on a phone, two independent columns from `sm` up. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto sm:flex-row sm:overflow-hidden">
            {/* LEFT — care fields + summary. Second in the stack: on a phone the
                photos are what the card is opened for. */}
            <div className="order-2 w-full flex-shrink-0 border-t border-[var(--border-primary)] p-4 sm:order-1 sm:w-[340px] sm:overflow-y-auto sm:border-r sm:border-t-0">
              <div className="space-y-3">
                {detailGroups.map((group, index) => (
                  <Fragment key={group.map((c) => c.id || c.name).join('|') || index}>
                    {group.length > 1 ? (
                      // Equal shares of the 340px column: `minmax(0, 1fr)` lets a
                      // long value wrap inside its share instead of widening it.
                      <div
                        className="grid gap-3"
                        style={{ gridTemplateColumns: `repeat(${group.length}, minmax(0, 1fr))` }}
                      >
                        {group.map(renderFieldBlock)}
                      </div>
                    ) : (
                      renderFieldBlock(group[0])
                    )}
                    {commentInline && group.some((c) => c.name === commentAfter) && commentBox}
                  </Fragment>
                ))}
              </div>

              {/* Above the summary: the gate makes it an archived card's farewell
                  note, and it must be the first thing read, not a footnote. */}
              {!commentInline && commentBox && <div className="mt-5">{commentBox}</div>}

              {/* The AI journal sits ABOVE the summary: it is the freshest
                  reading of the plant, and the summary underneath is the slower
                  human note. Its own window, its own scroll — see
                  CardAnalysisBlock for why it is not just markdown. */}
              {journalColumns.map((column) => (
                <div key={column.id || column.name} className="mt-5">
                  <CardAnalysisBlock
                    column={column}
                    content={String(rowData[column.name] ?? '')}
                    editable={!isPublicReadOnly && !!onSave}
                    editing={editingField === column.name}
                    draft={String(draft ?? '')}
                    saving={saving}
                    editHint={editHint}
                    onDraftChange={setDraft}
                    onStartEdit={() => startEdit(column.name)}
                    onSubmit={() => persist({ [column.name]: draft })}
                    onCancel={() => setEditingField(null)}
                  />
                </div>
              ))}

              {summary && (
                <div className="mt-5">
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                    {summary.icon ? `${summary.icon} ` : ''}
                    {summary.displayName || summary.name}
                  </label>
                  {editingField === summary.name ? (
                    <div className="space-y-2">
                      <textarea
                        value={String(draft ?? '')}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={16}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setEditingField(null);
                        }}
                        className="w-full resize-y rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
                      />
                      {editActions(summary.name)}
                    </div>
                  ) : (
                    <div
                      className={`rounded-lg bg-[var(--bg-secondary)] p-3 transition${
                        isPublicReadOnly ? '' : ' cursor-pointer hover:bg-[var(--bg-tertiary)]'
                      }`}
                      onDoubleClick={() => startEdit(summary.name)}
                      title={editHint}
                    >
                      {rowData[summary.name] ? (
                        <MarkdownPreview content={String(rowData[summary.name])} className="text-sm" />
                      ) : (
                        <p className="text-sm italic text-[var(--text-tertiary)]">—</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {footerColumns.filter((c) => c.name !== commentColumn?.name).length > 0 && (
                <div className="mt-5 space-y-3 border-t border-[var(--border-primary)] pt-4">
                  {footerColumns
                    .filter((c) => c.name !== commentColumn?.name)
                    .map(renderFieldBlock)}
                </div>
              )}
            </div>

            {/* RIGHT — title, subtitle, photo strip. First in the phone stack. */}
            <div className="order-1 flex w-full min-w-0 flex-shrink-0 flex-col bg-[var(--bg-primary)] p-4 sm:order-2 sm:w-auto sm:flex-1 sm:overflow-y-auto sm:p-5">
              {editingField === titleColumn ? (
                <div className="space-y-2">
                  <Input
                    type="text"
                    value={String(draft ?? '')}
                    onChange={(e) => setDraft(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') persist({ [titleColumn]: draft });
                      if (e.key === 'Escape') setEditingField(null);
                    }}
                    className="text-xl font-semibold"
                  />
                  {editActions(titleColumn)}
                </div>
              ) : (
                <h2
                  // `pr-10` on a phone: the modal's own × sits at the top-right
                  // corner, and the heading now starts right under it.
                  className={`-mx-2 rounded px-2 py-1 text-2xl font-semibold leading-tight text-[var(--text-primary)] transition max-sm:pr-10 max-sm:text-xl${
                    isPublicReadOnly ? '' : ' cursor-pointer hover:bg-[var(--bg-secondary)]'
                  }`}
                  onDoubleClick={() => startEdit(titleColumn)}
                  title={editHint}
                >
                  {titleValue}
                </h2>
              )}

              {subtitleColumn &&
                (editingField === subtitleColumn ? (
                  <div className="mt-2 space-y-2">
                    <Input
                      type="text"
                      value={String(draft ?? '')}
                      onChange={(e) => setDraft(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') persist({ [subtitleColumn]: draft });
                        if (e.key === 'Escape') setEditingField(null);
                      }}
                      className="text-sm"
                    />
                    {editActions(subtitleColumn)}
                  </div>
                ) : (
                  <p
                    className={`-mx-2 mt-1 rounded px-2 py-0.5 text-sm italic text-[var(--text-tertiary)] transition${
                      isPublicReadOnly ? '' : ' cursor-pointer hover:bg-[var(--bg-secondary)]'
                    }`}
                    onDoubleClick={() => startEdit(subtitleColumn)}
                    title={editHint}
                  >
                    {subtitleValue || '—'}
                  </p>
                ))}

              {galleryColumn && (
                <div className="mt-5">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                      Галерея
                    </span>
                    {orderedPhotos.length > 0 && (
                      <span className="text-[11px] tabular-nums text-[var(--text-tertiary)]">
                        {orderedPhotos.length} фото
                      </span>
                    )}
                  </div>

                  <div className="relative">
                    {/* ONE continuous strip: every photo at full frame height and
                        its own width, newest first. Touch swipes it natively, a
                        mouse grabs and pans it, the arrows and ←/→ move the same
                        scroll container. */}
                    <div
                      ref={trackRef}
                      onScroll={syncArrows}
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerLeave={handlePointerUp}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowRight') {
                          e.preventDefault();
                          nudge(1);
                        }
                        if (e.key === 'ArrowLeft') {
                          e.preventDefault();
                          nudge(-1);
                        }
                      }}
                      tabIndex={0}
                      className="flex snap-x items-stretch gap-3 overflow-x-auto rounded-lg outline-none max-sm:snap-mandatory max-sm:gap-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    >
                      {orderedPhotos.map((url, index) => {
                        const src = normalizeUrl(url);
                        const text = photoDate(url);
                        return (
                          // On a phone one frame IS the strip's width: swipe = next
                          // photo, instead of a row of slivers you have to nudge.
                          <div
                            key={`${url}-${index}`}
                            className="group relative flex-shrink-0 snap-start max-sm:w-full"
                          >
                            <img
                              src={src}
                              alt={`${titleValue} — фото ${index + 1}`}
                              loading={index < 3 ? 'eager' : 'lazy'}
                              draggable={false}
                              onClick={() => {
                                // A pan that ended on this photo is not a click on it.
                                if (suppressClick.current) {
                                  suppressClick.current = false;
                                  return;
                                }
                                setPreviewFile({
                                  id: `photo-${index}`,
                                  name: decodeURIComponent(src.split('/').pop() || 'photo'),
                                  size: 0,
                                  type: 'image/*',
                                  url: src,
                                  uploadedAt: new Date(),
                                });
                              }}
                              className={`${FRAME_HEIGHT} w-auto max-w-[80vw] cursor-zoom-in select-none rounded-lg bg-[var(--bg-tertiary)] object-contain max-sm:w-full max-sm:max-w-none`}
                            />

                            {text && (
                              <div
                                title="Дата съёмки"
                                className="truncate pt-1.5 text-center text-[11px] text-[var(--text-tertiary)]"
                              >
                                {text}
                              </div>
                            )}

                            {!isPublicReadOnly && onSave && (
                              <button
                                onClick={() => handleRemovePhoto(url)}
                                disabled={saving}
                                title="Удалить фото"
                                aria-label={`Удалить фото ${index + 1}`}
                                className="absolute right-2 top-2 rounded-md bg-black/55 p-1.5 text-white opacity-0 backdrop-blur-sm transition hover:bg-black/75 focus:opacity-100 group-hover:opacity-100"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        );
                      })}

                      {orderedPhotos.length === 0 && (
                        <div
                          className={`${FRAME_HEIGHT} flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-[var(--border-primary)] text-sm text-[var(--text-tertiary)]`}
                        >
                          Фотографий пока нет
                        </div>
                      )}
                    </div>

                    {canScroll.left && (
                      <button
                        onClick={() => nudge(-1)}
                        aria-label="Листать влево"
                        // Hidden on a phone: the frame is full-width there, so an
                        // overlay arrow would sit on top of the photo it scrolls
                        // past — and a swipe already does the same job.
                        className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white backdrop-blur-sm transition hover:bg-black/70 max-sm:hidden"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                    )}
                    {canScroll.right && (
                      <button
                        onClick={() => nudge(1)}
                        aria-label="Листать вправо"
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white backdrop-blur-sm transition hover:bg-black/70 max-sm:hidden"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    )}
                  </div>

                </div>
              )}
            </div>
          </div>

          {/* Bottom bar clears the iPhone home indicator — otherwise «Закрыть»
              sits half under it and is hard to hit. */}
          <div
            className="flex flex-shrink-0 justify-end border-t border-[var(--border-primary)] px-5 py-3"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
          >
            <button
              onClick={onClose}
              className="rounded-lg border border-[var(--border-primary)] px-4 py-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            >
              Закрыть
            </button>
          </div>
        </div>
      </Modal>

      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
    </>
  );
}
