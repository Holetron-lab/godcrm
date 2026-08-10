/**
 * RowCardsWidget — neutral, domain-agnostic card/list renderer for CRM rows.
 *
 * Renders an array of arbitrary rows as cards (or a single-column list) using
 * the standard CRM design tokens — surface/border/text — NOT the landing's
 * brutal style. Field mapping is supplied by the caller via accessor props
 * (`primary`/`secondary`/`meta`/`linkTo`/`coverUrl`), so the same component
 * works for blog posts, tickets, docs, or anything else: one component, many
 * mappings.
 *
 * Data fetching lives at the call site on purpose — the public surface exposes
 * rows through several endpoints (table rows, documents-widget registry…), so
 * keeping this presentational makes it reusable across all of them.
 *
 * States: `isLoading` → skeleton cards; empty (and not loading) → renders
 * `null` so the caller's surrounding section disappears cleanly.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export type RowCardsBorderRadius = 'none' | 'sm' | 'md' | 'lg';

const RADIUS_TOKEN: Record<RowCardsBorderRadius, string> = {
  none: '0',
  sm: 'var(--radius-sm)',
  md: 'var(--radius-md)',
  lg: 'var(--radius-lg)',
};

const COLUMN_CLASS: Record<1 | 2 | 3, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
};

const clamp2: React.CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

export interface RowCardsWidgetProps<T> {
  rows: T[];
  /** Stable key per row (id, slug…). */
  getKey: (row: T) => string | number;
  /** Card title. */
  primary: (row: T) => ReactNode;
  /** Excerpt / supporting line (clamped to 2 lines). */
  secondary?: (row: T) => ReactNode;
  /** Small mono chips above the title — e.g. date, tag. Empty strings dropped. */
  meta?: (row: T) => Array<string | null | undefined>;
  /** Internal route to navigate to on click. Returning undefined = not a link. */
  linkTo?: (row: T) => string | undefined;
  /** Optional cover image URL rendered above the body. */
  coverUrl?: (row: T) => string | undefined;
  isLoading?: boolean;
  skeletonCount?: number;
  /** Adjustable corner radius (CRM token). Default `md`. */
  borderRadius?: RowCardsBorderRadius;
  /** 1 = list, 2/3 = responsive card grid. Default 1. */
  columns?: 1 | 2 | 3;
  /** Drop the card surface fill (border-only). For flat/brutal backgrounds. */
  transparent?: boolean;
  className?: string;
  /** Accessible label for the list container. */
  ariaLabel?: string;
}

export function RowCardsWidget<T>({
  rows,
  getKey,
  primary,
  secondary,
  meta,
  linkTo,
  coverUrl,
  isLoading = false,
  skeletonCount = 3,
  borderRadius = 'md',
  columns = 1,
  transparent = false,
  className,
  ariaLabel,
}: RowCardsWidgetProps<T>) {
  const radius = RADIUS_TOKEN[borderRadius];
  const gridClass = `grid gap-3 ${COLUMN_CLASS[columns]}${className ? ` ${className}` : ''}`;

  if (isLoading) {
    return (
      <div className={gridClass} aria-busy="true" aria-label={ariaLabel}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4"
            style={{ borderRadius: radius }}
          >
            <div className="mb-3 h-2.5 w-24 rounded bg-[var(--bg-tertiary)]" />
            <div className="mb-2 h-4 w-3/4 rounded bg-[var(--bg-tertiary)]" />
            <div className="h-3 w-full rounded bg-[var(--bg-tertiary)]" />
          </div>
        ))}
      </div>
    );
  }

  if (rows.length === 0) return null;

  return (
    <ul className={gridClass} aria-label={ariaLabel}>
      {rows.map((row) => {
        const key = getKey(row);
        const chips = (meta?.(row) ?? []).filter((c): c is string => !!c && c.trim() !== '');
        const href = linkTo?.(row);
        const cover = coverUrl?.(row);

        const inner = (
          <>
            {cover && (
              <img
                src={cover}
                alt=""
                loading="lazy"
                className="mb-3 aspect-video w-full object-cover"
                style={{ borderRadius: `calc(${radius} - 1px)` }}
              />
            )}
            {chips.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] uppercase tracking-wider text-[var(--text-tertiary)]">
                {chips.map((chip, i) => (
                  <span key={i} className="inline-flex items-center gap-2">
                    {i > 0 && <span aria-hidden>·</span>}
                    {chip}
                  </span>
                ))}
              </div>
            )}
            <div className="text-base font-semibold leading-snug text-[var(--text-primary)]">
              {primary(row)}
            </div>
            {secondary && (
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]" style={clamp2}>
                {secondary(row)}
              </p>
            )}
          </>
        );

        const cardClass = `block h-full border border-[var(--border-primary)] p-4 transition-colors${
          transparent ? '' : ' bg-[var(--bg-secondary)]'
        }`;

        return (
          <li key={key}>
            {href ? (
              <Link
                to={href}
                className={`${cardClass} hover:border-[var(--color-primary-500)]`}
                style={{ borderRadius: radius }}
              >
                {inner}
              </Link>
            ) : (
              <div className={cardClass} style={{ borderRadius: radius }}>
                {inner}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default RowCardsWidget;
