import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import type { TableModel } from '@/features/tables/types/table.types';
import { createHandleSave } from '../useWidgetSettingsHandlers';
import { CalendarWidgetSettings } from '../CalendarWidgetSettings';
import type { CalendarSettingsProps } from '../types';
import type { Widget, WidgetConfig } from '../../../../types/widget.types';

/** ADR-209 WP-3 (D7) — «Таблица событий» in the calendar widget settings. */

type SaveDeps = Parameters<typeof createHandleSave>[0];

async function savedCalendarConfig(widgetConfig: WidgetConfig, calendarEventsTableId?: string) {
  const mutateAsync = vi.fn().mockResolvedValue({});
  const widget = { id: 6, preset_name: 'calendar_widget', title: 'Calendar', icon: '📅', config: widgetConfig } as Widget;
  await createHandleSave({
    widget, title: 'Calendar', description: '', icon: '📅', selectedTableId: '1708',
    cardColumns: [], visibleColumns: [], dateColumn: 'scheduled_date', calendarTitleColumn: 'what',
    calendarEventsTableId, updateWidgetMutation: { mutateAsync }, onClose: vi.fn(),
  } as Partial<SaveDeps> as SaveDeps)();
  return mutateAsync.mock.calls[0][0].updates.config.calendar;
}

describe('createHandleSave (calendar preset)', () => {
  const existing = { calendar: { tableId: '1708', dateColumn: 'scheduled_date', titleColumn: 'what', eventsTableId: 900 } };

  it('writes the chosen events table', async () => {
    expect((await savedCalendarConfig({}, '901')).eventsTableId).toBe('901');
  });

  it('keeps the events table the widget already has when the form does not carry the field', async () => {
    expect((await savedCalendarConfig(existing)).eventsTableId).toBe(900);
  });

  it('clears the events table when the user picks none', async () => {
    expect((await savedCalendarConfig(existing, '')).eventsTableId).toBeUndefined();
  });
});

describe('CalendarWidgetSettings — events table field', () => {
  beforeEach(() => localStorage.setItem('god-crm-language', 'en'));
  afterEach(cleanup);

  const noop = vi.fn();
  const settings = (overrides: Partial<CalendarSettingsProps>) => (
    <LanguageProvider>
      <CalendarWidgetSettings
        safeColumns={[]} selectColumns={[]} textColumns={[]} dateColumns={[]} allDisplayableColumns={[]}
        loadingColumns={false} creatingColumn={false} handleCreatePresetColumn={async () => {}}
        dateColumn="" setDateColumn={noop} calendarEndDateColumn="" setCalendarEndDateColumn={noop}
        calendarTitleColumn="" setCalendarTitleColumn={noop}
        calendarDescriptionColumn="" setCalendarDescriptionColumn={noop}
        calendarColorColumn="" setCalendarColorColumn={noop}
        eventsTableId="" setEventsTableId={noop}
        eventsTables={[{ id: '900', name: 'ticket_events', displayName: 'Ticket Events' } as TableModel]}
        {...overrides}
      />
    </LanguageProvider>
  );

  it('offers the tables of the project and reports the choice', async () => {
    const setEventsTableId = vi.fn();
    render(settings({ setEventsTableId }));
    const field = screen.getByLabelText('Events table');
    expect(field).toHaveAccessibleDescription(/drawn as its occurrences/);
    await userEvent.setup().selectOptions(field, 'Ticket Events');
    expect(setEventsTableId).toHaveBeenCalledExactlyOnceWith('900');
  });

  it('keeps a saved table selected when the list does not carry it', () => {
    render(settings({ eventsTableId: '777', eventsTables: [] }));
    expect(screen.getByLabelText('Events table')).toHaveValue('777');
  });
});
