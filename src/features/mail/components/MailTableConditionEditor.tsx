import { useId, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Input, Select } from '@/shared/components/ui';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { useAllTables } from '@/features/tables/hooks/useAllTables';
import type { MailTableSource } from '../types';
import { useLanguage } from '@/shared/i18n/LanguageContext';

/**
 * ADR-173 ext — editor for an `op: 'in_table'` condition source. Mirrors the
 * «создать представление» mapping: a Спейс → Проект → Таблица → Колонка cascade
 * (`useAllTables`, the same source that wizard uses) instead of a raw table-id
 * field, so the picker shows human names, not ids. The column list renders as
 * «Имя (ключ)» — the display name with the machine key in brackets, which is
 * the value the backend keys `data->>?` by.
 *
 * Only the {@link MailTableSource} spec (`tableId`/`column`/`filter`) is
 * persisted; the space/project selects are navigation to *find* the table. The
 * backend resolves the value set (space-scoped to the label's own space) at sync
 * time — this component never reads rows itself.
 */
export function MailTableConditionEditor({
  spaceId,
  source,
  onChange,
}: {
  spaceId: number | undefined;
  source: MailTableSource | undefined;
  /** `undefined` clears the picked table+column (e.g. after changing space/project). */
  onChange: (next: MailTableSource | undefined) => void;
}) {
  const { t } = useLanguage();
  const fieldId = useId();
  const filterOpOptions = [
    { label: t('mail.tableCondition.equals'), value: 'equals' as const },
    { label: t('mail.tableCondition.contains'), value: 'contains' as const },
  ];
  const { data: allTables, isLoading: tablesLoading } = useAllTables();
  const spaces = useMemo(() => allTables?.spacesWithTables ?? [], [allTables]);
  const flat = useMemo(() => allTables?.flat ?? [], [allTables]);

  const tableId = source?.tableId ?? null;

  // Locate the saved table so the cascade can snap to its space/project on edit.
  const currentCtx = useMemo(
    () => (tableId != null ? flat.find((t) => t.id === String(tableId)) : undefined),
    [flat, tableId]
  );

  const [projectSel, setProjectSel] = useState<number | null>(null);

  // Space is locked to the label's own space — the backend resolver is scoped to
  // it, so a table from another space would only ever resolve to an empty match
  // set. Restricting the picker to this space kills that foreign-space footgun.
  const spaceObj = useMemo(() => spaces.find((s) => s.id === spaceId), [spaces, spaceId]);

  // Editing an existing rule: snap the project select to the saved table, but
  // only if that table lives in the locked space (else leave the picker empty —
  // a stale foreign-space rule resolves empty anyway).
  useEffect(() => {
    if (!currentCtx) return;
    if (spaceObj?.projects.some((p) => p.id === currentCtx.projectId)) {
      setProjectSel(currentCtx.projectId);
    }
  }, [currentCtx, spaceObj]);
  const projectObj = useMemo(
    () => spaceObj?.projects.find((p) => p.id === projectSel),
    [spaceObj, projectSel]
  );

  const spaceOptions = useMemo(
    () => spaces.map((s) => ({ label: `${s.icon || '📁'} ${s.name}`, value: String(s.id) })),
    [spaces]
  );
  const projectOptions = useMemo(
    () =>
      (spaceObj?.projects ?? []).map((p) => ({ label: `${p.icon || '📂'} ${p.name}`, value: String(p.id) })),
    [spaceObj]
  );
  const tableOptions = useMemo(
    () =>
      (projectObj?.tables ?? []).map((t) => ({ label: `${t.icon || '📋'} ${t.displayName}`, value: t.id })),
    [projectObj]
  );

  const columnsQuery = useQuery({
    queryKey: ['mail', 'rule-columns', tableId],
    queryFn: () => tablesApi.getColumns(String(tableId)).then((r) => r.columns),
    enabled: tableId != null,
    staleTime: 60_000,
  });

  const columnOptions = useMemo(
    () =>
      (columnsQuery.data ?? []).map((c) => ({
        // «Имя (ключ)»: human name first, machine key in brackets (the value the
        // backend resolver keys by). Collapse when the two are identical.
        label: c.displayName && c.displayName !== c.name ? `${c.displayName} (${c.name})` : c.name,
        value: c.name,
      })),
    [columnsQuery.data]
  );

  const [showFilter, setShowFilter] = useState(Boolean(source?.filter));

  // Space/project are navigation only — moving them clears the picked table so a
  // stale table from another project can't survive hidden. `toInput` drops the
  // now-incomplete condition on save, so this is safe.
  const pickProject = (v: string) => {
    setProjectSel(Number(v));
    if (source) onChange(undefined);
  };
  const pickTable = (v: string) => onChange({ tableId: Number(v), column: '', filter: undefined });

  const setFilter = (patch: Partial<NonNullable<MailTableSource['filter']>>) => {
    const cur = source?.filter ?? { column: '', op: 'equals' as const, value: '' };
    onChange({ ...(source as MailTableSource), filter: { ...cur, ...patch } });
  };

  // Only surface the saved table in the Select if it belongs to the currently
  // navigated project (else the cascade was moved away → show the placeholder).
  const tableSelValue =
    tableId != null && (projectObj?.tables ?? []).some((t) => t.id === String(tableId))
      ? String(tableId)
      : '';

  const rowLabel = 'w-20 flex-shrink-0 text-xs text-[var(--text-tertiary)]';

  return (
    <div className="flex flex-col gap-2 rounded-md border border-[var(--border-subtle,rgba(0,0,0,0.08))] bg-[var(--surface-subtle,rgba(0,0,0,0.02))] p-2">
      <div className="flex items-center gap-2">
        <label htmlFor={`${fieldId}-label-0`} className={rowLabel}>{t('mail.tableCondition.space')}</label>
        <div className="min-w-0 flex-1">
          {/* Locked to the label's own space — the backend resolver is scoped to
              it, so cross-space tables are disallowed by design. */}
          <Select id={`${fieldId}-label-0`}
            value={spaceId != null ? String(spaceId) : ''}
            onChange={() => {}}
            options={spaceOptions}
            disabled
            placeholder={tablesLoading ? t('mail.common.loading') : t('mail.tableCondition.spacePlaceholder')}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor={`${fieldId}-label-1`} className={rowLabel}>{t('mail.tableCondition.project')}</label>
        <div className="min-w-0 flex-1">
          <Select id={`${fieldId}-label-1`}
            value={projectSel != null ? String(projectSel) : ''}
            onChange={pickProject}
            options={projectOptions}
            disabled={spaceObj == null}
            placeholder={spaceObj == null ? t('mail.tableCondition.noSpace') : t('mail.tableCondition.pickProject')}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor={`${fieldId}-label-2`} className={rowLabel}>{t('mail.tableCondition.table')}</label>
        <div className="min-w-0 flex-1">
          <Select id={`${fieldId}-label-2`}
            value={tableSelValue}
            onChange={pickTable}
            options={tableOptions}
            disabled={projectSel == null}
            placeholder={projectSel == null ? t('mail.tableCondition.projectFirst') : t('mail.tableCondition.pickTable')}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor={`${fieldId}-label-3`} className={rowLabel}>{t('mail.tableCondition.column')}</label>
        <div className="min-w-0 flex-1">
          <Select id={`${fieldId}-label-3`}
            value={source?.column ?? ''}
            onChange={(v) => onChange({ ...(source as MailTableSource), column: v })}
            options={columnOptions}
            disabled={tableId == null}
            placeholder={
              tableId == null
                ? t('mail.tableCondition.tableFirst')
                : columnsQuery.isLoading
                  ? t('mail.common.loading')
                  : t('mail.tableCondition.valueColumn')
            }
          />
        </div>
      </div>

      {!showFilter ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          disabled={tableId == null}
          onClick={() => setShowFilter(true)}
        >
          <Plus size={13} className="mr-1" /> {t('mail.tableCondition.addFilter')}
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <label htmlFor={`${fieldId}-label-4`} className={rowLabel}>{t('mail.tableCondition.filter')}</label>
          <div className="w-32 flex-shrink-0">
            <Select id={`${fieldId}-label-4`}
              value={source?.filter?.column ?? ''}
              onChange={(v) => setFilter({ column: v })}
              options={columnOptions}
              placeholder={t('mail.tableCondition.columnPlaceholder')}
            />
          </div>
          <div className="w-28 flex-shrink-0">
            <Select
              value={source?.filter?.op ?? 'equals'}
              onChange={(v) => setFilter({ op: v as 'equals' | 'contains' })}
              options={filterOpOptions}
            />
          </div>
          <div className="min-w-0 flex-1">
            <Input
              value={source?.filter?.value ?? ''}
              onChange={(e) => setFilter({ value: e.target.value })}
              placeholder={t('mail.tableCondition.filterValue')}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('mail.tableCondition.removeFilter')}
            onClick={() => {
              setShowFilter(false);
              onChange({ ...(source as MailTableSource), filter: undefined });
            }}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      )}
    </div>
  );
}
