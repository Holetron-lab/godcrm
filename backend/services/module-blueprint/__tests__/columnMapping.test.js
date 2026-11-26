import { describe, expect, it } from 'vitest';
import {
  convertValue,
  planColumnBindings,
  remapSeedGroup,
} from '../columnMapping.js';

const column = (column_name, type = 'text', extra = {}) => ({ column_name, type, ...extra });

describe('ADR-207 W1.2 column bindings', () => {
  it('auto-matches normalized column_name first, then display_name', () => {
    const { columns, conflicts } = planColumnBindings({
      table: 'items',
      declared: [
        column('ticket_status', 'text', { display_name: 'Ticket Status' }),
        column('assigned_to', 'user', { display_name: 'Assigned To' }),
        column('new_field', 'text'),
      ],
      existing: [
        column('Ticket Status', 'text', { display_name: 'Internal key' }),
        column('owner', 'user', { display_name: 'assigned to' }),
      ],
    });

    expect(columns.map(({ module_column, target, match }) => ({ module_column, target, match }))).toEqual([
      { module_column: 'ticket_status', target: 'Ticket Status', match: 'column_name' },
      { module_column: 'assigned_to', target: 'owner', match: 'display_name' },
      { module_column: 'new_field', target: '__new', match: 'new' },
    ]);
    expect(conflicts).toEqual([]);
  });

  it('matches module_column against display_name even when the blueprint display name differs', () => {
    const { columns, conflicts } = planColumnBindings({
      table: 'items',
      declared: [column('assigned_to', 'user', { display_name: 'Owner' })],
      existing: [column('owner', 'user', { display_name: 'Assigned To' })],
    });

    expect(columns[0]).toMatchObject({ target: 'owner', match: 'display_name', compat: 'ok' });
    expect(conflicts).toEqual([]);
  });

  it('rejects __new when the module column already exists under the same name', () => {
    const { columns, conflicts } = planColumnBindings({
      table: 'items',
      declared: [column('status')],
      existing: [column('status')],
      manual: [{ module_column: 'status', target: '__new' }],
    });

    expect(columns[0].compat).toBe('conflict');
    expect(conflicts).toEqual([
      expect.objectContaining({ kind: 'COLUMN_TARGET_EXISTS', column: 'status', blocking: true }),
    ]);
  });

  it('gives manual mapping priority over auto-match and enforces required columns', () => {
    const { columns, conflicts } = planColumnBindings({
      table: 'items',
      declared: [column('status', 'text', { required: true })],
      existing: [column('status', 'text'), column('state', 'text')],
      manual: [{ module_column: 'status', target: null }],
    });

    expect(columns[0]).toMatchObject({ target: null, match: 'manual' });
    expect(conflicts).toEqual([
      expect.objectContaining({ kind: 'REQUIRED_COLUMN_UNMAPPED', column: 'status', blocking: true }),
    ]);
  });

  it('reports an unknown manual target as a blocking conflict', () => {
    const { conflicts } = planColumnBindings({
      table: 'items',
      declared: [column('status')],
      existing: [],
      manual: [{ module_column: 'status', target: 'missing' }],
    });

    expect(conflicts).toEqual([
      expect.objectContaining({ kind: 'COLUMN_TARGET_NOT_FOUND', target: 'missing', blocking: true }),
    ]);
  });

  const matrixTypes = ['text', 'number', 'select', 'date', 'datetime', 'user', 'relation', 'checkbox', 'json'];
  const allowedSources = {
    text: matrixTypes,
    number: ['number'],
    select: ['select', 'text'],
    date: ['date'],
    user: ['user'],
    relation: ['relation'],
  };

  it.each(matrixTypes.flatMap((targetType) => matrixTypes.map((sourceType) => [
    targetType,
    sourceType,
    targetType === sourceType || (allowedSources[targetType] || []).includes(sourceType) ? 'ok' : 'conflict',
  ])))('compat %s ← %s = %s', (targetType, sourceType, compat) => {
    const { columns, conflicts } = planColumnBindings({
      table: 'items',
      declared: [column('source', sourceType)],
      existing: [column('target', targetType)],
      manual: [{ module_column: 'source', target: 'target' }],
    });

    expect(columns[0].compat).toBe(compat);
    expect(conflicts).toHaveLength(compat === 'ok' ? 0 : 1);
    if (compat === 'conflict') {
      expect(conflicts[0]).toMatchObject({
        kind: 'column_type', existing_type: targetType, declared_type: sourceType, blocking: true,
      });
    }
  });

  it('plans only genuinely missing select options, with a count', () => {
    const { columns, conflicts } = planColumnBindings({
      table: 'items',
      declared: [column('status', 'text')],
      existing: [column('state', 'select', {
        config: { options: [{ label: 'Open', value: 'open' }, 'Done'] },
      })],
      manual: [{ module_column: 'status', target: 'state' }],
      seedGroups: [{ table: 'items', key: ['status'], rows: [
        { status: 'Open' }, { status: 'New' }, { status: 'new' }, { status: 'Done' },
      ] }],
    });

    expect(columns[0]).toMatchObject({ compat: 'ok', options_added: 1, options_to_add: ['New'] });
    expect(conflicts).toEqual([]);
  });

  it('plans select options when the target has no options config yet', () => {
    const { columns, conflicts } = planColumnBindings({
      table: 'items',
      declared: [column('status', 'text')],
      existing: [column('state', 'select')],
      manual: [{ module_column: 'status', target: 'state' }],
      seedGroups: [{ table: 'items', key: ['status'], rows: [{ status: 'New' }] }],
    });

    expect(columns[0]).toMatchObject({ compat: 'ok', options_added: 1, options_to_add: ['New'] });
    expect(conflicts).toEqual([]);
  });

  it('merges declared select options with seed values and resolves their labels', () => {
    const declared = [column('status', 'select', {
      config: { options: ['Open', { label: 'In Progress', value: 'in_progress' }] },
    })];
    const { columns } = planColumnBindings({
      table: 'items',
      declared,
      existing: [column('state', 'select', { config: { options: ['Open'] } })],
      manual: [{ module_column: 'status', target: 'state' }],
      seedGroups: [{ table: 'items', key: ['status'], rows: [{ status: 'In Progress' }] }],
    });

    expect(columns[0]).toMatchObject({
      options_added: 1,
      options_to_add: [{ label: 'In Progress', value: 'in_progress' }],
    });
    const remapped = remapSeedGroup({ table: 'items', key: ['status'], rows: [{ status: 'In Progress' }] }, {
      key: 'items', action: 'connect', columns,
    }, [column('state', 'select', { config: { options: ['Open'] } })]);
    expect(remapped.group.rows).toEqual([{ state: 'in_progress' }]);
  });

  it('does not plan select writes for seed disabled by a skipped natural key', () => {
    const { columns } = planColumnBindings({
      table: 'items',
      declared: [column('name'), column('status')],
      existing: [column('state', 'select', { config: { options: [] } })],
      manual: [
        { module_column: 'name', target: null },
        { module_column: 'status', target: 'state' },
      ],
      seedGroups: [{ table: 'items', key: ['name'], rows: [{ name: 'One', status: 'New' }] }],
    });

    expect(columns[1].options_added).toBe(0);
    expect(columns[1].options_to_add).toEqual([]);
  });
});

describe('ADR-207 W1.2 seed dictionary', () => {
  it('remaps rows and natural keys, converts values and resolves select options', () => {
    const planned = {
      key: 'items',
      action: 'connect',
      columns: [
        { module_column: 'name', target: 'title', module_type: 'text', target_type: 'text' },
        { module_column: 'amount', target: 'total', module_type: 'number', target_type: 'number' },
        { module_column: 'status', target: 'state', module_type: 'text', target_type: 'select' },
        { module_column: 'notes', target: null, module_type: 'text', target_type: null },
      ],
    };
    const existing = [
      column('title', 'text'),
      column('total', 'number'),
      column('state', 'select', { config: { options: [{ label: 'Open', value: 'open' }] } }),
    ];

    const result = remapSeedGroup({
      table: 'items',
      key: ['name'],
      rows: [{ name: 'One', amount: '1 234,5', status: 'Open', notes: 'drop me' }],
    }, planned, existing);

    expect(result.disabled_reason).toBeNull();
    expect(result.group.key).toEqual(['title']);
    expect(result.group.rows).toEqual([{ title: 'One', total: 1234.5, state: 'open' }]);
  });

  it('disables seed with a warning when a natural-key column is skipped', () => {
    const result = remapSeedGroup({
      table: 'items', key: ['name'], rows: [{ name: 'One', notes: 'x' }],
    }, {
      key: 'items', action: 'connect', columns: [
        { module_column: 'name', target: null, module_type: 'text', target_type: null },
        { module_column: 'notes', target: 'notes', module_type: 'text', target_type: 'text' },
      ],
    }, []);

    expect(result.group).toBeNull();
    expect(result.disabled_reason).toMatch(/name/);
    expect(result.warning).toMatch(/disabled/i);
  });

  it('uses the module column and type for __new mappings', () => {
    const result = remapSeedGroup({
      table: 'items', key: ['code'], rows: [{ code: 'A', amount: '2,5' }],
    }, {
      key: 'items', action: 'connect', columns: [
        { module_column: 'code', target: 'code', module_type: 'text', target_type: 'text' },
        { module_column: 'amount', target: '__new', module_type: 'number', target_type: 'number' },
      ],
    }, [column('code', 'text')]);

    expect(result.group.rows).toEqual([{ code: 'A', amount: 2.5 }]);
  });

  it('reads every source value before applying chained or colliding targets', () => {
    const result = remapSeedGroup({
      table: 'items', key: ['name'], rows: [{ name: 'One', status: 'Open' }],
    }, {
      key: 'items', action: 'connect', columns: [
        { module_column: 'name', target: 'status', module_type: 'text', target_type: 'text' },
        { module_column: 'status', target: 'state', module_type: 'text', target_type: 'text' },
      ],
    }, []);

    expect(result.group.key).toEqual(['status']);
    expect(result.group.rows).toEqual([{ status: 'One', state: 'Open' }]);
  });
});

describe('ADR-207 W1.3 relation targets', () => {
  const relation = (column_name, target, config) => column(column_name, 'relation', { target, config });

  it.each([
    [{ relation: { tableId: '700' } }],
    [{ relation: { table_id: 700 } }],
    [{ relatedTableId: 700 }],
  ])('accepts a matching resolved target with legacy config %#', (existingConfig) => {
    const { columns, conflicts } = planColumnBindings({
      table: 'tickets',
      declared: [relation('company', 'companies', { relation: { tableId: 999 } })],
      existing: [column('company_id', 'relation', { config: existingConfig })],
      manual: [{ module_column: 'company', target: 'company_id' }],
      relationTargets: { companies: 700 },
    });

    expect(columns[0]).toMatchObject({ compat: 'ok', target: 'company_id' });
    expect(conflicts).toEqual([]);
  });

  it('reports a blocking relation_target conflict with expected and actual ids', () => {
    const { columns, conflicts } = planColumnBindings({
      table: 'tickets',
      declared: [relation('company', 'companies', { relation: { tableId: 999 } })],
      existing: [column('company_id', 'relation', { config: { relation: { tableId: 701 } } })],
      manual: [{ module_column: 'company', target: 'company_id' }],
      relationTargets: { companies: 700 },
    });

    expect(columns[0]).toMatchObject({ compat: 'conflict', reason: 'relation_target: 700 ≠ 701' });
    expect(conflicts).toEqual([
      expect.objectContaining({
        kind: 'relation_target', table: 'tickets', column: 'company', target: 'company_id',
        expected_table_id: 700, actual_table_id: 701, blocking: true,
      }),
    ]);
  });

  it('allows mismatch resolution only by adding the module column or skipping it', () => {
    const { columns, conflicts } = planColumnBindings({
      table: 'tickets',
      declared: [
        relation('company', 'companies', { relation: { tableId: 999 } }),
        relation('backup_company', 'companies', { relation: { tableId: 999 } }),
      ],
      existing: [column('company_id', 'relation', { config: { relation: { tableId: 701 } } })],
      manual: [
        { module_column: 'company', target: '__new' },
        { module_column: 'backup_company', target: null },
      ],
      relationTargets: { companies: 700 },
    });

    expect(columns.map((item) => item.compat)).toEqual(['ok', 'ok']);
    expect(conflicts).toEqual([]);
  });
});

describe('convertValue', () => {
  it('keeps CSV conversion semantics without mutating non-string values', () => {
    expect(convertValue('', 'text')).toBeNull();
    expect(convertValue('1 234,5', 'number')).toBe(1234.5);
    expect(convertValue('not a number', 'number')).toBeNull();
    expect(convertValue('yes', 'checkbox')).toBe(true);
    expect(convertValue('2026-11-07', 'date')).toBe('2026-11-07T00:00:00.000Z');
    const object = { nodes: [] };
    expect(convertValue(object, 'json')).toBe(object);
  });
});
