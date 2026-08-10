import { describe, it, expect, vi } from 'vitest';
import { createHandleSave } from '../useWidgetSettingsHandlers';
import { readDocumentsConfigFromWidget } from '../documentsConfigRead';
import type { Widget, WidgetConfig } from '../../../../types/widget.types';

/**
 * ADR-0067 P1+P2 — round-trip: canonical dual-write + canonical-first read.
 *
 * Two surfaces under test:
 *   1. createHandleSave (documents branch) — must write BOTH canonical
 *      (registry_table_id / atoms_table_id / project_id) AND legacy
 *      (documents_table_id / sections_table_id / documents_project_id / table_id).
 *   2. Modal form-load precedence — `readDocumentsConfigFromWidget` is the shared
 *      helper used by EditWidgetSettingsModal useState init and reset effect.
 */

function buildSaveDeps(overrides: {
  widgetConfig?: WidgetConfig;
  documentsTableId?: string;
  sectionsTableId?: string;
  documentsProjectId?: string;
  documentsSpaceId?: string;
}) {
  const mutateAsync = vi.fn().mockResolvedValue({});
  const onClose = vi.fn();
  const onSaved = vi.fn();

  const widget: Widget = {
    id: 218,
    dashboard_id: 1,
    source_widget_id: null,
    widget_type: 'preset',
    preset_name: 'documents',
    code: null,
    code_version: 1,
    title: 'ADRs',
    description: null,
    icon: '📄',
    config: overrides.widgetConfig ?? {},
    position: { x: 0, y: 0, w: 12, h: 8 },
    is_visible: true,
    is_module: false,
    order_index: 0,
    created_by: 1,
    created_at: '',
    updated_at: '',
    module_id: null,
    sidebar_order: null,
    sidebar_icon: null,
    access_level: null,
    is_pinned: null,
  };

  const deps = {
    widget,
    title: widget.title,
    description: '',
    icon: widget.icon,
    selectedTableId: '',
    cardColumns: [],
    visibleColumns: [],
    statusColumn: '',
    titleColumn: '',
    descriptionColumn: '',
    assigneeColumn: '',
    scheduledDateColumn: '',
    dueDateColumn: '',
    colorColumn: '',
    taskCompletedColumn: '',
    bddMode: false,
    bddCodeColumn: '',
    bddPriorityColumn: '',
    bddStatusColumn: '',
    dateColumn: '',
    calendarEndDateColumn: '',
    calendarTitleColumn: '',
    calendarDescriptionColumn: '',
    calendarColorColumn: '',
    startDateColumn: '',
    endDateColumn: '',
    timelineTitleColumn: '',
    timelineDescriptionColumn: '',
    timelineDependsOnColumn: '',
    timelineGroupByColumn: '',
    timelineCalendarTableId: '',
    timelineCalendarDateColumn: '',
    timelineCalendarTypeColumn: '',
    timelineCalendarTagsColumn: '',
    timelineCalendarNoteColumn: '',
    timelineCalendarBgColorColumn: '',
    timelineCalendarFontColorColumn: '',
    aiOperatorsTableId: '',
    aiAgentsTableId: '',
    aiChatHistoryTableId: '',
    aiRunLogsTableId: '',
    aiAnalyticsTableId: '',
    aiFeedbackTableId: '',
    documentsTableId: overrides.documentsTableId ?? '',
    sectionsTableId: overrides.sectionsTableId ?? '',
    documentsSpaceId: overrides.documentsSpaceId ?? '',
    documentsProjectId: overrides.documentsProjectId ?? '',
    ticketsTableId: '',
    ticketsColTitle: '',
    ticketsColDesc: '',
    ticketsColType: '',
    ticketsColState: '',
    ticketsColPriority: '',
    updateWidgetMutation: { mutateAsync },
    onClose,
    onSaved,
  };

  return { deps, mutateAsync, onClose, onSaved };
}

describe('ADR-0067 P1+P2 — documents-widget canonical dual-write + read-fallback', () => {
  describe('createHandleSave (documents preset)', () => {
    it('case 1 — writes BOTH canonical and legacy keys on save', async () => {
      const { deps, mutateAsync } = buildSaveDeps({
        documentsTableId: '2197',
        sectionsTableId: '2198',
        documentsProjectId: '146',
        documentsSpaceId: '11',
      });

      const handleSave = createHandleSave(deps);
      await handleSave();

      expect(mutateAsync).toHaveBeenCalledTimes(1);
      const arg = mutateAsync.mock.calls[0][0] as {
        widgetId: number;
        updates: { config: WidgetConfig };
      };
      const cfg = arg.updates.config;

      // Canonical keys (ADR-0067 §2 P1)
      expect(cfg.registry_table_id).toBe(2197);
      expect(cfg.atoms_table_id).toBe(2198);
      expect(cfg.project_id).toBe(146);
      // Legacy keys (still dual-written until ADR-0067 P5)
      expect(cfg.documents_table_id).toBe(2197);
      expect(cfg.sections_table_id).toBe(2198);
      expect(cfg.documents_project_id).toBe(146);
      expect(cfg.documents_space_id).toBe(11);
      expect(cfg.table_id).toBe(2197);
    });

    it('case 5 — edit-without-changes: canonical-only config round-trips with both keys present', async () => {
      // Simulates: modal opens against a config that ALREADY contains only canonical keys
      // (legacy stripped by some prior write or by ADR-0067 P4). Form is loaded via the
      // canonical-first precedence; user clicks Save without touching anything; the save
      // handler must NOT drop the canonical keys.
      const canonicalOnly: WidgetConfig = {
        registry_table_id: 2197,
        atoms_table_id: 2198,
        project_id: 146,
        documents_space_id: 11,
      };
      const loaded = readDocumentsConfigFromWidget(canonicalOnly);

      const { deps, mutateAsync } = buildSaveDeps({
        widgetConfig: canonicalOnly,
        documentsTableId: loaded.documentsTableId,
        sectionsTableId: loaded.sectionsTableId,
        documentsProjectId: loaded.documentsProjectId,
        documentsSpaceId: '11',
      });

      const handleSave = createHandleSave(deps);
      await handleSave();

      const cfg = (mutateAsync.mock.calls[0][0] as { updates: { config: WidgetConfig } })
        .updates.config;

      expect(cfg.registry_table_id).toBe(2197);
      expect(cfg.atoms_table_id).toBe(2198);
      expect(cfg.project_id).toBe(146);
      // dual-write is still on: legacy keys ALSO appear after save
      expect(cfg.documents_table_id).toBe(2197);
      expect(cfg.sections_table_id).toBe(2198);
      expect(cfg.documents_project_id).toBe(146);
    });

    it('case 5b — empty config save: both canonical and legacy groups are written as null', async () => {
      // Empty doc-keys config; user opens modal, clears (or never set) the table dropdowns,
      // hits Save. Handler must not throw and must emit null for all 7 documents keys so
      // that downstream readers see "unset" consistently in either namespace.
      const { deps, mutateAsync } = buildSaveDeps({
        widgetConfig: {},
        documentsTableId: '',
        sectionsTableId: '',
        documentsProjectId: '',
        documentsSpaceId: '',
      });

      const handleSave = createHandleSave(deps);
      await expect(handleSave()).resolves.toBeUndefined();

      const cfg = (mutateAsync.mock.calls[0][0] as { updates: { config: WidgetConfig } })
        .updates.config;

      // Canonical group → null
      expect(cfg.registry_table_id).toBeNull();
      expect(cfg.atoms_table_id).toBeNull();
      expect(cfg.project_id).toBeNull();
      // Legacy group → null
      expect(cfg.documents_table_id).toBeNull();
      expect(cfg.sections_table_id).toBeNull();
      expect(cfg.documents_project_id).toBeNull();
      expect(cfg.documents_space_id).toBeNull();
      // table_id is also dual-written to docs.table_id for legacy callers
      expect(cfg.table_id).toBeNull();
    });
  });

  describe('readDocumentsConfigFromWidget (shared helper used by EditWidgetSettingsModal)', () => {
    it('case 2 — canonical-only config: returns canonical values', () => {
      const config: WidgetConfig = {
        registry_table_id: 2197,
        atoms_table_id: 2198,
        project_id: 146,
      };
      expect(readDocumentsConfigFromWidget(config)).toEqual({
        documentsTableId: '2197',
        sectionsTableId: '2198',
        documentsProjectId: '146',
      });
    });

    it('case 3 — legacy-only config: falls back to legacy values', () => {
      const config: WidgetConfig = {
        documents_table_id: 2709,
        sections_table_id: 2710,
        documents_project_id: 8,
      };
      expect(readDocumentsConfigFromWidget(config)).toEqual({
        documentsTableId: '2709',
        sectionsTableId: '2710',
        documentsProjectId: '8',
      });
    });

    it('case 4 — mixed config: canonical wins over legacy', () => {
      const config: WidgetConfig = {
        registry_table_id: 2197,
        documents_table_id: 2709, // ignored — canonical wins
        atoms_table_id: 2198,
        sections_table_id: 2710, // ignored
        table_id: 2710, // ignored (third-tier fallback for atoms)
        project_id: 146,
        documents_project_id: 8, // ignored
      };
      expect(readDocumentsConfigFromWidget(config)).toEqual({
        documentsTableId: '2197',
        sectionsTableId: '2198',
        documentsProjectId: '146',
      });
    });

    it('atoms fallback ladder: atoms_table_id ?? sections_table_id ?? table_id', () => {
      // canonical absent, legacy `sections_table_id` present → that wins
      expect(
        readDocumentsConfigFromWidget({ sections_table_id: 2710, table_id: 9999 }).sectionsTableId
      ).toBe('2710');
      // canonical + legacy both absent → falls through to table_id
      expect(readDocumentsConfigFromWidget({ table_id: 9999 }).sectionsTableId).toBe('9999');
    });

    it('empty/null config: returns empty strings', () => {
      expect(readDocumentsConfigFromWidget({})).toEqual({
        documentsTableId: '',
        sectionsTableId: '',
        documentsProjectId: '',
      });
      expect(readDocumentsConfigFromWidget(undefined)).toEqual({
        documentsTableId: '',
        sectionsTableId: '',
        documentsProjectId: '',
      });
    });
  });
});
