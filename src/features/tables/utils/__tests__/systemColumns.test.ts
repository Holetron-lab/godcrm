import { beforeEach, describe, expect, it } from 'vitest';
import type { ColumnModel } from '../../types/table.types';
import * as systemColumnsModule from '../systemColumns';
import {
  SYS_CREATED_AT_ID,
  SYS_UPDATED_AT_ID,
  SYSTEM_COLUMN_DEFAULT_WIDTH,
  buildSystemColumns,
  getSystemColumnOverrides,
  getSystemColumnVisibility,
  isSystemColumnId,
  setSystemColumnOverride,
  setSystemColumnVisibility,
} from '../systemColumns';

const build = () => buildSystemColumns({ tableId: 42, createdLabel: 'Created', updatedLabel: 'Updated' });

const col = (overrides: Partial<ColumnModel>): ColumnModel => ({
  id: 'c', tableId: '42', name: 'c', displayName: 'C', type: 'text', config: {},
  isRequired: false, isReadonly: false, orderIndex: 0, width: 160, isVisible: true, ...overrides,
});

describe('ADR-0035-A (AC6): the virtual raw `lat, lng` sibling is gone', () => {
  beforeEach(() => window.localStorage.clear());

  it('exports no sibling helpers any more', () => {
    const mod = systemColumnsModule as Record<string, unknown>;
    for (const name of ['withGeoRawSiblings', 'buildGeoRawColumn', 'hasGeoRawSibling', 'geoRawColumnId', 'isGeoRawColumnId', 'getGeoRawParentId', 'GEO_RAW_ID_PREFIX']) {
      expect(mod[name], name).toBeUndefined();
    }
  });

  it('the old `__geo_raw_<id>` id is not a system column, and only the two timestamps are synthesized', () => {
    expect(isSystemColumnId('__geo_raw_77')).toBe(false);
    expect(build().map((c) => c.id)).toEqual([SYS_CREATED_AT_ID, SYS_UPDATED_AT_ID]);
  });

  it('a geo_point column with the legacy raw_sibling flag ON stays a single column (the flag is ignored)', () => {
    const geo = col({ id: '77', name: 'where', type: 'geo_point', config: { geo: { version: 1, raw_sibling: true, indexed: false } } });
    // Nothing in this module splices anything next to it; the grid consumes `realColumns` verbatim.
    expect(isSystemColumnId(geo.id)).toBe(false);
    setSystemColumnOverride(42, '__geo_raw_77', { width: 300 });
    expect(getSystemColumnOverrides(42)).toEqual({});
  });
});

describe('systemColumns overrides', () => {
  beforeEach(() => window.localStorage.clear());

  it('builds hidden, read-only datetime columns with defaults', () => {
    const [created, updated] = build();
    expect(created.id).toBe(SYS_CREATED_AT_ID);
    expect(updated.id).toBe(SYS_UPDATED_AT_ID);
    expect(created).toMatchObject({
      name: 'created_at',
      displayName: 'Created',
      type: 'datetime',
      isReadonly: true,
      isVisible: false,
      width: SYSTEM_COLUMN_DEFAULT_WIDTH,
    });
    expect(created.config.date?.displayFormat).toBe('datetime_default');
    expect(created.config.appearance?.indicator?.value).toBe('🕐');
  });

  it('applies saved title, icon, date format and width; key and type stay fixed', () => {
    setSystemColumnOverride(42, SYS_CREATED_AT_ID, {
      displayName: 'Добавлено',
      width: 220,
      config: {
        date: { storageFormat: 'iso', displayFormat: 'time_only', mode: 'datetime' },
        appearance: { indicator: { type: 'emoji', value: '📌' }, align: 'center' },
      },
    });
    const [created, updated] = build();
    expect(created).toMatchObject({ name: 'created_at', type: 'datetime', displayName: 'Добавлено', width: 220, isReadonly: true });
    expect(created.config.date?.displayFormat).toBe('time_only');
    expect(created.config.appearance?.indicator?.value).toBe('📌');
    expect(created.config.appearance?.align).toBe('center');
    expect(updated.displayName).toBe('Updated');
  });

  it('merges patches and ignores undefined fields', () => {
    setSystemColumnOverride(42, SYS_UPDATED_AT_ID, { displayName: 'Touched' });
    setSystemColumnOverride(42, SYS_UPDATED_AT_ID, { width: 300, displayName: undefined });
    expect(getSystemColumnOverrides(42)[SYS_UPDATED_AT_ID]).toEqual({ displayName: 'Touched', width: 300 });
  });

  it('falls back to the default label when the saved title is blank', () => {
    setSystemColumnOverride(42, SYS_CREATED_AT_ID, { displayName: '   ' });
    expect(build()[0].displayName).toBe('Created');
  });

  it('keeps visibility in the same store and honors the legacy visibility key', () => {
    window.localStorage.setItem('crm.table.42.systemColumnVisibility', JSON.stringify({ [SYS_UPDATED_AT_ID]: true }));
    expect(getSystemColumnVisibility(42, SYS_UPDATED_AT_ID)).toBe(true);
    expect(build()[1].isVisible).toBe(true);

    setSystemColumnVisibility(42, SYS_UPDATED_AT_ID, false);
    expect(getSystemColumnVisibility(42, SYS_UPDATED_AT_ID)).toBe(false);
    expect(build()[1].isVisible).toBe(false);
  });

  it('ignores writes for non-system ids and tables without id', () => {
    setSystemColumnOverride(42, 'real-column', { width: 999 });
    setSystemColumnOverride(null, SYS_CREATED_AT_ID, { width: 999 });
    expect(getSystemColumnOverrides(42)).toEqual({});
    expect(window.localStorage.length).toBe(0);
  });
});
