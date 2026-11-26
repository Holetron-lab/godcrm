import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { ScheduledMessagesBar } from '../ScheduledMessagesBar';
import type { ScheduledMessage } from '../../hooks/useScheduledMessages';

vi.mock('@/shared/components/MarkdownPreview', () => ({
  MarkdownPreview: ({ content }: { content: string }) => <div>{content}</div>,
}));

const inOneHour = new Date(Date.now() + 3 * 3600_000 + 5 * 60_000).toISOString();
const base: ScheduledMessage = {
  id: 1, conversation_id: 7, sender_id: 1, sender_name: 'Alice', content: 'Daily standup',
  content_type: 'text', mentions: [], attachments: [], metadata: {},
  scheduled_at: inOneHour, next_run_at: inOneHour, status: 'pending',
  created_at: '2026-11-07T10:00:00Z', updated_at: '2026-11-07T10:00:00Z',
  recurrence_cron: '0 9 * * 1-5', timezone: 'Europe/Moscow', max_runs: null, runs_done: 12,
  last_fired_at: null, error_message: null, sender_type: 'human', agent_id: null,
};

function renderBar(messages: ScheduledMessage[], handlers: Partial<Parameters<typeof ScheduledMessagesBar>[0]> = {}) {
  window.localStorage.setItem('god-crm-language', 'ru');
  return render(
    <LanguageProvider>
      <ScheduledMessagesBar messages={messages} onCancel={() => {}} onSendNow={() => {}} onEdit={() => {}} {...handlers} />
    </LanguageProvider>
  );
}

// ADR-208 AC 10: the bar shows the series, its pause state and the next run.
describe('ScheduledMessagesBar — series rows', () => {
  it('renders a human-readable series badge with next run and runs counter', () => {
    const onPause = vi.fn();
    renderBar([base], { onPause });
    const badge = screen.getByTestId('series-badge');
    expect(badge).toHaveTextContent('по будням 09:00');
    expect(badge).toHaveTextContent('след. через 3 ч');
    expect(badge).toHaveTextContent('12/∞');
    expect(badge).toHaveAttribute('title', 'Часовой пояс серии: Europe/Moscow');

    fireEvent.click(screen.getByRole('button', { name: 'Приостановить серию' }));
    expect(onPause).toHaveBeenCalledWith(1);
    // Editing a series would cancel it, so the pencil is hidden for series rows.
    expect(screen.queryByRole('button', { name: 'Редактировать' })).toBeNull();
  });

  it('shows the paused state with resume only and the last error as a tooltip trigger', () => {
    const onResume = vi.fn();
    renderBar([{ ...base, status: 'paused', max_runs: 20, runs_done: 3, error_message: 'run failed: boom' }], { onResume });
    const badge = screen.getByTestId('series-badge');
    expect(badge).toHaveTextContent('пауза');
    expect(badge).toHaveTextContent('3/20');
    expect(badge).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Приостановить серию' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Отправить сейчас' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Последняя ошибка: run failed: boom' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Возобновить серию' }));
    expect(onResume).toHaveBeenCalledWith(1);
  });

  it('shows the raw cron when the expression is outside the preset shapes', () => {
    renderBar([{ ...base, recurrence_cron: '0 9,18 * * *' }]);
    expect(screen.getByTestId('series-badge')).toHaveTextContent('0 9,18 * * *');
  });

  it('keeps the one-time badge for rows without recurrence', () => {
    renderBar([{ ...base, recurrence_cron: null }]);
    expect(screen.getByTestId('schedule-badge')).toHaveTextContent('через 3 ч');
    expect(screen.queryByRole('button', { name: 'Приостановить серию' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Редактировать' })).toBeInTheDocument();
  });
});
