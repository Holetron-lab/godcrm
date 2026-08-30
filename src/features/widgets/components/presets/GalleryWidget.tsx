import { Fragment, useMemo } from 'react';
import type { Widget } from '../../types/widget.types';
import type { ColumnInfo } from './TableViewWidget';

/**
 * Row data item with id and data fields. Structurally the shared `TicketRowData`
 * the dashboard hands every preset — `base_id` is read through the index
 * signature rather than declared, so the two stay assignable.
 */
interface GalleryRowItem {
  id?: string | number;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

interface GalleryWidgetProps {
  widget: Widget;
  data: GalleryRowItem[];
  /** Real column schema — enables typed chips (select colors, date formatting). Optional. */
  columnsInfo?: ColumnInfo[];
  onCardClick?: (card: GalleryRowItem) => void;
}

/** Column types that can carry one or more image URLs. */
const MEDIA_COLUMN_TYPES = new Set(['file', 'image', 'photo', 'attachment']);

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg|bmp|heic)(\?|#|$)/i;

/**
 * A media cell holds either a single URL or a comma-separated list (the same
 * storage format `CardDetailModal` writes for `file` columns). Returns the list
 * in stored order — oldest first, newest last.
 */
function parseMediaList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? '').trim()).filter(Boolean);
  }
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}

/** Keep relative URLs relative so images resolve against the current origin. */
function normalizeUrl(url: string): string {
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  return url.startsWith('/') ? url : `/${url}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

function formatValue(value: unknown, type?: string): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  const raw = String(value);
  if (type === 'date' || ISO_DATE.test(raw)) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
    }
  }
  return raw;
}

interface SelectOption {
  value?: string;
  label?: string;
  color?: string;
}

function optionColor(col: ColumnInfo | undefined, value: unknown): string | undefined {
  const options = col?.config?.options as SelectOption[] | undefined;
  if (!Array.isArray(options)) return undefined;
  return options.find((o) => o.value === String(value))?.color;
}

/** Config values arrive from JSON, so narrow them instead of trusting the type. */
const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [];

/**
 * Cover framing. `auto` (default) lets the card take the photo's own
 * proportions, so a portrait phone shot is shown whole instead of being
 * centre-cropped to a square. Fixed ratios stay available for boards that
 * want a rigid grid.
 */
const COVER_ASPECT_CLASS: Record<string, string> = {
  square: 'aspect-square',
  portrait: 'aspect-[3/4]',
  landscape: 'aspect-[4/3]',
};

/** Space reserved before a natural-height image loads, and for cover-less cards. */
const PLACEHOLDER_ASPECT = 'aspect-[3/4]';

/**
 * Archived cards sink below the live ones and their cover goes black-and-white.
 * The state column is `statusColumn` in config; with none set, the first select
 * column that offers an "Архив"-like option is used, so a board only has to name
 * the state — no widget config needed.
 */
const DEFAULT_ARCHIVED_VALUES = ['Архив', 'Архивировано', 'Archive', 'Archived'];

const looksArchived = (value: string): boolean => /^\s*(архив|archiv)/i.test(value);

/**
 * Live cards are ordered by the date the row appeared in the collection
 * ("В доме с"), oldest first. `sortColumn` names it explicitly; with none set
 * the first date column whose name talks about the house/arrival is used, and
 * any date column serves as the fallback. `sortDirection: "desc"` flips it.
 * Rows with an empty date keep to the end of the live group.
 */
const DATE_COLUMN_TYPES = new Set(['date', 'datetime', 'timestamp']);

const looksLikeArrivalDate = (name: string): boolean => /дом|появ|arriv|since|added/i.test(name);

/** Milliseconds for a date cell, or null when it is empty or unparseable. */
function dateValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const time = new Date(String(value)).getTime();
  return Number.isNaN(time) ? null : time;
}

export function GalleryWidget({ widget, data, columnsInfo, onCardClick }: GalleryWidgetProps) {
  const config = (widget.config || {}) as Record<string, unknown>;
  const titleColumn = asString(config.titleColumn ?? config.title_column, 'name');
  const descriptionColumn = asString(config.descriptionColumn ?? config.description_column, 'description');
  const cardsPerRow = Number(config.cardsPerRow ?? config.cards_per_row) || 3;
  /**
   * Fine tuning on top of `cardsPerRow`: the column count is a whole number, so
   * it can only resize cards in ~25% steps. `cardScale` narrows the grid inside
   * the widget instead, keeping the same number of cards per row and the same
   * gutters — the slack shows up as margins on both sides. 1 = full width.
   */
  const cardScale = Math.min(1, Math.max(0.4, Number(config.cardScale ?? config.card_scale) || 1));
  /**
   * By default the column count steps down on narrow screens (a 4-wide grid
   * becomes 3 on a laptop, 2 on a phone). With `fixedCardsPerRow` the desktop
   * count holds at every width from `sm` up, so a board looks the same on any
   * computer; below `sm` (phones) it still falls back to 2 columns.
   */
  const fixedCardsPerRow = config.fixedCardsPerRow === true || config.fixed_cards_per_row === true;
  const progressColumn = asString(config.progressColumn ?? config.progress_column);
  /**
   * Optional counter line above the grid: "<countLabel>: <n>", where n is the
   * number of live (non-archived) cards. Off unless a board names the label, so
   * galleries that never asked for it look exactly as before.
   */
  const countLabel = asString(config.countLabel ?? config.count_label);
  const emptyIcon = asString(config.emptyIcon, '🖼️');
  const coverAspect = COVER_ASPECT_CLASS[asString(config.coverAspect ?? config.cover_aspect, 'auto')];

  const columnMap = useMemo(() => {
    const map = new Map<string, ColumnInfo>();
    (Array.isArray(columnsInfo) ? columnsInfo : []).forEach((c) => map.set(c.name, c));
    return map;
  }, [columnsInfo]);

  /**
   * Ordered list of columns to look in for the cover image. Explicit config wins;
   * anything else that is a media column is used as a fallback, so a plant with
   * an empty growth gallery still shows its single legacy photo.
   */
  const explicitCovers = asString(config.coverColumn ?? config.cover_column);
  const coverFallbacks = asStringArray(config.coverFallbackColumns ?? config.cover_fallback_columns).join(',');
  const coverCandidates = useMemo<string[]>(() => {
    const explicit = [explicitCovers, ...coverFallbacks.split(',')].filter(Boolean);

    const auto = (Array.isArray(columnsInfo) ? columnsInfo : [])
      .filter((c) => MEDIA_COLUMN_TYPES.has(c.type))
      .map((c) => c.name);

    return Array.from(new Set([...explicit, ...auto]));
  }, [explicitCovers, coverFallbacks, columnsInfo]);

  /** State column + the values that count as "archived". */
  const explicitStatus = asString(config.statusColumn ?? config.status_column);
  const statusColumn = useMemo<string>(() => {
    if (explicitStatus) return explicitStatus;
    const auto = (Array.isArray(columnsInfo) ? columnsInfo : []).find(
      (c) =>
        c.type === 'select' &&
        ((c.config?.options as SelectOption[] | undefined) || []).some((o) =>
          looksArchived(String(o?.value ?? ''))
        )
    );
    return auto?.name || '';
  }, [explicitStatus, columnsInfo]);

  const archivedValuesKey = asStringArray(config.archivedValues ?? config.archived_values).join(',');
  const archivedValues = useMemo<Set<string>>(() => {
    const listed = archivedValuesKey.split(',').filter(Boolean);
    return new Set((listed.length > 0 ? listed : DEFAULT_ARCHIVED_VALUES).map((v) => v.toLowerCase()));
  }, [archivedValuesKey]);

  /** Date column that orders the live cards. */
  const explicitSort = asString(config.sortColumn ?? config.sort_column);
  const sortColumn = useMemo<string>(() => {
    if (explicitSort) return explicitSort;
    const dates = (Array.isArray(columnsInfo) ? columnsInfo : []).filter((c) =>
      DATE_COLUMN_TYPES.has(c.type)
    );
    const byName = dates.find(
      (c) => looksLikeArrivalDate(c.name) || looksLikeArrivalDate(c.displayName || '')
    );
    return (byName || dates[0])?.name || '';
  }, [explicitSort, columnsInfo]);

  const sortDesc =
    asString(config.sortDirection ?? config.sort_direction, 'asc').toLowerCase() === 'desc';

  /** Columns rendered as compact chips under the title. */
  const metaColumnsKey = asStringArray(config.metaColumns ?? config.meta_columns).join(',');
  const metaColumns = useMemo<string[]>(
    () => metaColumnsKey.split(',').filter(Boolean),
    [metaColumnsKey]
  );

  const cards = useMemo(() => {
    const mapped = data.map((row) => {
      const rowData = (row.data || row) as Record<string, unknown>;

      // Cover = the LAST photo of the first non-empty media column (newest upload).
      let photos: string[] = [];
      for (const colName of coverCandidates) {
        const list = parseMediaList(rowData[colName]).filter(
          (u) => IMAGE_EXT.test(u) || !u.includes('.')
        );
        if (list.length > 0) {
          photos = list;
          break;
        }
      }

      const meta = metaColumns
        .map((name) => {
          const col = columnMap.get(name);
          const text = formatValue(rowData[name], col?.type);
          if (!text) return null;
          return {
            name,
            label: col?.displayName || name,
            text,
            color: optionColor(col, rowData[name]),
          };
        })
        .filter(Boolean) as Array<{ name: string; label: string; text: string; color?: string }>;

      return {
        id: String(row.id ?? row.base_id ?? ''),
        title: String(rowData[titleColumn] ?? '') || 'Без названия',
        description: String(rowData[descriptionColumn] ?? ''),
        cover: photos.length > 0 ? normalizeUrl(photos[photos.length - 1]) : null,
        photoCount: photos.length,
        meta,
        progress: progressColumn ? Number(rowData[progressColumn]) || 0 : null,
        archived:
          !!statusColumn &&
          archivedValues.has(String(rowData[statusColumn] ?? '').trim().toLowerCase()),
        sortAt: sortColumn ? dateValue(rowData[sortColumn]) : null,
        raw: row,
      };
    });

    // Archived always below actual. Inside the live group the arrival date
    // decides; a card without one sinks to the bottom of that group. The
    // archived tail keeps the incoming row order (`sort` is stable, ES2019).
    return mapped.sort((a, b) => {
      if (a.archived !== b.archived) return Number(a.archived) - Number(b.archived);
      if (a.archived) return 0;
      if (a.sortAt === b.sortAt) return 0;
      if (a.sortAt === null) return 1;
      if (b.sortAt === null) return -1;
      return sortDesc ? b.sortAt - a.sortAt : a.sortAt - b.sortAt;
    });
  }, [
    data,
    titleColumn,
    descriptionColumn,
    coverCandidates,
    metaColumns,
    columnMap,
    progressColumn,
    statusColumn,
    archivedValues,
    sortColumn,
    sortDesc,
  ]);

  if (cards.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-tertiary)]">
        <div className="text-center">
          <div className="text-4xl mb-2">📭</div>
          <div>Пока пусто</div>
        </div>
      </div>
    );
  }

  // Grid columns based on cardsPerRow. Class strings stay literal so Tailwind's
  // JIT scanner keeps them — never interpolate the count into a class name.
  const gridCols = fixedCardsPerRow
    ? {
        1: 'grid-cols-1',
        2: 'grid-cols-2',
        3: 'grid-cols-2 sm:grid-cols-3',
        4: 'grid-cols-2 sm:grid-cols-4',
        5: 'grid-cols-2 sm:grid-cols-5',
      }[cardsPerRow] || 'grid-cols-2 sm:grid-cols-3'
    : {
        1: 'grid-cols-1',
        2: 'grid-cols-1 sm:grid-cols-2',
        3: 'grid-cols-2 sm:grid-cols-2 lg:grid-cols-3',
        4: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
        5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
      }[cardsPerRow] || 'grid-cols-2 sm:grid-cols-2 lg:grid-cols-3';

  // Where the archived tail starts — the rule is drawn immediately before it.
  // -1 (no archive) or 0 (everything archived) means no rule is rendered.
  const firstArchivedIndex = cards.findIndex((c) => c.archived);

  const liveCount = cards.reduce((n, c) => n + (c.archived ? 0 : 1), 0);

  return (
    <div className="h-full overflow-auto p-4 bg-[var(--bg-secondary)]">
      {countLabel && (
        <div className="mb-3 text-left text-xs text-[var(--text-tertiary)]">
          {countLabel}:{' '}
          <span className="font-semibold text-[var(--text-secondary)]">{liveCount}</span>
        </div>
      )}
      <div
        className={`grid ${gridCols} gap-3 items-start mx-auto`}
        style={cardScale < 1 ? { maxWidth: `${cardScale * 100}%` } : undefined}
      >
        {cards.map((card, index) => (
          <Fragment key={card.id}>
            {/* Thin grey rule + heading: everything below it is archived. */}
            {index === firstArchivedIndex && index > 0 && (
              <div className="col-span-full my-2">
                <div className="h-px bg-[var(--border-primary)]" />
                <div className="mt-2 text-left text-lg leading-none select-none" title="Архив">
                  🥀
                </div>
              </div>
            )}
          <div
            onClick={() => onCardClick?.(card.raw)}
            className="group flex flex-col bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] overflow-hidden hover:shadow-lg hover:border-[var(--color-primary-500)] transition-all cursor-pointer"
          >
            {/* Cover — latest photo from the gallery column, uncropped by default.
                Archived cards show it desaturated, so the board reads at a glance. */}
            <div
              className={`relative bg-[var(--bg-tertiary)] overflow-hidden ${
                coverAspect || 'min-h-[6rem]'
              }${card.archived ? ' grayscale-[0.95] brightness-110' : ''}`}
            >
              {card.cover ? (
                <img
                  src={card.cover}
                  alt={card.title}
                  loading="lazy"
                  className={
                    coverAspect
                      ? 'w-full h-full object-cover group-hover:scale-105 transition-transform duration-300'
                      : 'block w-full h-auto group-hover:scale-105 transition-transform duration-300'
                  }
                />
              ) : (
                <div
                  className={`w-full flex items-center justify-center text-3xl opacity-40 ${
                    coverAspect ? 'h-full' : PLACEHOLDER_ASPECT
                  }`}
                >
                  {emptyIcon}
                </div>
              )}

              {card.photoCount > 1 && (
                <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-black/55 text-white text-[10px] font-medium backdrop-blur-sm">
                  📷 {card.photoCount}
                </span>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 p-3">
              <h3 className="font-semibold text-sm text-[var(--text-primary)] leading-tight line-clamp-2">
                {card.title}
              </h3>

              {card.description && (
                <p className="mt-0.5 text-xs italic text-[var(--text-tertiary)] line-clamp-1">
                  {card.description}
                </p>
              )}

              {card.meta.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {card.meta.map((m) => (
                    <span
                      key={m.name}
                      title={`${m.label}: ${m.text}`}
                      className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--bg-tertiary)] text-[var(--text-secondary)] max-w-full truncate"
                      style={m.color ? { backgroundColor: `${m.color}22`, color: m.color } : undefined}
                    >
                      {m.text}
                    </span>
                  ))}
                </div>
              )}

              {/* Progress Bar */}
              {card.progress !== null && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-[10px] text-[var(--text-tertiary)] mb-1">
                    <span>Прогресс</span>
                    <span>{card.progress}%</span>
                  </div>
                  <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--color-primary-500)] rounded-full transition-all"
                      style={{ width: `${Math.min(100, Math.max(0, card.progress))}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
