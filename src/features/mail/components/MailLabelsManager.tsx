import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Tag, Loader2, AlertTriangle } from 'lucide-react';
import { Button, Input, Select, Switch } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import {
  useApplyLabel,
  useCreateLabel,
  useDeleteLabel,
  useMailLabels,
  useUpdateLabel,
} from '../hooks/useMailLabels';
import { useMailLabelColorize } from '../labelPrefs';
import type {
  MailLabel,
  MailLabelCondition,
  MailRuleField,
  MailRuleOp,
  MailTableSource,
} from '../types';
import type { MailLabelInput } from '../api/mailApi';
import { MailTableConditionEditor } from './MailTableConditionEditor';

export interface MailLabelsManagerProps {
  spaceId: number | undefined;
  /** Open straight into a fresh label draft (the rail's "+" under labels). */
  autoNew?: boolean;
}

// A condition as edited in the form — `value` is always a string here (comma-
// separated for `in_list`); it's split back into an array on save.
interface DraftCondition {
  field: MailRuleField;
  op: MailRuleOp;
  value: string;
  /** Only for `op: 'in_table'` — the CRM table/column/filter to match against. */
  source?: MailTableSource;
}

interface Draft {
  /** null ⇒ a not-yet-created label. */
  id: number | null;
  name: string;
  color: string;
  icon: string;
  showInToolbar: boolean;
  enabled: boolean;
  /** Client-side view pref (not part of the server payload) — tint the rows. */
  colorizeRow: boolean;
  match: 'any' | 'all';
  conditions: DraftCondition[];
}

const FIELD_OPTIONS: { label: string; value: MailRuleField }[] = [
  { label: 'От кого', value: 'from' },
  { label: 'Кому', value: 'to' },
  { label: 'Тема', value: 'subject' },
  { label: 'Тело', value: 'body' },
  { label: 'Любое поле', value: 'any' },
];

const OP_OPTIONS: { label: string; value: MailRuleOp }[] = [
  { label: 'содержит', value: 'contains' },
  { label: 'один из списка', value: 'in_list' },
  { label: 'равно', value: 'equals' },
  { label: 'регулярное выражение', value: 'regex' },
  { label: 'информация из таблицы', value: 'in_table' },
];

const MATCH_OPTIONS = [
  { label: 'любое из условий (ИЛИ)', value: 'any' },
  { label: 'все условия (И)', value: 'all' },
];

const emptyDraft = (): Draft => ({
  id: null,
  name: '',
  color: '#3b82f6',
  icon: '',
  showInToolbar: false,
  enabled: true,
  colorizeRow: false,
  match: 'any',
  conditions: [],
});

/** Normalize a persisted label into the editable draft shape. */
function toDraft(label: MailLabel, colorizeRow: boolean): Draft {
  const conditions = Array.isArray(label.rules?.conditions) ? label.rules.conditions : [];
  return {
    id: label.id,
    name: label.name,
    color: label.color ?? '',
    icon: label.icon ?? '',
    showInToolbar: label.showInToolbar,
    enabled: label.enabled,
    colorizeRow,
    match: label.rules?.match === 'all' ? 'all' : 'any',
    conditions: conditions.map((c) => ({
      field: c.field,
      op: c.op,
      value: Array.isArray(c.value) ? c.value.join(', ') : (c.value ?? ''),
      source: c.source,
    })),
  };
}

/** Build the API payload from the draft; drops blank conditions. */
function toInput(draft: Draft): MailLabelInput {
  const conditions: MailLabelCondition[] = draft.conditions
    .map((c): MailLabelCondition | null => {
      if (c.op === 'in_table') {
        // Need a table + a value column to be meaningful; drop otherwise.
        const s = c.source;
        if (!s || !Number.isFinite(s.tableId) || !s.column) return null;
        // A filter with no value is meaningless — drop the filter, keep the source.
        const filter = s.filter?.column && s.filter.value.trim()
          ? { column: s.filter.column, op: s.filter.op, value: s.filter.value.trim() }
          : undefined;
        return { field: c.field, op: c.op, source: { ...s, filter } };
      }
      if (c.op === 'in_list') {
        const value = c.value
          .split(/[,\n]/)
          .map((v) => v.trim())
          .filter(Boolean);
        return value.length ? { field: c.field, op: c.op, value } : null;
      }
      const value = c.value.trim();
      return value ? { field: c.field, op: c.op, value } : null;
    })
    .filter((c): c is MailLabelCondition => c !== null);

  return {
    name: draft.name.trim(),
    color: draft.color || null,
    icon: draft.icon.trim() || null,
    show_in_toolbar: draft.showInToolbar,
    enabled: draft.enabled,
    rules: { match: draft.match, conditions },
  };
}

/**
 * ADR-158 §P4 — the "Ярлыки" manager. Left: the label list (with counts). Right:
 * an editor for the selected/new label — name, colour, toolbar visibility, and a
 * rule builder that drives auto-tagging on sync. "Применить" backfills the rules
 * over existing mail; the server caps the scan and reports `capped`.
 */
export function MailLabelsManager({ spaceId, autoNew = false }: MailLabelsManagerProps) {
  const labelsQuery = useMailLabels(spaceId);
  const create = useCreateLabel(spaceId);
  const update = useUpdateLabel(spaceId);
  const remove = useDeleteLabel(spaceId);
  const apply = useApplyLabel(spaceId);
  const { colorizeIds, setColorize } = useMailLabelColorize();

  const labels = useMemo(() => labelsQuery.data ?? [], [labelsQuery.data]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyNote, setApplyNote] = useState<string | null>(null);

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const startNew = () => {
    setError(null);
    setApplyNote(null);
    setDraft(emptyDraft());
  };
  const startEdit = (label: MailLabel) => {
    setError(null);
    setApplyNote(null);
    setDraft(toDraft(label, colorizeIds.has(label.id)));
  };

  // Opened via the rail's "+" → jump straight into a blank draft, once per mount.
  const autoNewApplied = useRef(false);
  useEffect(() => {
    if (autoNew && !autoNewApplied.current) {
      autoNewApplied.current = true;
      startNew();
    }
  }, [autoNew]);

  const setCondition = (i: number, p: Partial<DraftCondition>) =>
    patch({
      conditions: draft?.conditions.map((c, idx) => (idx === i ? { ...c, ...p } : c)) ?? [],
    });
  const addCondition = () =>
    patch({
      conditions: [...(draft?.conditions ?? []), { field: 'from', op: 'contains', value: '' }],
    });
  const removeCondition = (i: number) =>
    patch({ conditions: draft?.conditions.filter((_, idx) => idx !== i) ?? [] });

  const saving = create.isPending || update.isPending;

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError('Название обязательно');
      return;
    }
    setError(null);
    try {
      if (draft.id == null) {
        const created = await create.mutateAsync(toInput(draft));
        setColorize(created.id, draft.colorizeRow);
        setDraft(toDraft(created, draft.colorizeRow));
      } else {
        const updated = await update.mutateAsync({ id: draft.id, patch: toInput(draft) });
        setColorize(updated.id, draft.colorizeRow);
        setDraft(toDraft(updated, draft.colorizeRow));
      }
    } catch (e) {
      // Backend returns 400 with a rule-validation message — surface it verbatim.
      setError(e instanceof Error ? e.message : 'Не удалось сохранить ярлык');
    }
  };

  const handleDelete = async () => {
    if (!draft?.id) return;
    if (!window.confirm(`Удалить ярлык «${draft.name}»? Метки на письмах будут сняты.`)) return;
    try {
      await remove.mutateAsync(draft.id);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить ярлык');
    }
  };

  const handleApply = async () => {
    if (!draft?.id) return;
    setApplyNote(null);
    try {
      const res = await apply.mutateAsync(draft.id);
      setApplyNote(
        res.capped
          ? `Применено к ${res.applied} из ${res.scanned}+ писем (показаны не все — лимит скана).`
          : `Применено к ${res.applied} из ${res.scanned} писем.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось применить правила');
    }
  };

  const hasRules = (draft?.conditions.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Ярлыки</h3>
        <p className="text-xs text-[var(--text-tertiary)]">
          Метки для писем: правила авто-присвоения, цвет и вывод в панель.
        </p>
      </div>
      <div className="flex max-h-[70vh] min-h-[24rem] gap-4">
        {/* Left: label list. */}
        <div className="flex w-52 flex-shrink-0 flex-col border-r border-[var(--border-primary)] pr-3">
          <Button variant="secondary" size="sm" onClick={startNew} className="mb-2 justify-start">
            <Plus size={15} className="mr-1.5" /> Новый ярлык
          </Button>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {labelsQuery.isLoading ? (
              <div className="flex items-center gap-2 p-2 text-sm text-[var(--text-tertiary)]">
                <Loader2 size={14} className="animate-spin" /> Загрузка…
              </div>
            ) : labelsQuery.isError ? (
              <div className="flex flex-col items-start gap-2 p-2 text-sm text-[var(--text-tertiary)]">
                <span>Не удалось загрузить ярлыки</span>
                <Button variant="ghost" size="sm" onClick={() => labelsQuery.refetch()}>
                  Повторить
                </Button>
              </div>
            ) : labels.length === 0 ? (
              <p className="p-2 text-sm text-[var(--text-tertiary)]">
                Пока нет ярлыков. Создайте первый.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {labels.map((label) => (
                  <li key={label.id}>
                    <button
                      type="button"
                      onClick={() => startEdit(label)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                        draft?.id === label.id
                          ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                      )}
                    >
                      <Tag
                        size={14}
                        className="flex-shrink-0"
                        style={label.color ? { color: label.color } : undefined}
                      />
                      <span className={cn('flex-1 truncate', !label.enabled && 'opacity-50')}>
                        {label.name}
                      </span>
                      {!!label.messageCount && (
                        <span className="text-xs text-[var(--text-tertiary)]">
                          {label.messageCount}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right: editor. */}
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {!draft ? (
            <div className="flex h-full items-center justify-center text-center text-sm text-[var(--text-tertiary)]">
              Выберите ярлык слева или создайте новый.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-end gap-3">
                <div className="min-w-0 flex-1">
                  <Input
                    label="Название"
                    value={draft.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    placeholder="Например: Клиенты"
                  />
                </div>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-[var(--text-secondary)]">Цвет</span>
                  <input
                    type="color"
                    aria-label="Цвет ярлыка"
                    value={draft.color || '#3b82f6'}
                    onChange={(e) => patch({ color: e.target.value })}
                    className="h-9 w-12 cursor-pointer rounded-md border border-[var(--border-primary)] bg-transparent"
                  />
                </label>
              </div>

              <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-primary)] p-3">
                <Switch
                  label="Показывать кнопку в панели письма"
                  checked={draft.showInToolbar}
                  onCheckedChange={(v) => patch({ showInToolbar: v })}
                />
                <Switch
                  label="Подсвечивать фон писем этим цветом"
                  description="Письма с этим ярлыком получают цветную заливку строки в списке."
                  checked={draft.colorizeRow}
                  onCheckedChange={(v) => patch({ colorizeRow: v })}
                />
                <Switch
                  label="Правила активны (авто-присвоение при синхронизации)"
                  checked={draft.enabled}
                  onCheckedChange={(v) => patch({ enabled: v })}
                />
              </div>

              {/* Rule builder. */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--text-secondary)]">
                    Правила авто-присвоения
                  </span>
                  <div className="w-56">
                    <Select
                      value={draft.match}
                      onChange={(v) => patch({ match: v === 'all' ? 'all' : 'any' })}
                      options={MATCH_OPTIONS}
                    />
                  </div>
                </div>

                {draft.conditions.length === 0 ? (
                  <p className="text-sm text-[var(--text-tertiary)]">
                    Без правил ярлык присваивается только вручную.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {draft.conditions.map((c, i) => (
                      <div key={i} className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <div className="w-32 flex-shrink-0">
                            <Select
                              value={c.field}
                              onChange={(v) => setCondition(i, { field: v as MailRuleField })}
                              options={FIELD_OPTIONS}
                            />
                          </div>
                          <div className="w-44 flex-shrink-0">
                            <Select
                              value={c.op}
                              onChange={(v) => setCondition(i, { op: v as MailRuleOp })}
                              options={OP_OPTIONS}
                            />
                          </div>
                          {c.op === 'in_table' ? (
                            <div className="min-w-0 flex-1" />
                          ) : (
                            <div className="min-w-0 flex-1">
                              <Input
                                value={c.value}
                                onChange={(e) => setCondition(i, { value: e.target.value })}
                                placeholder={c.op === 'in_list' ? 'a@x.com, @domain.com' : 'значение'}
                              />
                            </div>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Удалить условие"
                            onClick={() => removeCondition(i)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                        {c.op === 'in_table' && (
                          <MailTableConditionEditor
                            spaceId={spaceId}
                            source={c.source}
                            onChange={(source) => setCondition(i, { source })}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <Button variant="ghost" size="sm" onClick={addCondition} className="self-start">
                  <Plus size={14} className="mr-1" /> Добавить условие
                </Button>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-md bg-[var(--color-error-bg,rgba(239,68,68,0.1))] p-2 text-sm text-[var(--color-error)]">
                  <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              {applyNote && (
                <p className="text-sm text-[var(--text-secondary)]">{applyNote}</p>
              )}

              <div className="flex items-center gap-2 border-t border-[var(--border-primary)] pt-3">
                <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
                  {draft.id == null ? 'Создать' : 'Сохранить'}
                </Button>
                {draft.id != null && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleApply}
                      disabled={apply.isPending || !hasRules}
                      title={hasRules ? undefined : 'У ярлыка нет правил для применения'}
                    >
                      {apply.isPending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
                      Применить к письмам
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDelete}
                      disabled={remove.isPending}
                      className="ml-auto text-[var(--color-error)]"
                    >
                      <Trash2 size={14} className="mr-1" /> Удалить
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
