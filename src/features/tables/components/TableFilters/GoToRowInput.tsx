import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface GoToRowInputProps {
  totalRows: number;
  /** Localised "15 675 rows" — the collapsed state and the suffix behind the open field. */
  rowCountLabel: string;
  /** Row numbers are unfiltered positions; with a search or filter active the field stays closed. */
  blocked: boolean;
  onGoToRow: (rowNumber: number) => void;
}

/** Row count on the toolbar that, like the filter button, flips into a number field sized to the digit count. */
export const GoToRowInput = ({ totalRows, rowCountLabel, blocked, onGoToRow }: GoToRowInputProps) => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');

  const close = () => {
    setValue('');
    setOpen(false);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const rowNumber = Number(value);
    if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > totalRows) return;
    onGoToRow(rowNumber);
    close();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={blocked}
        title={blocked ? t('table.goToRowFiltered') : t('table.goToRow')}
        className="px-1.5 py-0.5 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors disabled:hover:bg-transparent disabled:hover:text-[var(--text-secondary)] disabled:cursor-not-allowed"
      >
        {rowCountLabel}
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1">
      <input
        name="rowNumber"
        type="number"
        inputMode="numeric"
        min={1}
        max={totalRows}
        step={1}
        required
        ref={(element) => element?.focus()}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={close}
        aria-label={t('table.rowNumber')}
        title={t('table.rowNumberRange', { total: totalRows })}
        style={{ width: `${String(totalRows).length + 1}ch` }}
        className="px-1 py-0.5 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:outline-none focus:border-[var(--color-primary)]"
      />
      <span className="text-[var(--text-secondary)]">/ {rowCountLabel}</span>
    </form>
  );
};
