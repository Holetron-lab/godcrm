/**
 * ADR-158 — Settings surface for the client-side mail library: signatures +
 * templates (see `library.ts`). Pure CRUD over the localStorage-backed library;
 * the composer reads the same store via `useMailLibrary`, so edits here show up in
 * the picker menus immediately (window-event sync).
 *
 * Bodies are plain text (line breaks kept) — the composer escapes them to HTML on
 * insert, so there's no rich editor here on purpose (Ponytail: a rich signature
 * editor is a follow-up, not needed to ship the feature).
 */
import { Plus, Trash2, Star } from 'lucide-react';
import { Button } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { EmojiPicker } from '@/features/tables/components/UniversalTable/EmojiPicker';
import {
  useMailLibrary,
  newId,
  type MailLibrary,
  type MailSignature,
  type MailTemplate,
} from '../library';

const fieldClass =
  'w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--color-primary-500)]';

interface MailLibrarySettingsProps {
  /** Which section to render — Settings shows one per tab; omit to show both. */
  section?: 'templates' | 'signatures';
}

export function MailLibrarySettings({ section }: MailLibrarySettingsProps = {}) {
  const { library, update } = useMailLibrary();
  const showSignatures = section !== 'templates';
  const showTemplates = section !== 'signatures';

  const patch = (next: Partial<MailLibrary>) => update({ ...library, ...next });

  /* ── Signatures ── */
  const addSignature = () =>
    patch({
      signatures: [
        ...library.signatures,
        { id: newId(), name: `Подпись ${library.signatures.length + 1}`, text: '' },
      ],
    });
  const updateSignature = (id: string, p: Partial<MailSignature>) =>
    patch({ signatures: library.signatures.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  const removeSignature = (id: string) =>
    update({
      ...library,
      signatures: library.signatures.filter((s) => s.id !== id),
      // Drop the default pointer if it referenced the deleted signature.
      defaultSignatureId: library.defaultSignatureId === id ? null : library.defaultSignatureId,
    });
  const toggleDefault = (id: string) =>
    patch({ defaultSignatureId: library.defaultSignatureId === id ? null : id });

  /* ── Templates ── */
  const addTemplate = () =>
    patch({
      templates: [
        ...library.templates,
        { id: newId(), name: `Шаблон ${library.templates.length + 1}`, subject: '', body: '' },
      ],
    });
  const updateTemplate = (id: string, p: Partial<MailTemplate>) =>
    patch({ templates: library.templates.map((t) => (t.id === id ? { ...t, ...p } : t)) });
  const removeTemplate = (id: string) =>
    patch({ templates: library.templates.filter((t) => t.id !== id) });

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      {/* Signatures */}
      {showSignatures && (
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Подписи</h3>
            <p className="text-xs text-[var(--text-tertiary)]">
              Подпись по умолчанию (★) добавляется в новое письмо. Любую можно вставить в письмо
              кнопкой «Подпись» на панели ввода.
            </p>
          </div>
          <Button size="sm" variant="secondary" leftIcon={<Plus size={14} />} onClick={addSignature}>
            Добавить
          </Button>
        </div>

        {library.signatures.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--border-primary)] px-3 py-4 text-center text-xs text-[var(--text-tertiary)]">
            Пока нет подписей.
          </p>
        ) : (
          library.signatures.map((s) => {
            const isDefault = library.defaultSignatureId === s.id;
            return (
              <div
                key={s.id}
                className="flex flex-col gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 p-3"
              >
                <div className="flex items-center gap-2">
                  <EmojiPicker
                    value={s.icon ?? ''}
                    onChange={(icon) => updateSignature(s.id, { icon })}
                    compact
                    size="sm"
                  />
                  <input
                    value={s.name}
                    onChange={(e) => updateSignature(s.id, { name: e.target.value })}
                    placeholder="Название подписи"
                    aria-label="Название подписи"
                    className={cn(fieldClass, 'flex-1 font-medium')}
                  />
                  <button
                    type="button"
                    aria-pressed={isDefault}
                    title={isDefault ? 'Подпись по умолчанию' : 'Сделать подписью по умолчанию'}
                    aria-label="Подпись по умолчанию"
                    onClick={() => toggleDefault(s.id)}
                    className={cn(
                      'flex-shrink-0 rounded-md p-1.5 transition-colors',
                      isDefault
                        ? 'text-[var(--color-warning,#eab308)]'
                        : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    <Star size={16} className={isDefault ? 'fill-current' : undefined} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Удалить подпись «${s.name}»`}
                    title="Удалить"
                    onClick={() => removeSignature(s.id)}
                    className="flex-shrink-0 rounded-md p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)]"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <textarea
                  value={s.text}
                  onChange={(e) => updateSignature(s.id, { text: e.target.value })}
                  placeholder={'С уважением,\nИмя Фамилия\nКомпания · +7 …'}
                  aria-label="Текст подписи"
                  rows={3}
                  className={cn(fieldClass, 'resize-y')}
                />
              </div>
            );
          })
        )}
      </section>
      )}

      {/* Templates */}
      {showTemplates && (
      <section className={cn('flex flex-col gap-3', showSignatures && 'border-t border-[var(--border-primary)] pt-6')}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Шаблоны</h3>
            <p className="text-xs text-[var(--text-tertiary)]">
              Готовые тема + текст. Вставляются кнопкой «Шаблон» на панели ввода (тема
              подставляется, если поле «Тема» пустое).
            </p>
          </div>
          <Button size="sm" variant="secondary" leftIcon={<Plus size={14} />} onClick={addTemplate}>
            Добавить
          </Button>
        </div>

        {library.templates.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--border-primary)] px-3 py-4 text-center text-xs text-[var(--text-tertiary)]">
            Пока нет шаблонов.
          </p>
        ) : (
          library.templates.map((t) => (
            <div
              key={t.id}
              className="flex flex-col gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 p-3"
            >
              <div className="flex items-center gap-2">
                <EmojiPicker
                  value={t.icon ?? ''}
                  onChange={(icon) => updateTemplate(t.id, { icon })}
                  compact
                  size="sm"
                />
                <input
                  value={t.name}
                  onChange={(e) => updateTemplate(t.id, { name: e.target.value })}
                  placeholder="Название шаблона"
                  aria-label="Название шаблона"
                  className={cn(fieldClass, 'flex-1 font-medium')}
                />
                <button
                  type="button"
                  aria-label={`Удалить шаблон «${t.name}»`}
                  title="Удалить"
                  onClick={() => removeTemplate(t.id)}
                  className="flex-shrink-0 rounded-md p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)]"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <input
                value={t.subject}
                onChange={(e) => updateTemplate(t.id, { subject: e.target.value })}
                placeholder="Тема письма"
                aria-label="Тема шаблона"
                className={fieldClass}
              />
              <textarea
                value={t.body}
                onChange={(e) => updateTemplate(t.id, { body: e.target.value })}
                placeholder="Текст письма…"
                aria-label="Текст шаблона"
                rows={4}
                className={cn(fieldClass, 'resize-y')}
              />
            </div>
          ))
        )}
      </section>
      )}
    </div>
  );
}
