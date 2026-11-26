import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TimeCell, formatCronLabel } from '../TimeCell';

/** ADR-209 D8 — several weekdays in one cron value. */

describe('formatCronLabel', () => {
  it('reads a list of weekdays, week starting on Monday', () => {
    expect(formatCronLabel('0 18 * * 1,3,5')).toBe('пн, ср, пт 18:00');
    expect(formatCronLabel('0 10 * * 0,6')).toBe('сб, вс 10:00');
  });

  it('reads a range and 7 as Sunday', () => {
    expect(formatCronLabel('30 9 * * 1-3')).toBe('пн, вт, ср 09:30');
    expect(formatCronLabel('0 10 * * 6,7')).toBe('сб, вс 10:00');
  });

  it('reads single-day, monthly and plain values as before', () => {
    expect(formatCronLabel('30 14 * * 1')).toBe('Пн, 14:30');
    expect(formatCronLabel('30 14 15 * *')).toBe('15-е, 14:30');
    expect(formatCronLabel('30 14 * * *')).toBe('14:30');
    expect(formatCronLabel('14:30')).toBe('14:30');
    expect(formatCronLabel('')).toBeNull();
  });

  it('falls back to the time when the weekday field is not a list of days', () => {
    expect(formatCronLabel('0 18 * * MON')).toBe('18:00');
  });
});

describe('TimeCell — weekdays', () => {
  it('shows every weekday of the value', () => {
    render(<TimeCell value="0 18 * * 1,3,5" />);

    expect(screen.getByText('пн, ср, пт 18:00')).toBeInTheDocument();
  });

  it('edits the list of weekdays and saves it as one cron value', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<TimeCell value="0 18 * * 1,3,5" isEditing onSave={onSave} />);

    expect(screen.getByRole('button', { name: 'Понедельник' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Вторник' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: 'Вторник' }));
    await user.click(screen.getByRole('button', { name: 'Пятница' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(onSave).toHaveBeenCalledWith('0 18 * * 1,2,3');
  });

  it('saves a single-day value unchanged', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<TimeCell value="30 14 * * 1" isEditing onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(onSave).toHaveBeenCalledWith('30 14 * * 1');
  });

  it('keeps the last weekday selected', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<TimeCell value="30 14 * * 1" isEditing onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Понедельник' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(screen.getByRole('button', { name: 'Понедельник' })).toHaveAttribute('aria-pressed', 'true');
    expect(onSave).toHaveBeenCalledWith('30 14 * * 1');
  });
});
