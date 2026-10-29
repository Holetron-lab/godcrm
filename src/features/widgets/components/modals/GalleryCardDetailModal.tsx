import { useRequestedFocus } from '@/shared/hooks/useRequestedFocus';
import { useGalleryColumns, asString } from './useGalleryColumns';
import { parseMediaList, normalizeUrl, parseDayString, formatDay, columnOptions, renderValue } from './galleryCardValues';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { logger } from '@/shared/utils/logger';
import { Input } from '@/shared/components/ui';
import { Modal } from '@/shared/components/ui/Modal';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import { readPhotoCaptureDate } from '../../utils/photoCaptureDate';
import { CardAnalysisBlock } from './CardAnalysisBlock';
import { useIsPublicReadOnly } from '@/features/public/PublicViewContext';
import type { ColumnModel } from '@/features/tables/types/table.types';
import type { AttachedFile, CardDetailModalProps } from './card-detail-types';
import { FilePreviewModal } from './FilePreviewModal';

/** Gallery detail: configured fields, editable values and a dated photo strip. */
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
  const editInputRef = useRequestedFocus<HTMLInputElement>(isOpen ? editingField : null);
  const editTextRef = useRequestedFocus<HTMLTextAreaElement>(isOpen ? editingField : null);
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

  const { cfg, columnByName, titleColumn, subtitleColumn, galleryColumn, summaryColumn,
    dropdownFields, footerColumns, journalColumns, commentColumn, photoDatesColumn,
    detailGroups, detailColumns } = useGalleryColumns(columns, config, titleField);

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

  if (!card) return null;

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
            ref={editInputRef}
            className="text-sm"
          />
        );
      default:
        return (
          <Input
            type="text"
            value={String(draft ?? '')}
            onChange={(e) => setDraft(e.target.value)}
            ref={editInputRef}
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
                        ref={editTextRef}
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
                    ref={editInputRef}
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
                      ref={editInputRef}
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
                    <div role="presentation"
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
                            <button type="button" className="block max-sm:w-full rounded-lg focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]" onClick={() => {
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
                              }}>
                              <img
                                src={src}
                                alt={`${titleValue} — фото ${index + 1}`}
                                loading={index < 3 ? 'eager' : 'lazy'}
                                draggable={false}
                                className={`${FRAME_HEIGHT} w-auto max-w-[80vw] cursor-zoom-in select-none rounded-lg bg-[var(--bg-tertiary)] object-contain max-sm:w-full max-sm:max-w-none`}
                              />
                            </button>
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
