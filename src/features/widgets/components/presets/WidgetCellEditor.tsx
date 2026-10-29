import { useEffect, useRef, useState } from 'react';
import { FieldRenderer } from '@/features/tables/components/modals/FieldRenderer';
import type { ColumnModel } from '@/features/tables/types/table.types';

export function canEditWidgetColumn(column: ColumnModel) {
  return !column.isReadonly && !column.is_primary_key && !['id', 'created_at', 'updated_at'].includes(column.name)
    && ['text', 'textarea', 'number', 'select', 'multi-select', 'checkbox', 'email', 'url', 'phone', 'password', 'date', 'datetime', 'relation'].includes(column.type);
}

export function WidgetCellEditor({ column, value, onSave, onClose }: {
  column: ColumnModel;
  value: unknown;
  onSave: (value: unknown) => Promise<void>;
  onClose: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { formRef.current?.querySelector<HTMLElement>('input, textarea, select')?.focus(); }, []);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    formRef.current?.closest('td')?.focus();
    onClose();
  };
  // Events from the editor must not activate the enclosing table row.
  // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
  return <form ref={formRef} className="min-w-48 space-y-2" onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
    onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape' && !saving) close(); }}
    onSubmit={async event => {
      event.preventDefault();
      if (saving) return;
      setSaving(true);
      setError('');
      try { await onSave(draft); close(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить. Попробуйте ещё раз.'); }
      finally { setSaving(false); }
    }}>
    <FieldRenderer column={column} value={draft} onChange={setDraft} disabled={saving} showLabel />
    {error && <p role="alert" className="text-sm text-[var(--color-error)]">{error}</p>}
    <div className="flex gap-2 text-xs">
      <button type="submit" disabled={saving} className="rounded px-2 py-1 bg-[var(--bg-tertiary)]">{saving ? 'Сохранение…' : 'Сохранить'}</button>
      <button type="button" disabled={saving} onClick={close} className="rounded px-2 py-1">Отмена</button>
    </div>
  </form>;
}
