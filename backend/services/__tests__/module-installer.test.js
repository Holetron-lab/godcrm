// ADR-200 W2/W3 — install / reconcile / uninstall of a declarative module blueprint.
//
// Unit test against an in-memory fake of the tables the installer touches
// (universal_tables, table_columns, table_rows, module_installations and — from W3 —
// dashboards, widgets, modules, audit_log) plus projects and spaces.
// The fake models transactions the way the PG adapter does — writes are staged and only
// merged into the store when the callback RESOLVES — so "one transaction" and "dry_run
// writes nothing" are asserted on actual stored state, not on mock call counts.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const db = { store: null, get: null, all: null, run: null, transaction: null };

vi.mock('../../database/connection.js', () => ({
  dbGet: (...a) => db.get(...a),
  dbAll: (...a) => db.all(...a),
  dbRun: (...a) => db.run(...a),
  sqlNow: () => 'NOW()',
  toBool: (v) => (v ? 1 : 0),
  safeJsonParse: (v, d = null) => {
    if (v == null) return d;
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch { return d; }
  },
  withTransactionAsync: (...a) => db.transaction(...a),
}));

vi.mock('../../utils/logger.js', () => ({
  apiLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ADR-073 library indexing is a post-commit, non-critical side effect — asserted separately
// (it must NOT run inside the transaction), never exercised against the fake schema.
const registerWidgetSafe = vi.fn(async () => ({ ok: true }));
vi.mock('../WidgetLibraryService.js', () => ({ registerWidgetSafe: (...a) => registerWidgetSafe(...a) }));
vi.mock('../audit/writeAudit.js', () => ({ writeAudit: vi.fn(async () => {}) }));

const {
  installModule,
  upgradeModule,
  uninstallModule,
  validateBlueprint,
  blueprintSha256,
  planModuleInstall,
  BlueprintError,
} = await import('../ModuleInstaller.js');

// ============================================================
// Fixtures
// ============================================================

const SPACE_ID = 7;
const PROJECT_ID = 42;
const USER_ID = 1;

const BP_V1 = {
  key: 'sc-sim',
  version: '1.0.0',
  title: 'SC-SIM',
  tables: [
    {
      key: 'schemes',
      name: 'sim_schemes',
      display_name: 'Схемы симуляций',
      columns: [
        { column_name: 'name', display_name: 'Название', type: 'text' },
        { column_name: 'graph_json', display_name: 'Граф', type: 'json' },
      ],
    },
  ],
  seed: [
    { table: 'schemes', key: ['name'], rows: [{ name: 'Demo scheme', graph_json: { nodes: [] } }] },
  ],
};

// W3: the same module, now shipping its surface. `table_view` is a real core preset — the
// blueprint may only name presets that already exist (a renderer is code, and code is a deploy).
const BP_W3 = {
  ...BP_V1,
  widgets: [{
    key: 'schemes_board',
    preset_name: 'table_view',
    title: 'Схемы',
    icon: '🗺️',
    config: { table_id: { $table: 'schemes' }, filters: [] },
  }],
  sidebar: [{ widget: 'schemes_board', icon: 'Boxes', order: 10, access_level: 'member' }],
};

// v2 adds a column to the SAME table — the upgrade case the provisioner could never roll
// out before (it saw the table name and skipped).
const BP_V2 = {
  ...BP_V1,
  version: '1.1.0',
  tables: [
    {
      ...BP_V1.tables[0],
      columns: [
        ...BP_V1.tables[0].columns,
        { column_name: 'owner_note', display_name: 'Заметка', type: 'text' },
      ],
    },
  ],
};

// ============================================================
// In-memory database
// ============================================================

function createFakeDb() {
  const store = {
    projects: [{ id: PROJECT_ID, space_id: SPACE_ID }],
    spaces: [{ id: SPACE_ID, name: 'Development' }],
    dashboards: [{ id: 500, space_id: SPACE_ID, project_id: null, name: 'Overview', is_default: 1 }],
    universal_tables: [],
    table_columns: [],
    table_rows: [],
    module_installations: [],
    widgets: [],
    modules: [],
    audit_log: [],
  };
  let seq = 1000;
  const nextId = () => ++seq;

  const clone = (s) => JSON.parse(JSON.stringify(s));

  const readers = (s) => ({
    get: async (sql, params = []) => {
      if (/SELECT id, space_id FROM projects/i.test(sql)) {
        return s.projects.find((p) => p.id === params[0]);
      }
      if (/FROM universal_tables WHERE project_id = \? AND name = \?/i.test(sql)) {
        return s.universal_tables.find((t) => t.project_id === params[0] && t.name === params[1]);
      }
      if (/COUNT\(\*\) AS n FROM table_rows/i.test(sql)) {
        return { n: s.table_rows.filter((r) => r.table_id === params[0]).length };
      }
      if (/FROM module_installations WHERE module_key = \? AND space_id = \?/i.test(sql)) {
        return s.module_installations.find((m) => m.module_key === params[0] && m.space_id === params[1]);
      }
      // ---- W3 ----
      if (/FROM dashboards\s+WHERE space_id = \? AND is_default/i.test(sql)) {
        return s.dashboards.filter((d) => d.space_id === params[0] && d.is_default === 1)
          .sort((a, b) => a.id - b.id)[0];
      }
      if (/SELECT id FROM dashboards WHERE id = \?/i.test(sql)) {
        return s.dashboards.find((d) => d.id === params[0]);
      }
      if (/FROM spaces WHERE id = \?/i.test(sql)) {
        return s.spaces.find((sp) => sp.id === params[0]);
      }
      if (/SELECT id FROM widgets WHERE id = \?/i.test(sql)) {
        return s.widgets.find((w) => w.id === params[0]);
      }
      if (/SELECT id FROM modules WHERE widget_id = \?/i.test(sql)) {
        return s.modules.find((m) => m.widget_id === params[0]);
      }
      if (/COUNT\(\*\)::int AS n FROM \(/i.test(sql)) {
        return { n: 0 }; // no document atom references this widget
      }
      if (/FROM widgets w\s+LEFT JOIN dashboards/i.test(sql)) {
        const w = s.widgets.find((x) => x.id === params[0]);
        return w ? { ...w } : undefined;
      }
      if (/FROM modules m\s+JOIN widgets w/i.test(sql)) {
        const m = s.modules.find((x) => x.id === params[0]);
        if (!m) return undefined;
        const w = s.widgets.find((x) => x.id === m.widget_id);
        return { ...w, ...m, module_id: m.id, id: w.id };
      }
      throw new Error(`fake db: unhandled get() — ${sql}`);
    },
    all: async (sql, params = []) => {
      if (/FROM table_columns WHERE table_id = \?/i.test(sql)) {
        return s.table_columns.filter((c) => c.table_id === params[0]);
      }
      if (/FROM table_rows WHERE table_id = \?/i.test(sql)) {
        return s.table_rows.filter((r) => r.table_id === params[0]);
      }
      if (/FROM widgets w\s+JOIN dashboards d/i.test(sql)) {
        const boards = new Set(
          s.dashboards
            .filter((d) => d.space_id === params[0]
              || s.projects.some((p) => p.id === d.project_id && p.space_id === params[1]))
            .map((d) => d.id)
        );
        return s.widgets.filter((w) => boards.has(w.dashboard_id)).map((w) => ({ ...w }));
      }
      throw new Error(`fake db: unhandled all() — ${sql}`);
    },
    run: async (sql, params = []) => {
      // The per-(module, space) advisory lock applyPlan takes first: a no-op on a single-writer fake.
      if (/pg_advisory_xact_lock/i.test(sql)) return { changes: 0 };
      if (/INSERT INTO universal_tables/i.test(sql)) {
        const id = nextId();
        s.universal_tables.push({
          id, project_id: params[0], name: params[1], display_name: params[2],
          table_type: params[3], icon: params[4], base_id: params[5], created_by: params[6],
        });
        return { changes: 1, lastInsertRowid: id };
      }
      if (/INSERT INTO table_columns/i.test(sql)) {
        const id = nextId();
        s.table_columns.push({
          id, table_id: params[0], column_name: params[1], display_name: params[2],
          type: params[3], order_index: params[4], config: params[5],
        });
        return { changes: 1, lastInsertRowid: id };
      }
      if (/INSERT INTO table_rows/i.test(sql)) {
        const id = nextId();
        s.table_rows.push({ id, table_id: params[0], base_id: params[1], data: params[2], created_by: params[3] });
        return { changes: 1, lastInsertRowid: id };
      }
      if (/INSERT INTO module_installations/i.test(sql)) {
        const [module_key, version, space_id, project_id, blueprint, blueprint_sha256, installed_by] = params;
        const found = s.module_installations.find((m) => m.module_key === module_key && m.space_id === space_id);
        if (found) {
          Object.assign(found, {
            version, project_id, blueprint, blueprint_sha256, status: 'active', updated_at: 'T1',
          });
          return { changes: 1, lastInsertRowid: found.id };
        }
        const id = nextId();
        s.module_installations.push({
          id, module_key, version, space_id, project_id, blueprint, blueprint_sha256,
          status: 'active', installed_by, installed_at: 'T0', updated_at: 'T0',
        });
        return { changes: 1, lastInsertRowid: id };
      }
      if (/UPDATE module_installations SET status = 'removed'/i.test(sql)) {
        const row = s.module_installations.find((m) => m.id === params[0]);
        if (row) row.status = 'removed';
        return { changes: row ? 1 : 0, lastInsertRowid: 0 };
      }
      if (/DELETE FROM table_rows WHERE table_id = \?/i.test(sql)) {
        s.table_rows = s.table_rows.filter((r) => r.table_id !== params[0]);
        return { changes: 1, lastInsertRowid: 0 };
      }
      if (/DELETE FROM table_columns WHERE table_id = \?/i.test(sql)) {
        s.table_columns = s.table_columns.filter((c) => c.table_id !== params[0]);
        return { changes: 1, lastInsertRowid: 0 };
      }
      if (/DELETE FROM universal_tables WHERE id = \?/i.test(sql)) {
        s.universal_tables = s.universal_tables.filter((t) => t.id !== params[0]);
        return { changes: 1, lastInsertRowid: 0 };
      }
      // ---- W3 ----
      if (/INSERT INTO dashboards/i.test(sql)) {
        const id = nextId();
        s.dashboards.push({ id, space_id: params[0], project_id: null, name: params[1], icon: params[2], is_default: params[3] });
        return { changes: 1, lastInsertRowid: id };
      }
      if (/INSERT INTO widgets/i.test(sql)) {
        const id = nextId();
        s.widgets.push({
          id, dashboard_id: params[0], owner_kind: params[1], owner_id: params[2],
          source_widget_id: params[3], widget_type: params[4], preset_name: params[5],
          code: params[6], title: params[7], description: params[8], icon: params[9],
          config: params[10], position: params[11], is_visible: params[12],
          order_index: params[13], created_by: params[14],
        });
        return { changes: 1, lastInsertRowid: id };
      }
      if (/INSERT INTO modules/i.test(sql)) {
        const id = nextId();
        s.modules.push({
          id, widget_id: params[0], space_id: params[1], sidebar_order: params[2],
          sidebar_icon: params[3], access_level: params[4], is_pinned: params[5], is_default: params[6],
        });
        return { changes: 1, lastInsertRowid: id };
      }
      if (/INSERT INTO audit_log/i.test(sql)) {
        s.audit_log.push({ user_id: params[0], action: params[1], entity_id: params[2], details: params[3] });
        return { changes: 1, lastInsertRowid: 0 };
      }
      if (/DELETE FROM widgets WHERE source_widget_id = \?/i.test(sql)) {
        s.widgets = s.widgets.filter((w) => w.source_widget_id !== params[0]);
        return { changes: 1, lastInsertRowid: 0 };
      }
      if (/DELETE FROM widgets WHERE id = \?/i.test(sql)) {
        s.widgets = s.widgets.filter((w) => w.id !== params[0]);
        // modules.widget_id / widget_library ... ON DELETE CASCADE (checked on master A)
        s.modules = s.modules.filter((m) => m.widget_id !== params[0]);
        return { changes: 1, lastInsertRowid: 0 };
      }
      throw new Error(`fake db: unhandled run() — ${sql}`);
    },
  });

  const committed = readers(store);

  return {
    store,
    get: committed.get,
    all: committed.all,
    run: committed.run,
    // Stage every write on a copy; publish it only when the callback resolves. A throw
    // anywhere inside leaves the committed store byte-identical — a modelled ROLLBACK.
    transaction: async (cb) => {
      const staged = clone(store);
      const trx = readers(staged);
      const result = await cb(trx);
      for (const key of Object.keys(store)) store[key] = staged[key];
      return result;
    },
  };
}

function installFakeDb() {
  const fake = createFakeDb();
  Object.assign(db, fake);
  return fake;
}

const counts = () => ({
  tables: db.store.universal_tables.length,
  columns: db.store.table_columns.length,
  rows: db.store.table_rows.length,
  installations: db.store.module_installations.length,
});

// W3 surface, counted separately so the W2 assertions above keep their exact shape.
const surface = () => ({
  widgets: db.store.widgets.length,
  modules: db.store.modules.length,
  dashboards: db.store.dashboards.length,
});

const stampOf = (widget) => JSON.parse(widget.config).__module;

beforeEach(() => {
  installFakeDb();
  registerWidgetSafe.mockClear();
});

// ============================================================
// Blueprint contract
// ============================================================

describe('validateBlueprint — the contract, refusals first (AC#5)', () => {
  it('accepts the W3 sections it now implements', () => {
    const bp = validateBlueprint(BP_W3);
    expect(bp.widgets[0].key).toBe('schemes_board');
    expect(bp.sidebar[0].widget).toBe('schemes_board');
  });

  it('refuses `tools` (W4) — a declared-but-dropped section is worse than a refusal', () => {
    const err = grab(() => validateBlueprint({ ...BP_V1, tools: [{ name: 'sim_list' }] }));
    expect(err).toBeInstanceOf(BlueprintError);
    expect(err.code).toBe('BLUEPRINT_SECTION_UNSUPPORTED');
    expect(err.message).toMatch(/W4/);
  });

  it('refuses a preset that does not exist here — the border of variant 1 (AC#5)', () => {
    const err = grab(() => validateBlueprint({
      ...BP_W3,
      widgets: [{ ...BP_W3.widgets[0], preset_name: 'sim_canvas' }],
    }));
    expect(err.code).toBe('PRESET_NOT_FOUND');
    expect(err.message).toMatch(/deploy/);
  });

  it('refuses a widget bound to a table the blueprint never declares', () => {
    const err = grab(() => validateBlueprint({
      ...BP_W3,
      widgets: [{ ...BP_W3.widgets[0], config: { table_id: { $table: 'runs' } } }],
    }));
    expect(err.code).toBe('BLUEPRINT_UNKNOWN_TABLE_REF');
  });

  it('refuses the ADR-example shorthand `table: "<key>"` instead of installing an empty widget', () => {
    // The blueprint contract section of ADR-200 shows `config: { table: schemes }`; the
    // sentinel was chosen after it. Unsubstituted, that config yields a widget bound to
    // nothing and no error anywhere — so it is a refusal that names the right form.
    const err = grab(() => validateBlueprint({
      ...BP_W3,
      widgets: [{ ...BP_W3.widgets[0], config: { table: 'schemes' } }],
    }));
    expect(err.code).toBe('BLUEPRINT_RAW_TABLE_BINDING');
    expect(err.message).toMatch(/\$table/);
  });

  it('refuses a hard-coded table_id — a blueprint may not carry ids', () => {
    const err = grab(() => validateBlueprint({
      ...BP_W3,
      widgets: [{ ...BP_W3.widgets[0], config: { table_id: 103027 } }],
    }));
    expect(err.code).toBe('BLUEPRINT_RAW_TABLE_BINDING');
  });

  it('leaves a `table` config key alone when it is not a blueprint table key', () => {
    // A preset is free to have its own `table` setting; only a value that names a declared
    // blueprint table is unmistakably the shorthand.
    const ok = { ...BP_W3, widgets: [{ ...BP_W3.widgets[0], config: { table: 'markdown', table_id: null } }] };
    expect(validateBlueprint(ok).widgets[0].config.table).toBe('markdown');
  });

  it('refuses a blueprint that writes the ownership stamp itself', () => {
    const err = grab(() => validateBlueprint({
      ...BP_W3,
      widgets: [{ ...BP_W3.widgets[0], config: { __module: { key: 'someone-else' } } }],
    }));
    expect(err.code).toBe('BLUEPRINT_RESERVED_KEY');
  });

  it('refuses a sidebar entry aimed at an undeclared widget, and a widget pinned twice', () => {
    expect(grab(() => validateBlueprint({ ...BP_W3, sidebar: [{ widget: 'ghost' }] })).message)
      .toMatch(/does not declare/);
    expect(grab(() => validateBlueprint({
      ...BP_W3,
      sidebar: [{ widget: 'schemes_board' }, { widget: 'schemes_board', order: 2 }],
    })).message).toMatch(/twice/);
  });

  it('refuses a column type the public REST API would reject', () => {
    const bad = structuredClone(BP_V1);
    bad.tables[0].columns.push({ column_name: 'x', type: 'quantum' });
    expect(grab(() => validateBlueprint(bad)).code).toBe('BLUEPRINT_INVALID');
  });

  it('refuses a non-semver version and a non-ascii table name', () => {
    expect(grab(() => validateBlueprint({ ...BP_V1, version: 'v1' })).code).toBe('BLUEPRINT_INVALID');
    const cyrillic = structuredClone(BP_V1);
    cyrillic.tables[0].name = 'схемы';
    expect(grab(() => validateBlueprint(cyrillic)).code).toBe('BLUEPRINT_INVALID');
  });

  it('refuses a seed group aimed at a table the blueprint does not declare', () => {
    const bad = structuredClone(BP_V1);
    bad.seed[0].table = 'runs';
    expect(grab(() => validateBlueprint(bad)).message).toMatch(/does not declare/);
  });

  it('caps the blueprint size (§Security: install must not be a schema-shaped DoS)', () => {
    const huge = {
      ...BP_V1,
      seed: undefined,
      tables: Array.from({ length: 26 }, (_, i) => ({ key: `t${i}`, name: `t${i}`, columns: [] })),
    };
    expect(grab(() => validateBlueprint(huge)).code).toBe('BLUEPRINT_INVALID');
  });

  it('hashes independently of key order — a re-serialized YAML is not a change', () => {
    const reordered = { tables: BP_V1.tables, title: BP_V1.title, version: '1.0.0', key: 'sc-sim', seed: BP_V1.seed };
    expect(blueprintSha256(reordered)).toBe(blueprintSha256(BP_V1));
    expect(blueprintSha256(BP_V2)).not.toBe(blueprintSha256(BP_V1));
  });
});

// ============================================================
// Install
// ============================================================

describe('installModule', () => {
  it('dry_run returns the diff and writes NOTHING (AC#4)', async () => {
    const before = counts();
    const res = await installModule({ blueprint: BP_V1, spaceId: SPACE_ID, projectId: PROJECT_ID, userId: USER_ID, dryRun: true });

    expect(res.dry_run).toBe(true);
    expect(res.plan.tables[0]).toMatchObject({ key: 'schemes', action: 'create', table_id: null });
    expect(res.plan.seed[0]).toMatchObject({ table: 'schemes', insert: 1, existing: 0 });
    expect(res.plan.changes).toBe(4); // 1 table + 2 columns + 1 seed row
    expect(counts()).toEqual(before);
  });

  it('creates tables, columns, seed rows and the installation record in one transaction', async () => {
    const res = await installModule({ blueprint: BP_V1, spaceId: SPACE_ID, projectId: PROJECT_ID, userId: USER_ID });

    expect(res.status).toBe('installed');
    expect(counts()).toEqual({ tables: 1, columns: 2, rows: 1, installations: 1 });

    const record = db.store.module_installations[0];
    expect(record).toMatchObject({
      module_key: 'sc-sim', version: '1.0.0', space_id: SPACE_ID, project_id: PROJECT_ID,
      status: 'active', installed_by: USER_ID, blueprint_sha256: blueprintSha256(validateBlueprint(BP_V1)),
    });
    // The blueprint is stored verbatim — uninstall/purge later needs to know what it put here.
    expect(JSON.parse(record.blueprint).tables[0].name).toBe('sim_schemes');
  });

  it('re-installing the same blueprint is a no-op with a zero diff (AC#2)', async () => {
    await installModule({ blueprint: BP_V1, spaceId: SPACE_ID, projectId: PROJECT_ID, userId: USER_ID });
    const after = counts();

    const again = await installModule({ blueprint: BP_V1, spaceId: SPACE_ID, projectId: PROJECT_ID, userId: USER_ID });

    expect(again.status).toBe('unchanged');
    expect(again.plan.changes).toBe(0);
    expect(counts()).toEqual(after);
    expect(db.store.module_installations[0].updated_at).toBe('T0'); // record untouched
  });

  it('refuses a DIFFERENT blueprint under an installed key and points at upgrade', async () => {
    await installModule({ blueprint: BP_V1, spaceId: SPACE_ID, projectId: PROJECT_ID, userId: USER_ID });
    const err = await grabAsync(() =>
      installModule({ blueprint: BP_V2, spaceId: SPACE_ID, projectId: PROJECT_ID, userId: USER_ID }));

    expect(err.code).toBe('ALREADY_INSTALLED');
    expect(err.message).toMatch(/upgrade/);
  });

  it('refuses a project that belongs to another space', async () => {
    db.store.projects.push({ id: 99, space_id: 8 });
    const err = await grabAsync(() =>
      installModule({ blueprint: BP_V1, spaceId: SPACE_ID, projectId: 99, userId: USER_ID }));
    expect(err.code).toBe('PROJECT_NOT_IN_SPACE');
  });

  it('a failure mid-install commits nothing — no tables, no columns, no record (AC#1)', async () => {
    let seenTableRowInsert = false;
    // Blow up on the seed INSERT: tables and columns are already written inside the trx.
    db.transaction = async (cb) => {
      const fake = createFakeDb();
      fake.store.projects = db.store.projects;
      fake.store.universal_tables = structuredClone(db.store.universal_tables);
      const trx = {
        get: fake.get,
        all: fake.all,
        run: async (sql, params) => {
          if (/INSERT INTO table_rows/i.test(sql)) {
            seenTableRowInsert = true;
            throw new Error('boom: seed insert failed');
          }
          return fake.run(sql, params);
        },
      };
      return cb(trx); // rejects → nothing merged into db.store, as a ROLLBACK
    };

    await expect(
      installModule({ blueprint: BP_V1, spaceId: SPACE_ID, projectId: PROJECT_ID, userId: USER_ID })
    ).rejects.toThrow(/boom/);

    expect(seenTableRowInsert).toBe(true);
    expect(counts()).toEqual({ tables: 0, columns: 0, rows: 0, installations: 0 });
  });
});

// ============================================================
// Upgrade — add-only reconciliation
// ============================================================

describe('upgradeModule', () => {
  beforeEach(async () => {
    await installModule({ blueprint: BP_V1, spaceId: SPACE_ID, projectId: PROJECT_ID, userId: USER_ID });
  });

  it('rolls a new column onto an existing installation and keeps the rows (AC#3)', async () => {
    const res = await upgradeModule({ moduleKey: 'sc-sim', blueprint: BP_V2, spaceId: SPACE_ID, userId: USER_ID });

    expect(res.status).toBe('upgraded');
    expect(res.from_version).toBe('1.0.0');
    expect(res.plan.tables[0]).toMatchObject({ action: 'columns_added', columns_added: ['owner_note'] });

    const cols = db.store.table_columns.map((c) => c.column_name);
    expect(cols).toEqual(['name', 'graph_json', 'owner_note']);
    expect(db.store.table_rows).toHaveLength(1); // seed row survived
    expect(db.store.universal_tables).toHaveLength(1); // no second table
    expect(db.store.module_installations[0].version).toBe('1.1.0');
  });

  it('dry_run reports columns_added without writing it', async () => {
    const before = counts();
    const res = await upgradeModule({ moduleKey: 'sc-sim', blueprint: BP_V2, spaceId: SPACE_ID, dryRun: true });

    expect(res.dry_run).toBe(true);
    expect(res.plan.changes).toBe(1);
    expect(counts()).toEqual(before);
  });

  it('never drops or retypes: a column removed from v2 stays, a retyped one is reported as a conflict', async () => {
    const shrunk = {
      ...BP_V1,
      version: '2.0.0',
      seed: undefined,
      tables: [{
        key: 'schemes', name: 'sim_schemes',
        columns: [{ column_name: 'name', display_name: 'Название', type: 'number' }],
      }],
    };
    const res = await upgradeModule({ moduleKey: 'sc-sim', blueprint: shrunk, spaceId: SPACE_ID, userId: USER_ID });

    expect(db.store.table_columns.map((c) => c.column_name)).toEqual(['name', 'graph_json']);
    expect(db.store.table_columns.find((c) => c.column_name === 'name').type).toBe('text');
    expect(res.plan.conflicts[0]).toMatchObject({
      kind: 'column_type_mismatch', column: 'name', existing_type: 'text', declared_type: 'number',
    });
  });

  it('refuses a downgrade, an unbumped version and a key mismatch', async () => {
    const downgrade = { ...BP_V1, version: '0.9.0', title: 'older' };
    expect((await grabAsync(() => upgradeModule({ moduleKey: 'sc-sim', blueprint: downgrade, spaceId: SPACE_ID }))).code)
      .toBe('VERSION_DOWNGRADE');

    const unbumped = { ...BP_V1, title: 'changed content, same version' };
    expect((await grabAsync(() => upgradeModule({ moduleKey: 'sc-sim', blueprint: unbumped, spaceId: SPACE_ID }))).code)
      .toBe('VERSION_NOT_BUMPED');

    expect((await grabAsync(() => upgradeModule({ moduleKey: 'other', blueprint: BP_V2, spaceId: SPACE_ID }))).code)
      .toBe('BLUEPRINT_KEY_MISMATCH');
  });

  it('refuses to upgrade something that is not installed', async () => {
    const err = await grabAsync(() =>
      upgradeModule({ moduleKey: 'sc-sim', blueprint: BP_V2, spaceId: 999 }));
    expect(err.code).toBe('NOT_INSTALLED');
  });
});

// ============================================================
// Uninstall
// ============================================================

describe('uninstallModule', () => {
  beforeEach(async () => {
    await installModule({ blueprint: BP_V1, spaceId: SPACE_ID, projectId: PROJECT_ID, userId: USER_ID });
  });

  it('without purge retires the installation and LEAVES the tables and rows (AC#6)', async () => {
    const res = await uninstallModule({ moduleKey: 'sc-sim', spaceId: SPACE_ID });

    expect(res).toMatchObject({ status: 'removed', purged: false, rows_purged: 0 });
    expect(res.tables_kept).toHaveLength(1);
    expect(counts()).toMatchObject({ tables: 1, columns: 2, rows: 1 });
    expect(db.store.module_installations[0].status).toBe('removed');
  });

  it('with purge deletes the module tables, their columns and their rows', async () => {
    const res = await uninstallModule({ moduleKey: 'sc-sim', spaceId: SPACE_ID, purge: true });

    expect(res).toMatchObject({ purged: true, rows_purged: 1 });
    expect(counts()).toMatchObject({ tables: 0, columns: 0, rows: 0 });
    expect(db.store.module_installations[0].status).toBe('removed');
  });

  it('re-install after uninstall reuses the same installation row', async () => {
    await uninstallModule({ moduleKey: 'sc-sim', spaceId: SPACE_ID });
    const res = await installModule({ blueprint: BP_V1, spaceId: SPACE_ID, projectId: PROJECT_ID, userId: USER_ID });

    expect(res.status).toBe('reinstalled');
    expect(db.store.module_installations).toHaveLength(1);
    expect(db.store.module_installations[0].status).toBe('active');
  });

  it('refuses to uninstall twice', async () => {
    await uninstallModule({ moduleKey: 'sc-sim', spaceId: SPACE_ID });
    expect((await grabAsync(() => uninstallModule({ moduleKey: 'sc-sim', spaceId: SPACE_ID }))).code)
      .toBe('NOT_INSTALLED');
  });
});

// ============================================================
// W3 — widgets and sidebar
// ============================================================

describe('W3 — widgets and sidebar from existing presets', () => {
  const install = (blueprint = BP_W3) =>
    installModule({ blueprint, spaceId: SPACE_ID, projectId: PROJECT_ID, userId: USER_ID });

  it('creates the widget on the space default board, bound to the table it just provisioned', async () => {
    const res = await install();

    expect(surface()).toEqual({ widgets: 1, modules: 1, dashboards: 1 });
    const widget = db.store.widgets[0];
    const tableId = db.store.universal_tables[0].id;

    expect(widget.dashboard_id).toBe(500); // the space's DEFAULT board, not a new one
    expect(widget.preset_name).toBe('table_view');
    expect(widget.title).toBe('Схемы');
    // The whole point of `{ $table: "schemes" }`: the blueprint carries no ids, the install does.
    expect(JSON.parse(widget.config).table_id).toBe(tableId);
    expect(stampOf(widget)).toEqual({ key: 'sc-sim', widget_key: 'schemes_board' });

    expect(db.store.modules[0]).toMatchObject({
      widget_id: widget.id, space_id: SPACE_ID, sidebar_order: 10, sidebar_icon: 'Boxes', access_level: 'member',
    });
    expect(res.widgets[0]).toMatchObject({ key: 'schemes_board', action: 'created' });
    expect(res.sidebar[0]).toMatchObject({ widget: 'schemes_board', action: 'created' });
  });

  it('commits the whole surface in ONE transaction — and indexes the library AFTER it', async () => {
    const spy = vi.spyOn(db, 'transaction');
    await install();

    expect(spy).toHaveBeenCalledTimes(1); // tables + seed + widget + sidebar + record
    // ADR-073 indexing must not run inside: it opens its own connection and could not see
    // the uncommitted widget.
    expect(registerWidgetSafe).toHaveBeenCalledTimes(1);
    expect(registerWidgetSafe).toHaveBeenCalledWith(db.store.widgets[0].id, SPACE_ID, { is_public: false, tags: [] });
    spy.mockRestore();
  });

  it('creates a DEFAULT dashboard when the space has none — never a non-default one', async () => {
    db.store.dashboards = [];
    await install();

    expect(db.store.dashboards).toHaveLength(1);
    expect(db.store.dashboards[0]).toMatchObject({ space_id: SPACE_ID, is_default: 1 });
    expect(db.store.widgets[0].dashboard_id).toBe(db.store.dashboards[0].id);
  });

  it('dry_run plans the widget and the pin, and writes nothing (AC#4)', async () => {
    const before = { ...counts(), ...surface() };
    const res = await installModule({ blueprint: BP_W3, spaceId: SPACE_ID, projectId: PROJECT_ID, dryRun: true });

    expect(res.plan.widgets[0]).toMatchObject({
      key: 'schemes_board', preset_name: 'table_view', action: 'create', widget_id: null, dashboard_id: 500,
    });
    expect(res.plan.widgets[0].binds).toEqual([{ table: 'schemes', table_id: null }]);
    expect(res.plan.sidebar[0]).toMatchObject({ widget: 'schemes_board', action: 'create' });
    expect(res.plan.changes).toBe(6); // 1 table + 2 columns + 1 seed row + 1 widget + 1 pin
    expect({ ...counts(), ...surface() }).toEqual(before);
  });

  it('re-install is a no-op: the widget is found by its stamp, not duplicated (AC#2)', async () => {
    await install();
    const again = await install();

    expect(again.status).toBe('unchanged');
    expect(again.plan.changes).toBe(0);
    expect(again.plan.widgets[0]).toMatchObject({ action: 'existing', widget_id: db.store.widgets[0].id });
    expect(surface()).toEqual({ widgets: 1, modules: 1, dashboards: 1 });
  });

  it('upgrade is add-only for the surface too — a user-edited widget is left alone', async () => {
    await install();
    const widget = db.store.widgets[0];
    widget.title = 'Мои схемы';
    widget.config = JSON.stringify({ ...JSON.parse(widget.config), filters: [{ mine: true }] });

    const v2 = { ...BP_W3, version: '1.1.0', widgets: [{ ...BP_W3.widgets[0], title: 'Renamed by the module' }] };
    await upgradeModule({ moduleKey: 'sc-sim', blueprint: v2, spaceId: SPACE_ID, userId: USER_ID });

    expect(db.store.widgets).toHaveLength(1);
    expect(db.store.widgets[0].title).toBe('Мои схемы');
    expect(JSON.parse(db.store.widgets[0].config).filters).toEqual([{ mine: true }]);
  });

  it('a failure while creating the widget rolls back the tables and seed too (AC#1)', async () => {
    const inner = db.transaction;
    db.transaction = async (cb) => inner(async (trx) => cb({
      get: trx.get,
      all: trx.all,
      run: async (sql, params) => {
        if (/INSERT INTO widgets/i.test(sql)) throw new Error('boom: widget insert failed');
        return trx.run(sql, params);
      },
    }));

    await expect(install()).rejects.toThrow(/boom/);
    expect(counts()).toEqual({ tables: 0, columns: 0, rows: 0, installations: 0 });
    expect(surface()).toEqual({ widgets: 0, modules: 0, dashboards: 1 });
  });

  it('uninstall removes the widget and its sidebar entry, and keeps the data (AC#6)', async () => {
    await install();
    const res = await uninstallModule({ moduleKey: 'sc-sim', spaceId: SPACE_ID, userId: USER_ID });

    expect(res.widgets_removed).toEqual([
      { widget_key: 'schemes_board', widget_id: expect.any(Number), preset_name: 'table_view' },
    ]);
    expect(surface()).toMatchObject({ widgets: 0, modules: 0 });
    // …and the user's data is untouched — that is the whole difference from `purge`.
    expect(counts()).toMatchObject({ tables: 1, columns: 2, rows: 1 });
    // The atom-reference repair ran: this is deleteWidget's body, not a bare DELETE.
    expect(db.store.audit_log.some((a) => a.action === 'widget.deleted')).toBe(true);
  });

  it('a stamped widget the stored blueprint no longer declares is removed AND reported', async () => {
    await install();
    // Blueprint v2 drops the widget; the installed one still carries this module's stamp.
    const record = db.store.module_installations[0];
    record.blueprint = JSON.stringify({ ...BP_W3, widgets: [], sidebar: [] });

    const res = await uninstallModule({ moduleKey: 'sc-sim', spaceId: SPACE_ID });

    expect(res.widgets_orphaned).toEqual(['schemes_board']);
    expect(surface()).toMatchObject({ widgets: 0, modules: 0 });
  });

  it('leaves a widget that belongs to somebody else strictly alone', async () => {
    db.store.widgets.push({
      id: 900, dashboard_id: 500, preset_name: 'table_view', title: "user's own",
      config: JSON.stringify({ table_id: 1 }),
    });
    db.store.widgets.push({
      id: 901, dashboard_id: 500, preset_name: 'table_view', title: 'another module',
      config: JSON.stringify({ table_id: 2, __module: { key: 'other-mod', widget_key: 'schemes_board' } }),
    });

    await install();
    await uninstallModule({ moduleKey: 'sc-sim', spaceId: SPACE_ID });

    expect(db.store.widgets.map((w) => w.id)).toEqual([900, 901]);
  });
});

// ============================================================
// Plan
// ============================================================

describe('planModuleInstall', () => {
  it('is read-only — a plan over an installed module touches nothing', async () => {
    await installModule({ blueprint: BP_V1, spaceId: SPACE_ID, projectId: PROJECT_ID, userId: USER_ID });
    const before = counts();

    const plan = await planModuleInstall(PROJECT_ID, validateBlueprint(BP_V2));

    expect(plan.changes).toBe(1);
    expect(plan.widgets).toEqual([]); // the blueprint declares none
    expect(plan.tools).toEqual([]);   // W4
    expect(counts()).toEqual(before);
  });

  it('refuses to plan widgets without a space — there would be no dashboard to place them on', async () => {
    const err = await grabAsync(() => planModuleInstall(PROJECT_ID, validateBlueprint(BP_W3)));
    expect(err.code).toBe('BLUEPRINT_INVALID');
    expect(err.message).toMatch(/space/);
  });
});

// ============================================================
// Helpers
// ============================================================

function grab(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a BlueprintError, got none');
}

async function grabAsync(fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a BlueprintError, got none');
}
