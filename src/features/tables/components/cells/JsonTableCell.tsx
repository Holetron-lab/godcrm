/**
 * JSON cell rendered as an editable grid (column setting `json.cellView = 'table'`).
 *
 * Shapes:
 *  - array of objects    → one column per key (union, first-seen order), one row per item
 *  - array of primitives → single value column
 *  - object              → two columns: key / value (keys are renamed in the modal editor)
 * A primitive root or invalid JSON falls back to the text preview.
 *
 * Primitive values edit in place: click → input, Enter/blur commits, Esc cancels,
 * booleans are a checkbox. Nested objects/arrays show as compact JSON: click opens
 * the Monaco JSON editor scoped to that value (saving writes it back into the root),
 * double-click outside an input still opens the editor for the whole cell.
 * Arrays can add and remove rows.
 */

import { useRef, useState } from 'react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { JsonColumnConfig } from '../../types/table.types';
import { JsonCell } from './JsonCell';
import { JsonEditor } from './JsonEditor';
import { deleteAt, setAt, type Path } from './JsonEditor.helpers';

type Primitive = string | number | boolean | null;
type JsonRecord = Record<string, unknown>;

interface JsonTableCellProps {
  value: unknown;
  config?: JsonColumnConfig;
  /** Receives the re-serialised JSON string; omitted = read-only. */
  onChange?: (json: string) => void;
}

interface GridCell {
  /** Path into the root value; null = display-only (object keys). */
  path: Path | null;
  value: unknown;
}

interface Grid {
  headers: string[];
  rows: Array<{ cells: GridCell[]; deletePath?: Path }>;
  /** Present for arrays: builds the value appended by "add row". */
  newRow?: () => unknown;
}

/** Header captions for the synthetic columns (object → key/value, primitives → value). */
export interface GridLabels {
  key: string;
  value: string;
}

const parseRoot = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

const isRecord = (v: unknown): v is JsonRecord =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isPrimitive = (v: unknown): v is Primitive =>
  v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

export const buildGrid = (root: unknown, labels: GridLabels): Grid | null => {
  if (Array.isArray(root)) {
    if (root.length > 0 && root.every(isRecord)) {
      const headers: string[] = [];
      for (const item of root) {
        for (const key of Object.keys(item)) if (!headers.includes(key)) headers.push(key);
      }
      return {
        headers,
        rows: root.map((item, r) => ({
          deletePath: [r],
          cells: headers.map((key) => ({ path: [r, key], value: item[key] })),
        })),
        newRow: () => Object.fromEntries(headers.map((key) => [key, ''])),
      };
    }
    if (root.every(isPrimitive)) {
      return {
        headers: [labels.value],
        rows: root.map((item, r) => ({ deletePath: [r], cells: [{ path: [r], value: item }] })),
        newRow: () => '',
      };
    }
    return null;
  }
  if (isRecord(root)) {
    return {
      headers: [labels.key, labels.value],
      rows: Object.entries(root).map(([key, item]) => ({
        cells: [
          { path: null, value: key },
          { path: [key], value: item },
        ],
      })),
    };
  }
  return null;
};

/** Keep the stored type when the user retypes a number or null. */
const coerce = (raw: string, prev: unknown): Primitive => {
  if (typeof prev === 'number') {
    const n = Number(raw);
    return raw.trim() !== '' && Number.isFinite(n) ? n : raw;
  }
  if (prev === null && raw === '') return null;
  return raw;
};

const stop = (event: React.SyntheticEvent) => event.stopPropagation();

const INPUT_CLASS =
  'w-full min-w-0 px-1 py-0.5 text-xs font-mono rounded border border-[var(--color-primary-500)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none';

const BUTTON_CLASS =
  'block w-full truncate text-left rounded px-0.5 hover:bg-[var(--bg-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--text-primary)]';

const noop = () => {};

interface ValueCellProps {
  value: unknown;
  config?: JsonColumnConfig;
  onCommit?: (next: unknown) => void;
}

const ValueCell = ({ value, config, onCommit }: ValueCellProps) => {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const doneRef = useRef(false);

  // `undefined` = key missing in this array item: shown empty, editable like a blank string.
  if (value !== undefined && !isPrimitive(value)) {
    const text = JSON.stringify(value);
    if (!onCommit) {
      return (
        <span className="block truncate font-mono text-[var(--text-tertiary)]" title={text}>
          {text}
        </span>
      );
    }
    return (
      <>
        <button
          type="button"
          title={t('columnSettings.json.cell.preview')}
          onClick={(event) => {
            stop(event);
            setEditorOpen(true);
          }}
          onDoubleClick={stop}
          className={`${BUTTON_CLASS} font-mono text-[var(--text-tertiary)]`}
        >
          {text}
        </button>
        {editorOpen && (
          // The editor is portalled, but its React events still bubble here: stop them so the
          // host cell's double-click editor stays closed. Always opens in code (Monaco) mode.
          <div role="presentation" onClick={stop} onDoubleClick={stop}>
            <JsonEditor
              value={JSON.stringify(value, null, 2)}
              config={{ ...config, defaultMode: 'code' }}
              onChange={noop}
              onCancel={() => setEditorOpen(false)}
              onCommit={(next) => {
                setEditorOpen(false);
                onCommit(next ? JSON.parse(next) : null);
              }}
            />
          </div>
        )}
      </>
    );
  }

  const label = value === null ? 'null' : value === undefined ? '' : String(value);
  const labelClass = value === null ? 'italic text-[var(--text-tertiary)]' : '';

  if (!onCommit) {
    return <span className={`block truncate ${labelClass}`} title={label}>{label}</span>;
  }

  if (typeof value === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={value}
        onChange={(event) => onCommit(event.target.checked)}
        onDoubleClick={stop}
        className="accent-[var(--color-primary-500)]"
      />
    );
  }

  if (draft === null) {
    return (
      <button
        type="button"
        title={t('columnSettings.json.cell.edit')}
        onClick={(event) => {
          stop(event);
          doneRef.current = false;
          setDraft(value == null ? '' : String(value));
        }}
        className={`${BUTTON_CLASS} ${labelClass}`}
      >
        {label || ' '}
      </button>
    );
  }

  const finish = (save: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (save) onCommit(coerce(draft, value));
    setDraft(null);
  };

  return (
    <input
      // eslint-disable-next-line jsx-a11y/no-autofocus -- the input replaces the button the user just clicked
      autoFocus
      type="text"
      aria-label={t('columnSettings.json.cell.valueLabel')}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(true)}
      onDoubleClick={stop}
      onKeyDown={(event) => {
        stop(event);
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      }}
      className={INPUT_CLASS}
    />
  );
};

export const JsonTableCell = ({ value, config, onChange }: JsonTableCellProps) => {
  const { t } = useLanguage();
  const root = parseRoot(value);
  const grid = root === undefined
    ? null
    : buildGrid(root, { key: t('columnSettings.json.cell.key'), value: t('columnSettings.json.cell.value') });

  if (!grid) {
    return <JsonCell value={value} config={config} />;
  }

  const pretty = config?.prettyInCell ?? true;
  const commit = onChange
    ? (next: unknown) => onChange(JSON.stringify(next, null, pretty ? 2 : 0))
    : undefined;

  const canAddRow = Boolean(commit && grid.newRow);

  return (
    <div className="w-full text-xs" data-testid="json-table-cell">
      <table className="w-full border-collapse" aria-label={t('columnSettings.json.cell.tableLabel')}>
        <thead>
          <tr className="bg-[var(--bg-tertiary)]">
            {grid.headers.map((header) => (
              <th
                key={header}
                scope="col"
                className="px-1.5 py-0.5 text-left font-medium text-[var(--text-primary)] truncate border-b border-[var(--border-primary)]"
              >
                {header}
              </th>
            ))}
            {commit && grid.rows.some((row) => row.deletePath) && (
              <th scope="col" className="w-5 border-b border-[var(--border-primary)]">
                <span className="sr-only">{t('columnSettings.json.cell.actions')}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row, r) => (
            <tr key={r} className="hover:bg-[var(--bg-tertiary)]/50">
              {row.cells.map((cell, c) => (
                <td
                  key={c}
                  className="px-1.5 py-0.5 text-[var(--text-secondary)] border-b border-[var(--border-primary)]/50 max-w-[12rem]"
                >
                  <ValueCell
                    value={cell.value}
                    config={config}
                    onCommit={
                      commit && cell.path
                        ? (next) => commit(setAt(root, cell.path as Path, next))
                        : undefined
                    }
                  />
                </td>
              ))}
              {commit && row.deletePath && (
                <td className="border-b border-[var(--border-primary)]/50 text-center">
                  <button
                    type="button"
                    aria-label={t('columnSettings.json.cell.deleteRow', { n: r + 1 })}
                    onClick={(event) => {
                      stop(event);
                      commit(deleteAt(root, row.deletePath as Path));
                    }}
                    onDoubleClick={stop}
                    className="px-1 rounded text-[var(--text-tertiary)] hover:text-red-500 hover:bg-[var(--bg-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--text-primary)]"
                  >
                    ×
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {canAddRow && (
        <button
          type="button"
          onClick={(event) => {
            stop(event);
            commit?.(setAt(root, [grid.rows.length], grid.newRow?.()));
          }}
          onDoubleClick={stop}
          className="mt-0.5 px-1.5 py-0.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--text-primary)]"
        >
          {t('columnSettings.json.cell.addRow')}
        </button>
      )}
    </div>
  );
};
