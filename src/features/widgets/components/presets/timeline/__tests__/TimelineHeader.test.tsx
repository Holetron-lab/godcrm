import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { TimelineHeader } from '../TimelineHeader';

function renderHeader() {
  const props: ComponentProps<typeof TimelineHeader> = {
    viewStartDate: new Date(2026, 8, 20), timeScale: 'day', setTimeScale: vi.fn(),
    timeUnits: [new Date(2026, 8, 20)], totalUnits: 1,
    viewMode: 'timeline', setViewMode: vi.fn(), edgesMode: false, setEdgesMode: vi.fn(),
    allGroups: [], selectedGroups: new Set(), setSelectedGroups: vi.fn(),
    onNavigate: vi.fn(), onGoToToday: vi.fn(), onGoToDate: vi.fn(),
    onApplyDateRange: vi.fn(), onStepNavigate: vi.fn(), onPrint: vi.fn(),
  };
  render(<TimelineHeader {...props} />);
  return props;
}

describe('TimelineHeader popover keyboard access', () => {
  it('opens the date range from the keyboard, then closes with Escape and restores focus', async () => {
    const user = userEvent.setup();
    renderHeader();
    const trigger = screen.getByTitle('Нажмите для выбора диапазона дат');
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('С', { exact: true })).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByLabelText('С', { exact: true })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('applies the selected range and returns focus to its trigger', async () => {
    const user = userEvent.setup();
    const props = renderHeader();
    const trigger = screen.getByTitle('Нажмите для выбора диапазона дат');
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Применить' }));
    expect(props.onApplyDateRange).toHaveBeenCalledWith('2026-09-20', '2026-09-20', props.setTimeScale);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('closes the step picker with Escape and preserves the chosen step for navigation', async () => {
    const user = userEvent.setup();
    const props = renderHeader();
    const trigger = screen.getByTitle('Выбрать шаг навигации');
    trigger.focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Деление' })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'Неделя' }));
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(screen.getByTitle('Сдвинуть вперёд'));
    expect(props.onStepNavigate).toHaveBeenCalledWith(1, 'week');
  });
});
