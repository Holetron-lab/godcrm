/**
 * PublicTablePage — read-only viewer for a single table inside a public space.
 *
 * ADR-0060 P3: hit /public/s/:slug/tables/:tableId for metadata + columns,
 * /public/s/:slug/tables/:tableId/rows for paginated rows. No auth, no edit.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';

import {
  publicApi,
  PublicApiError,
  type PublicTableColumn,
  type PublicTableMeta,
  type PublicTableRow,
} from './publicApi';
import { usePublicSeo } from './usePublicSeo';

const PAGE_SIZE = 50;

function formatCell(value: unknown, col: PublicTableColumn): string {
  if (value === null || value === undefined || value === '') return '—';

  if (col.settings.relation?.enabled && typeof value === 'object' && value !== null) {
    const rel = value as { label?: string };
    return rel.label ?? '—';
  }

  if ((col.type === 'file' || col.type === 'image' || col.type === 'attachment') && typeof value === 'object') {
    const file = value as { name?: string; url?: string };
    return file.name ?? file.url ?? '—';
  }

  if (typeof value === 'boolean') return value ? '✓' : '✗';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function PublicTablePage() {
  const { slug, tableId } = useParams<{ slug: string; tableId: string }>();
  const numericId = Number(tableId);

  const [meta, setMeta] = useState<PublicTableMeta | null>(null);
  const [columns, setColumns] = useState<PublicTableColumn[]>([]);
  const [rows, setRows] = useState<PublicTableRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  usePublicSeo({
    title: meta ? `${meta.name} – Public Space` : 'Public Table',
  });

  useEffect(() => {
    if (!slug || !Number.isFinite(numericId) || numericId <= 0) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [tableRes, rowsRes] = await Promise.all([
          publicApi.getTable(slug, numericId),
          publicApi.getTableRows(slug, numericId, { limit: PAGE_SIZE, offset }),
        ]);
        if (cancelled) return;
        setMeta(tableRes.data.table);
        setColumns(tableRes.data.columns);
        setRows(rowsRes.data.rows);
        setTotal(rowsRes.data.total);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof PublicApiError && err.status === 404) {
          setError('Table not found.');
        } else {
          setError('Failed to load table.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, numericId, offset]);

  const sortedColumns = useMemo(
    () => [...columns].sort((a, b) => a.position - b.position),
    [columns],
  );

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
        <AlertCircle className="h-10 w-10 text-red-400" />
        <p className="text-lg font-medium text-gray-700">{error}</p>
      </div>
    );
  }

  if (!meta) return null;

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        {meta.icon ? (
          <span className="text-2xl leading-none">{meta.icon}</span>
        ) : (
          <span className="text-2xl leading-none">📊</span>
        )}
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">{meta.name}</h1>
        <span className="ml-auto text-sm text-gray-500">
          {total} {total === 1 ? 'row' : 'rows'}
        </span>
      </div>

      {sortedColumns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-12 text-center text-sm text-gray-400">
          This table has no visible columns.
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-12 text-center text-sm text-gray-400">
          No rows in this table yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {sortedColumns.map((col) => (
                  <th
                    key={col.id}
                    scope="col"
                    className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                  >
                    {col.display_name || col.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  {sortedColumns.map((col) => {
                    const raw = (row.data as Record<string, unknown>)[col.name] ??
                      (row.data as Record<string, unknown>)[String(col.id)];
                    return (
                      <td
                        key={col.id}
                        className="max-w-xs truncate px-3 py-2 text-gray-700"
                        title={typeof raw === 'string' ? raw : undefined}
                      >
                        {formatCell(raw, col)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
          <button
            type="button"
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            className="rounded-md border border-gray-200 bg-white px-3 py-1 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-gray-50"
          >
            ← Prev
          </button>
          <span>
            Page {page} of {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total}
            className="rounded-md border border-gray-200 bg-white px-3 py-1 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-gray-50"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
