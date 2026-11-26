// ADR-207 W3.3 — user actions on the install plan produce the exact `bindings` the server accepts.
import { describe, expect, it } from 'vitest';
import {
  connectCandidate, exampleTables, examplesOffByDefault, setApp, setColumnTarget, setExamples, setProject, setSeed, setSidebar, setTableChoice, setTile, tableChoice,
} from '../bindings';
import type { PlanTable } from '../types';
import { blueprint, plan } from './fixtures';

const table = (over: Partial<PlanTable>): PlanTable =>
  ({ key: 'tickets', name: 'tickets', table_id: null, action: 'create', columns_added: [], ...over });

describe('table choice', () => {
  it('reads the choice back from the plan', () => {
    expect(tableChoice(table({}))).toBe('create');
    expect(tableChoice(table({ action: 'skip' }))).toBe('skip');
    expect(tableChoice(table({ action: 'connect', table_id: 1708 }))).toBe('connect:1708');
    expect(tableChoice(table({ action: 'columns_added', table_id: 5 }))).toBe('connect:5');
    expect(tableChoice(table({ action: 'requires' }))).toBe('');
  });

  it('writes create / connect / skip bindings', () => {
    expect(setTableChoice({}, 'tickets', 'create')).toEqual({ tables: { tickets: { action: 'create' } } });
    expect(setTableChoice({}, 'tickets', 'skip')).toEqual({ tables: { tickets: { action: 'skip' } } });
    expect(setTableChoice({}, 'tickets', 'connect:1708'))
      .toEqual({ tables: { tickets: { action: 'connect', table_id: 1708 } } });
  });

  it('keeps the seed flag and drops column overrides made for another table', () => {
    const before = {
      tables: { tickets: { action: 'connect' as const, table_id: 1, seed: false, columns: [{ module_column: 'status', target: 'state' }] } },
    };
    expect(setTableChoice(before, 'tickets', 'connect:2'))
      .toEqual({ tables: { tickets: { action: 'connect', table_id: 2, seed: false } } });
    expect(setTableChoice(before, 'tickets', 'create'))
      .toEqual({ tables: { tickets: { action: 'create', seed: false } } });
  });
});

describe('column mapping', () => {
  const connected = table({ action: 'connect', table_id: 1708 });

  it('walks auto-match → rename → __new → null, one override per module column', () => {
    let bindings = setColumnTarget({}, connected, 'status', 'state');
    expect(bindings).toEqual({
      tables: { tickets: { action: 'connect', table_id: 1708, columns: [{ module_column: 'status', target: 'state' }] } },
    });
    bindings = setColumnTarget(bindings, connected, 'status', '__new');
    bindings = setColumnTarget(bindings, connected, 'notes', null);
    expect(bindings.tables?.tickets).toEqual({
      action: 'connect',
      table_id: 1708,
      columns: [{ module_column: 'status', target: '__new' }, { module_column: 'notes', target: null }],
    });
  });

  it('turns a name-matched table into an explicit connect', () => {
    expect(setColumnTarget({}, table({ action: 'existing', table_id: 9 }), 'title', null).tables?.tickets)
      .toEqual({ action: 'connect', table_id: 9, columns: [{ module_column: 'title', target: null }] });
  });
});

describe('seed, project, app, tile, sidebar', () => {
  it('sets the seed flag on the binding the plan already implies', () => {
    expect(setSeed({}, table({}), false)).toEqual({ tables: { tickets: { action: 'create', seed: false } } });
    expect(setSeed({}, table({ action: 'connect', table_id: 3 }), true))
      .toEqual({ tables: { tickets: { action: 'connect', table_id: 3, seed: true } } });
  });

  it('leaves an unbound required table alone', () => {
    expect(setSeed({}, table({ action: 'requires' }), false)).toEqual({});
  });

  it('binds projects, apps, tiles and sidebar entries', () => {
    expect(setProject({}, 'main', null)).toEqual({ projects: { main: { action: 'create' } } });
    expect(setProject({}, 'main', 8398)).toEqual({ projects: { main: { action: 'use', project_id: 8398 } } });
    expect(setApp({}, 'board', 110)).toEqual({ apps: { board: { action: 'adopt', widget_id: 110 } } });
    expect(setApp({}, 'board', null)).toEqual({ apps: { board: { action: 'create' } } });
    expect(setTile({}, 'open_count', 7536)).toEqual({ tiles: { open_count: { dashboard_id: 7536 } } });
    expect(setTile({}, 'open_count', 'skip')).toEqual({ tiles: { open_count: { action: 'skip' } } });
    expect(setSidebar({}, 'board', false)).toEqual({ sidebar: { board: false } });
  });

  it('returns a tile to the module dashboard by removing its binding', () => {
    expect(setTile({ tiles: { open_count: { action: 'skip' } } }, 'open_count', null)).toEqual({ tiles: {} });
  });
});

describe('example rows', () => {
  const seeded = { ...blueprint, seed: [{ table: 'sla', key: ['name'], rows: [{}], example: true }, { table: 'tickets', key: ['id'], rows: [{}] }] };
  const planned = plan();

  it('names the tables whose seed rows are examples, once each', () => {
    expect(exampleTables(seeded)).toEqual(['sla']);
    expect(exampleTables({ ...seeded, seed: [...seeded.seed, { table: 'sla', key: ['id'], example: true }] })).toEqual(['sla']);
    expect(exampleTables(blueprint)).toEqual([]);
  });

  it('writes an explicit no for the example tables the user has not decided on, and leaves the rest alone', () => {
    expect(examplesOffByDefault({}, seeded, planned)).toEqual({ tables: { sla: { action: 'create', seed: false } } });
    const decided = { tables: { sla: { action: 'create' as const, seed: true } } };
    expect(examplesOffByDefault(decided, seeded, planned)).toBe(decided);
    expect(examplesOffByDefault({}, blueprint, planned)).toEqual({});
  });

  it('turns every example table on or off at once', () => {
    expect(setExamples({}, seeded, planned, true)).toEqual({ tables: { sla: { action: 'create', seed: true } } });
    expect(setExamples({ tables: { sla: { action: 'connect', table_id: 3, seed: true } } }, seeded, planned, false))
      .toEqual({ tables: { sla: { action: 'connect', table_id: 3, seed: false } } });
  });
});

describe('table a link brought along', () => {
  it('goes to the table the module needs an existing one for', () => {
    expect(connectCandidate(blueprint, 7)).toEqual({ tables: { tickets: { action: 'connect', table_id: 7 } } });
  });

  it('goes to the first table of a module that requires none', () => {
    expect(connectCandidate({ ...blueprint, requires: undefined }, 7)).toEqual({ tables: { sla: { action: 'connect', table_id: 7 } } });
  });

  it('binds nothing without a table or in a module without tables', () => {
    expect(connectCandidate(blueprint, undefined)).toEqual({});
    expect(connectCandidate({ key: 'notes', version: '1.0.0' }, 7)).toEqual({});
  });
});
