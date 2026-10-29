import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Search, Link2Off, Loader2 } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { cn } from '@/shared/utils/cn';
import { useMailPeopleTable, useLinkMessage } from '../hooks/useMailLink';
import type { MailMessage } from '../types';
import { useLanguage } from '@/shared/i18n/LanguageContext';

export interface MailPeoplePickerProps {
  spaceId: number | undefined;
  message: MailMessage;
  /** Fired after a successful link/unlink so the trigger can close its popover. */
  onDone?: () => void;
}

interface PeopleRow {
  id: number;
  label: string;
  sub: string | null;
}

/** First column whose name/displayName matches any of the needles (case-insensitive). */
function pickColumn(
  columns: { name: string; displayName: string }[],
  needles: RegExp
): string | null {
  const hit = columns.find((c) => needles.test(c.name) || needles.test(c.displayName));
  return hit?.name ?? null;
}

/**
 * ADR-158 §P2 — the "attach this email to a person" picker. Shared popover body
 * used by the reader link-bar and the list-row link button.
 *
 * Target table is resolved once (`useMailPeopleTable`); rows come off the same
 * typeahead endpoint the relation editor uses (`/tables/:id/rows?search=`). It
 * opens pre-filtered by the sender's address (search the email column), and
 * switches to name search as soon as the operator types a non-email term — so the
 * common case ("file this under the person who wrote it") is one click.
 */
export function MailPeoplePicker({ spaceId, message, onDone }: MailPeoplePickerProps) {
  const { t } = useLanguage();
  const { tableId, tables, setTableId } = useMailPeopleTable(spaceId);
  const link = useLinkMessage(spaceId);

  const [term, setTerm] = useState(message.fromAddress || '');
  const [debounced, setDebounced] = useState(term);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  // Column layout of the target table — drives which column we search + display.
  const { data: columns } = useQuery({
    queryKey: ['mail', 'people-columns', tableId],
    queryFn: () => tablesApi.getColumns(String(tableId)).then((r) => r.columns),
    enabled: tableId != null,
    staleTime: 60_000,
  });

  const cols = useMemo(() => {
    const list = columns ?? [];
    const emailCol = pickColumn(list, /e-?mail|почт/i);
    const labelCol =
      pickColumn(list, /^name$|имя|title|назв|full.?name|ф\.?и\.?о/i) ??
      emailCol ??
      list[0]?.name ??
      null;
    return { emailCol, labelCol };
  }, [columns]);

  // An email-looking term searches the email column; a name-looking term searches
  // the label column. Either way one `searchColumns` per the endpoint's contract.
  const searchColumn = debounced.includes('@') ? cols.emailCol : cols.labelCol;

  const { data: rows, isFetching } = useQuery({
    queryKey: ['mail', 'people-rows', tableId, searchColumn, debounced],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '25' });
      if (debounced && searchColumn) {
        params.set('search', debounced);
        params.set('searchColumns', searchColumn);
      }
      const res = await apiClient.request<{
        data: { rows: Array<{ id: number; data?: Record<string, unknown> }> } | Array<{ id: number; data?: Record<string, unknown> }>;
      }>(`/tables/${tableId}/rows?${params.toString()}`);
      const raw = Array.isArray(res.data) ? res.data : res.data?.rows ?? [];
      return raw.map<PeopleRow>((row) => {
        const d = (row.data && typeof row.data === 'object' ? row.data : {}) as Record<string, unknown>;
        const label = cols.labelCol ? String(d[cols.labelCol] ?? '') : '';
        const email = cols.emailCol ? String(d[cols.emailCol] ?? '') : '';
        return {
          id: row.id,
          label: label || email || `#${row.id}`,
          sub: email && email !== label ? email : null,
        };
      });
    },
    enabled: tableId != null && Boolean(columns),
    staleTime: 15_000,
  });

  const linkedHere = message.linkedTableId != null && message.linkedTableId === tableId;
  const linkedRowId = message.linkedRowId;

  const apply = (rowId: number) => {
    link.mutate({ msgId: message.id, target: { tableId: tableId!, rowId } }, { onSuccess: onDone });
  };
  const clear = () => {
    link.mutate({ msgId: message.id, target: null }, { onSuccess: onDone });
  };

  if (tableId == null) {
    return (
      <div className="min-w-[240px] p-3 text-sm text-[var(--text-tertiary)]">
        {t('mail.people.noTable')}
      </div>
    );
  }

  return (
    <div className="flex min-w-[280px] max-w-[340px] flex-col">
      {/* Search box, seeded with the sender's address. */}
      <div className="flex items-center gap-2 border-b border-[var(--border-primary)] px-2.5 py-2">
        <Search size={14} className="flex-shrink-0 text-[var(--text-tertiary)]" />
        <input
          type="text"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={t('mail.people.searchPlaceholder')}
          aria-label={t('mail.people.searchLabel')}
          className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        />
        {(isFetching || link.isPending) && (
          <Loader2 size={14} className="flex-shrink-0 animate-spin text-[var(--text-tertiary)]" />
        )}
      </div>

      {/* Current link → offer unlink. */}
      {message.linkedRowId != null && (
        <button
          type="button"
          onClick={clear}
          disabled={link.isPending}
          className="flex items-center gap-2 border-b border-[var(--border-primary)] px-2.5 py-2 text-left text-xs text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)] disabled:opacity-50"
        >
          <Link2Off size={14} className="flex-shrink-0" />
          {linkedHere ? t('mail.people.unlink') : t('mail.people.unlinkOther')}
        </button>
      )}

      <ul className="max-h-72 overflow-y-auto py-1">
        {rows?.length === 0 && (
          <li className="px-2.5 py-3 text-center text-sm text-[var(--text-tertiary)]">
            {isFetching ? t('mail.common.loading') : t('mail.people.notFound')}
          </li>
        )}
        {rows?.map((row) => {
          const on = linkedHere && linkedRowId === row.id;
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => apply(row.id)}
                disabled={link.isPending}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-[var(--bg-secondary)] disabled:opacity-50',
                  on ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{row.label}</span>
                  {row.sub && (
                    <span className="block truncate text-xs text-[var(--text-tertiary)]">{row.sub}</span>
                  )}
                </span>
                {on && <Check size={14} className="flex-shrink-0 text-[var(--color-primary-600)]" />}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Change the target table (persisted per space) when the default guess is wrong. */}
      {tables.length > 1 && (
        <div className="flex items-center gap-2 border-t border-[var(--border-primary)] px-2.5 py-2">
          <label htmlFor="mail-people-table" className="flex-shrink-0 text-xs text-[var(--text-tertiary)]">
            {t('mail.people.table')}
          </label>
          <select
            id="mail-people-table"
            value={tableId}
            onChange={(e) => setTableId(Number(e.target.value))}
            className="min-w-0 flex-1 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-1.5 py-1 text-xs text-[var(--text-secondary)]"
          >
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.display_name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
