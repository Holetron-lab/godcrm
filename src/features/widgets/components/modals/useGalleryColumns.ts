import { useMemo } from 'react';
import type { ColumnModel } from '@/features/tables/types/table.types';

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

export const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [];

export function useGalleryColumns(columns: ColumnModel[], config: Record<string, unknown> | undefined, titleField: string | undefined) {
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
          .filter((c) => ['long_text', 'rich_text'].includes(c.type) && isJournalColumn(c))
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

  return { cfg, columnByName, titleColumn, subtitleColumn, galleryColumn, summaryColumn, dropdownFields, footerColumns, journalColumns, commentColumn, photoDatesColumn, detailGroups, detailColumns };
}
