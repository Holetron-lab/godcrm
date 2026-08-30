/**
 * ADR-158 — Gmail-style recipient input. The typed address becomes a pinned chip
 * (commit on Enter / comma / semicolon / space / blur / paste) so you can add the
 * next one, and the next. Backspace on an empty field pops the last chip.
 *
 * Value is the committed `string[]` of addresses; the in-progress token is local.
 * Invalid addresses are still kept as chips but marked (red + title) so nothing is
 * silently dropped — the parent decides whether to block send on an invalid one.
 * Backend `normalizeRecipients` accepts the array verbatim (to/cc/bcc).
 */
import { useCallback, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

// Same pragmatic shape check the backend send path uses (services/mail/recipients.js).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(addr: string): boolean {
  return EMAIL_RE.test(addr.trim());
}

export interface RecipientInputProps {
  /** Committed addresses, rendered as chips. */
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** aria-label for the text field (e.g. "Кому"). */
  ariaLabel?: string;
  /** External error highlight (e.g. parent flagged an empty required field). */
  invalid?: boolean;
}

export function RecipientInput({
  value, onChange, disabled = false, placeholder, autoFocus = false, ariaLabel, invalid = false,
}: RecipientInputProps) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Pure append: split `raw` into tokens and return `current` with the new,
  // case-insensitively de-duplicated addresses appended. Returns `current`
  // (same ref) when nothing is added, so callers can cheaply detect no-ops.
  const appendTokens = (current: string[], raw: string): string[] => {
    const parts = raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return current;
    const seen = new Set(current.map((v) => v.toLowerCase()));
    const additions: string[] = [];
    for (const p of parts) {
      const key = p.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        additions.push(p);
      }
    }
    return additions.length ? [...current, ...additions] : current;
  };

  // Commit the draft (and anything a paste split off) into chips.
  const commit = useCallback((raw: string) => {
    const next = appendTokens(value, raw);
    if (next !== value) onChange(next);
    setDraft('');
  }, [value, onChange]);

  const removeAt = useCallback((idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
    inputRef.current?.focus();
  }, [value, onChange]);

  // Click a chip → pop it back into the editable draft to fix a typo (the main
  // case being an invalid "red" chip). Any in-progress draft is committed FIRST
  // so nothing typed is silently dropped. Both mutations are computed against
  // the current `value` prop synchronously — a second onChange in the same tick
  // would otherwise race on the stale prop. Appended tokens go to the end, so
  // the clicked chip keeps its index `idx` in the committed array.
  const startEditing = useCallback((idx: number) => {
    if (disabled) return;
    const target = value[idx];
    const withDraft = draft.trim() ? appendTokens(value, draft) : value;
    onChange(withDraft.filter((_, i) => i !== idx));
    setDraft(target);
    inputRef.current?.focus();
  }, [value, draft, disabled, onChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === ' ' || e.key === 'Tab') {
      if (draft.trim()) {
        // Tab still moves focus when the field is empty; only intercept it to commit.
        e.preventDefault();
        commit(draft);
      }
    } else if (e.key === 'Backspace' && !draft && value.length) {
      e.preventDefault();
      removeAt(value.length - 1);
    }
  };

  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-wrap items-center gap-1',
        disabled && 'opacity-60',
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((addr, idx) => {
        const bad = !isValidEmail(addr);
        return (
          <span
            key={`${addr}-${idx}`}
            className={cn(
              'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs',
              bad
                ? 'bg-[var(--color-error)]/10 text-[var(--color-error)] ring-1 ring-[var(--color-error)]/40'
                : 'bg-[var(--bg-secondary)] text-[var(--text-primary)]',
            )}
          >
            <button
              type="button"
              disabled={disabled}
              title={
                disabled
                  ? (bad ? 'Похоже, это не адрес почты' : addr)
                  : `${bad ? 'Похоже, это не адрес почты. ' : ''}Нажмите, чтобы изменить`
              }
              onClick={(e) => { e.stopPropagation(); startEditing(idx); }}
              className={cn(
                'min-w-0 truncate bg-transparent text-inherit',
                !disabled && 'cursor-pointer outline-none focus-visible:underline',
              )}
            >
              {addr}
            </button>
            {!disabled && (
              <button
                type="button"
                aria-label={`Убрать ${addr}`}
                onClick={(e) => { e.stopPropagation(); removeAt(idx); }}
                className="flex-shrink-0 text-[var(--text-tertiary)] transition-colors hover:text-[var(--color-error)]"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        );
      })}
      <input
        ref={inputRef}
        type="text"
        inputMode="email"
        autoComplete="off"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => draft.trim() && commit(draft)}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (/[,;\s]/.test(text)) {
            e.preventDefault();
            commit(text);
          }
        }}
        disabled={disabled}
        placeholder={value.length ? '' : placeholder}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        autoFocus={autoFocus}
        className="min-w-[8ch] flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] disabled:cursor-not-allowed"
      />
    </div>
  );
}
