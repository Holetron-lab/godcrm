import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { GoToRowInput } from '../GoToRowInput';

const setup = (totalRows = 15700, blocked = false) => {
  const onGoToRow = vi.fn();
  render(
    <LanguageProvider>
      <GoToRowInput totalRows={totalRows} rowCountLabel={`${totalRows} rows`} blocked={blocked} onGoToRow={onGoToRow} />
    </LanguageProvider>
  );
  return { onGoToRow };
};

const openField = (totalRows = 15700) => {
  fireEvent.click(screen.getByRole('button', { name: `${totalRows} rows` }));
  return screen.getByLabelText('Row number') as HTMLInputElement;
};

const submitRow = (input: HTMLInputElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest('form') as HTMLFormElement);
};

beforeEach(() => localStorage.setItem('god-crm-language', 'en'));
afterEach(() => localStorage.removeItem('god-crm-language'));

describe('GoToRowInput', () => {
  it('shows the row count as a button and opens a field sized to the digit count', () => {
    setup();
    expect(screen.queryByLabelText('Row number')).toBeNull();
    const input = openField();
    expect(input.style.width).toBe('6ch');
    expect(input.max).toBe('15700');
    expect(screen.getByText('/ 15700 rows')).toBeTruthy();
  });

  it('hands over a row number inside the range and collapses back to the count', () => {
    const { onGoToRow } = setup();
    submitRow(openField(), '350');
    expect(onGoToRow).toHaveBeenCalledWith(350);
    expect(screen.queryByLabelText('Row number')).toBeNull();
    expect(screen.getByRole('button', { name: '15700 rows' })).toBeTruthy();
  });

  it.each(['0', '101', '2.5', ''])('ignores "%s" for a 100-row table', (value) => {
    const { onGoToRow } = setup(100);
    submitRow(openField(100), value);
    expect(onGoToRow).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Row number')).toBeTruthy();
  });

  it('closes on Escape without navigating', () => {
    const { onGoToRow } = setup();
    const input = openField();
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onGoToRow).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Row number')).toBeNull();
  });

  it('stays a disabled count while a search or filter is active', () => {
    setup(15700, true);
    const button = screen.getByRole('button', { name: '15700 rows' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Clear the search and filters to go to a row');
  });
});
