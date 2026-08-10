/**
 * ADR-0017 Phase 3 — JSON cell renderer.
 *
 * Compact left-aligned preview. The value is shown as raw JSON text
 * (pretty or single-line per `prettyInCell`) clamped to `previewLines`
 * with a CSS trailing ellipsis so the visible last line ends in `…`
 * when content overflows the cell.
 *
 * No "JSON" badge — keeps the cell flush-left and visually quiet.
 */

import type { CSSProperties } from 'react';
import type { JsonColumnConfig } from '../../types/table.types';

interface JsonCellProps {
  value: unknown;
  config?: JsonColumnConfig;
  rawMode?: boolean;
}

const DEFAULT_PREVIEW_LINES = 3;

const stringify = (val: unknown, pretty: boolean): { text: string; isObject: boolean } => {
  if (val === null || val === undefined) return { text: '', isObject: false };

  if (typeof val === 'object') {
    return { text: JSON.stringify(val, null, pretty ? 2 : 0), isObject: true };
  }

  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return { text: JSON.stringify(parsed, null, pretty ? 2 : 0), isObject: true };
      } catch {
        return { text: val, isObject: false };
      }
    }
    return { text: val, isObject: false };
  }

  return { text: String(val), isObject: false };
};

export const JsonCell = ({ value, config, rawMode }: JsonCellProps) => {
  if (value === null || value === undefined || value === '') {
    return <span className="text-[var(--text-tertiary)]">—</span>;
  }

  if (rawMode) {
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    return (
      <span className="text-xs font-mono text-[var(--text-primary)] truncate block max-w-full" title={raw}>
        {raw}
      </span>
    );
  }

  const pretty = config?.prettyInCell ?? true;
  const maxLinesRaw = config?.previewLines ?? DEFAULT_PREVIEW_LINES;
  const maxLines = Math.max(1, Math.min(10, Math.round(maxLinesRaw)));

  const { text } = stringify(value, pretty);

  if (!text) {
    return <span className="text-[var(--text-tertiary)]">—</span>;
  }

  const clampStyle: CSSProperties = {
    display: '-webkit-box',
    WebkitLineClamp: maxLines,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    margin: 0,
    lineHeight: '1.25',
  };

  return (
    <pre
      className="text-xs font-mono text-[var(--text-secondary)] w-full text-left"
      style={clampStyle}
      title={text}
    >
      {text}
    </pre>
  );
};
