import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import type { TableModel } from '@/features/tables/types/table.types';
import { createHandleSave } from '../useWidgetSettingsHandlers';
import { KanbanWidgetSettings } from '../KanbanWidgetSettings';
import type { KanbanSettingsProps } from '../types';
import type { Widget, WidgetConfig } from '../../../../types/widget.types';

/** ADR-209 WP-2 — «Таблица событий» in the kanban widget settings. */

type SaveDeps = Parameters<typeof createHandleSave>[0];

async function savedKanbanConfig(widgetConfig: WidgetConfig, kanbanEventsTableId?: string) {
  const mutateAsync = vi.fn().mockResolvedValue({});
  const widget = { id: 5, preset_name: 'kanban_board', title: 'Board', icon: '🎫', config: widgetConfig } as Widget;
  await createHandleSave({
    widget, title: 'Board', description: '', icon: '🎫', selectedTableId: '1708',
    cardColumns: [], visibleColumns: [], statusColumn: 'state', titleColumn: 'what',
    kanbanEventsTableId, updateWidgetMutation: { mutateAsync }, onClose: vi.fn(),
  } as Partial<SaveDeps> as SaveDeps)();
  return mutateAsync.mock.calls[0][0].updates.config.kanban;
}

describe('createHandleSave (kanban preset)', () => {
  const existing = { kanban: { tableId: '1708', statusColumn: 'state', titleColumn: 'what', eventsTableId: 900, lanes: [] } };

  it('writes the chosen events table', async () => {
    expect((await savedKanbanConfig({}, '901')).eventsTableId).toBe('901');
  });

  it('keeps the events table the widget already has when the form does not carry the field', async () => {
    expect((await savedKanbanConfig(existing)).eventsTableId).toBe(900);
  });

  it('clears the events table when the user picks none', async () => {
    expect((await savedKanbanConfig(existing, '')).eventsTableId).toBeUndefined();
  });
});

describe('KanbanWidgetSettings — events table field', () => {
  beforeEach(() => localStorage.setItem('god-crm-language', 'en'));
  afterEach(cleanup);

  const noop = vi.fn();
  const settings = (overrides: Partial<KanbanSettingsProps>) => (
    <LanguageProvider>
      <KanbanWidgetSettings
        safeColumns={[]} selectColumns={[]} textColumns={[]} dateColumns={[]} allDisplayableColumns={[]}
        loadingColumns={false} creatingColumn={false} handleCreatePresetColumn={async () => {}}
        statusColumn="" setStatusColumn={noop} titleColumn="" setTitleColumn={noop}
        descriptionColumn="" setDescriptionColumn={noop} assigneeColumn="" setAssigneeColumn={noop}
        scheduledDateColumn="" setScheduledDateColumn={noop} dueDateColumn="" setDueDateColumn={noop}
        colorColumn="" setColorColumn={noop} cardColumns={[]} setCardColumns={noop}
        visibleColumns={[]} setVisibleColumns={noop} availableCardColumns={[]} availableExpandedColumns={[]}
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
    expect(field).toHaveAccessibleDescription(/Occurrences of recurring tickets/);
    await userEvent.setup().selectOptions(field, 'Ticket Events');
    expect(setEventsTableId).toHaveBeenCalledExactlyOnceWith('900');
  });

  it('keeps a saved table selected when the list does not carry it', () => {
    render(settings({ eventsTableId: '777', eventsTables: [] }));
    expect(screen.getByLabelText('Events table')).toHaveValue('777');
  });
});
