// ADR-207 §2.6 — install screen: the tree of the target space with the dry-run plan printed on it.
// Presentational. The plan comes from the server and is shown as is; every control edits `bindings`,
// and the owner answers with the next dry-run. Compatibility is never decided here.
import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { SchemaTree } from '@/features/schema-editor/components/panels/SchemaTree';
import type { SchemaTreeModel, SchemaTreeOverlay } from '@/features/schema-editor/components/panels/navTreeTypes';
import type { NavTreeNode } from '@/features/schema-editor/types/schema-editor.types';
import { ColumnMappingRow, type TargetColumnLike } from '@/shared/column-mapping';
import { Button } from '@/shared/components/ui/Button';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { setApp, setColumnTarget, setProject, setSeed, setSidebar, setTableChoice, setTile, tableChoice } from './bindings';
import { buildPlanTree, type PlanNodeState } from './planTree';
import type { InstallBindings, InstallPlan, ModuleBlueprint, PlanConflict, PlanTable } from './types';

export interface InstallPlanTreeProps {
  blueprint: ModuleBlueprint;
  /** Tree of the target space. */
  tree: NavTreeNode[];
  plan: InstallPlan;
  bindings: InstallBindings;
  onBindingsChange: (next: InstallBindings) => void;
  /** Columns of the connected tables by table id: what a module column can be mapped onto. */
  targetColumns: Record<number, TargetColumnLike[]>;
  /** Dashboards a tile can be moved to, besides the module's own. */
  dashboards: { id: number; name: string }[];
  /** A dry-run is on its way; the plan on screen is the previous one. */
  busy?: boolean;
  installing?: boolean;
  /** Runs the install from the footer. Absent when whoever shows the plan has an Install of its own. */
  onInstall?: () => void;
}

const STATE_KEY: Record<PlanNodeState, string> = {
  create: 'moduleInstall.state.create',
  change: 'moduleInstall.state.change',
  existing: 'moduleInstall.state.existing',
  skip: 'moduleInstall.state.skip',
  requires: 'moduleInstall.state.requires',
};
const STATE_CLASS: Record<PlanNodeState, string> = {
  create: 'border border-dashed border-[var(--accent-primary)]',
  change: 'bg-amber-500/10',
  existing: '',
  skip: 'opacity-60',
  requires: 'border border-dashed border-red-500/60',
};

const selectClass =
  'max-w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-sm';
const noteClass = 'text-xs text-[var(--text-secondary)]';
const fieldClass = 'flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--text-primary)]';
const NO_TABLES = new Set<number>();
const NO_PROJECTS = new Map<number, never>();
const NO_TYPES: never[] = [];
const noop = () => {};

interface Labelled { node: NavTreeNode; label: string }
/** Every node of the space with a `Project / Name` label. */
const flatten = (nodes: NavTreeNode[], path = ''): Labelled[] =>
  nodes.flatMap((node) => {
    const name = node.displayName || node.name;
    const label = path ? `${path} / ${name}` : name;
    return [{ node, label }, ...flatten(node.children, node.type === 'project' ? label : path)];
  });

const pathTo = (nodes: NavTreeNode[], id: string): string[] | null => {
  for (const node of nodes) {
    if (node.id === id) return [id];
    const below = pathTo(node.children, id);
    if (below) return [node.id, ...below];
  }
  return null;
};

/** Focuses the control with this id, or the first control inside it. */
const focusControl = (id: string) => {
  const element = document.getElementById(id);
  const control = element?.matches('select, input, button') ? element : element?.querySelector<HTMLElement>('select, input, button');
  control?.focus();
};

export function InstallPlanTree({
  blueprint, tree, plan, bindings, onBindingsChange, targetColumns, dashboards, busy = false, installing = false, onInstall,
}: InstallPlanTreeProps) {
  const { t } = useLanguage();
  const uid = useId();
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const built = useMemo(() => buildPlanTree(tree, plan, blueprint, {
    dashboards: t('moduleInstall.section.dashboards'),
    menu: t('moduleInstall.section.menu'),
    agents: t('moduleInstall.section.agents'),
    automations: t('moduleInstall.section.automations'),
    services: t('moduleInstall.section.services'),
  }), [tree, plan, blueprint, t]);
  const space = useMemo(() => flatten(tree), [tree]);

  // A new plan can move a node (a created table becomes a connected one elsewhere in the tree) and take
  // the focused control with it. Focus follows the control the user last changed, and a conflict's target.
  const lastChanged = useRef<string | null>(null);
  const revealed = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (revealed.current) {
      focusControl(revealed.current);
      revealed.current = null;
    } else if (lastChanged.current && document.activeElement === document.body) {
      focusControl(lastChanged.current);
    }
  });
  const change = (controlId: string, next: InstallBindings) => {
    lastChanged.current = controlId;
    onBindingsChange(next);
  };

  const declared = [...(blueprint.tables ?? []), ...(blueprint.requires?.tables ?? [])];
  const tableTitle = (key: string) =>
    declared.find((table) => table.key === key)?.display_name || plan.tables.find((table) => table.key === key)?.name || key;
  const existingTable = (id: number | null | undefined) => {
    const found = space.find(({ node }) => node.id === `table:${id}`);
    return found ? `${found.node.displayName || found.node.name} #${id}` : id == null ? null : `#${id}`;
  };

  const conflictText = (conflict: PlanConflict): string => {
    const { kind, column, target, preset, agent } = conflict;
    const table = conflict.table ? tableTitle(conflict.table) : undefined;
    switch (kind) {
      case 'column_type':
        return t('moduleInstall.conflicts.columnType', { column, expected: conflict.declared_type, target, actual: conflict.existing_type });
      case 'relation_target': {
        // The expected table may not exist yet: then it is the module table the column points to.
        const moduleTarget = declared.find((entry) => entry.key === conflict.table)?.columns?.find((entry) => entry.column_name === column)?.target;
        return t('moduleInstall.conflicts.relationTarget', {
          column,
          target,
          expected: existingTable(conflict.expected_table_id) ?? (moduleTarget ? tableTitle(moduleTarget) : t('moduleInstall.conflicts.noTable')),
          actual: existingTable(conflict.actual_table_id) ?? t('moduleInstall.conflicts.noTable'),
        });
      }
      case 'column_type_mismatch':
        return t('moduleInstall.conflicts.typeKept', { column, actual: conflict.existing_type, expected: conflict.declared_type });
      case 'REQUIRED_COLUMN_UNMAPPED': return t('moduleInstall.conflicts.requiredColumn', { column });
      case 'PRESET_COLUMN_MAPPING_UNSUPPORTED': return t('moduleInstall.conflicts.presetUnsupported', { preset });
      case 'TABLE_SKIP_DEPENDENCY': return t('moduleInstall.conflicts.skipDependency', { table });
      case 'REQUIRES_TABLE_UNBOUND': return t('moduleInstall.conflicts.requiresUnbound', { table });
      case 'COLUMN_TARGET_DUPLICATE': return t('moduleInstall.conflicts.targetDuplicate', { target });
      case 'COLUMN_REF_UNMAPPED': return t('moduleInstall.conflicts.columnRefUnmapped', { column });
      case 'TABLE_ALREADY_EXISTS': return t('moduleInstall.conflicts.tableExists', { table });
      case 'AGENT_TOOLS_NOT_ALLOWED': return t('moduleInstall.conflicts.agentTools', { agent });
      default: return t('moduleInstall.conflicts.other', { kind });
    }
  };

  const conflictBody = (conflict: PlanConflict) => (
    <>
      <span>{conflictText(conflict)}</span>
      {conflict.referenced_by && conflict.referenced_by.length > 0 && (
        <span className="block text-[var(--text-secondary)]">
          {t('moduleInstall.conflicts.usedBy', { refs: conflict.referenced_by.join(', ') })}
        </span>
      )}
    </>
  );
  const conflictList = (conflicts: PlanConflict[]) => conflicts.length > 0 && (
    <ul className="space-y-1 text-xs text-red-700 dark:text-red-400">
      {conflicts.map((conflict, index) => (
        <li key={`${conflict.kind}:${index}`} className="flex gap-1">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <span>{conflictBody(conflict)}</span>
        </li>
      ))}
    </ul>
  );

  const hasRow = (table: PlanTable | undefined, column: string | undefined) =>
    Boolean(table?.columns?.some((entry) => entry.module_column === column));

  /** Tree node and control that a conflict is about. */
  const conflictTarget = (conflict: PlanConflict): { nodeId: string; controlId: string } | null => {
    const kind = conflict.table ? 'table' : conflict.app ? 'app' : conflict.tile ? 'tile' : conflict.project ? 'project' : null;
    const key = conflict.table ?? conflict.app ?? conflict.tile ?? conflict.project;
    if (!kind || !key) return null;
    const nodeId = [...built.meta].find(([, entry]) => entry.kind === kind && entry.key === key)?.[0];
    if (!nodeId) return null;
    const onRow = kind === 'table' && hasRow(plan.tables.find((table) => table.key === key), conflict.column);
    return { nodeId, controlId: onRow ? `${uid}col-${key}-${conflict.column}` : `${uid}${kind}-${key}` };
  };
  const reveal = (target: { nodeId: string; controlId: string }) => {
    revealed.current = target.controlId;
    setToggled((current) => ({ ...current, ...Object.fromEntries((pathTo(built.nodes, target.nodeId) ?? []).map((id) => [id, true])) }));
  };

  const projectDetails = (key: string, node: NavTreeNode) => {
    const project = plan.projects?.find((entry) => entry.key === key);
    if (!project) return null;
    const id = `${uid}project-${key}`;
    return (
      <div className={fieldClass}>
        <label htmlFor={id}>{t('moduleInstall.project.label', { name: node.displayName || node.name })}</label>
        <select
          id={id}
          className={selectClass}
          value={project.action === 'create' ? 'create' : String(project.project_id)}
          onChange={(event) => change(id, setProject(bindings, key, event.target.value === 'create' ? null : Number(event.target.value)))}
        >
          <option value="create">{t('moduleInstall.project.create')}</option>
          {space.filter(({ node: entry }) => entry.type === 'project').map(({ node: entry, label }) => (
            <option key={entry.id} value={entry.numericId}>{label}</option>
          ))}
        </select>
      </div>
    );
  };

  const mappingRows = (table: PlanTable) => {
    const title = tableTitle(table.key);
    const bound = bindings.tables?.[table.key];
    const overrides = bound?.action === 'connect' ? bound.columns ?? [] : [];
    const known = table.table_id != null ? targetColumns[table.table_id] ?? [] : [];
    return (
      <div role="group" aria-label={t('moduleInstall.table.mapping', { name: title })} className="space-y-1">
        {(table.columns ?? []).map((column) => {
          const override = overrides.find((entry) => entry.module_column === column.module_column);
          const target = override ? override.target : column.target;
          const type = column.target_type ?? column.module_type;
          // The chosen target stays selectable while the table's columns are still loading.
          const targets = target && target !== '__new' && !known.some((entry) => entry.id === target)
            ? [...known, { id: target, name: target, type }]
            : known;
          const conflicts = plan.conflicts.filter((conflict) => conflict.table === table.key && conflict.column === column.module_column);
          const id = `${uid}col-${table.key}-${column.module_column}`;
          return (
            <div key={column.module_column} id={id} className="space-y-1">
              <ColumnMappingRow
                mapping={{ sourceColumn: column.module_column, targetColumn: target, type }}
                targetColumns={targets}
                typeOptions={NO_TYPES}
                onTargetChange={(next) => change(id, setColumnTarget(bindings, table, column.module_column, next))}
                onTypeChange={noop}
                sample={column.module_type}
                allowNewColumn
                lockType
                className="flex-wrap"
                compat={conflicts.some((conflict) => conflict.blocking)
                  ? { compat: 'conflict', reason: column.compat === 'conflict' ? column.reason : null }
                  : { compat: column.compat, reason: column.reason }}
              />
              {column.options_added ? (
                <p className={noteClass}>{t('moduleInstall.table.optionsAdded', { column: target, count: column.options_added })}</p>
              ) : null}
              {conflictList(conflicts)}
            </div>
          );
        })}
      </div>
    );
  };

  const tableDetails = (key: string) => {
    const table = plan.tables.find((entry) => entry.key === key);
    if (!table) return null;
    const title = tableTitle(key);
    const choice = tableChoice(table);
    const tables = space.filter(({ node }) => node.type === 'table');
    const seed = plan.seed.find((entry) => entry.table === key);
    const id = `${uid}table-${key}`;
    const seedId = `${uid}seed-${key}`;
    return (
      <>
        <div className={fieldClass}>
          <label htmlFor={id}>{t('moduleInstall.table.label', { name: title })}</label>
          <select
            id={id}
            className={selectClass}
            value={choice}
            onChange={(event) => change(id, setTableChoice(bindings, key, event.target.value))}
          >
            {choice === '' && <option value="" disabled>{t('moduleInstall.table.choose')}</option>}
            {!table.requires && <option value="create">{t('moduleInstall.table.create')}</option>}
            {!table.requires && <option value="skip">{t('moduleInstall.table.skip')}</option>}
            <optgroup label={t('moduleInstall.table.connect')}>
              {tables.map(({ node, label }) => <option key={node.id} value={`connect:${node.numericId}`}>{label}</option>)}
              {choice.startsWith('connect:') && !tables.some(({ node }) => `connect:${node.numericId}` === choice) && (
                <option value={choice}>#{table.table_id}</option>
              )}
            </optgroup>
          </select>
        </div>
        {table.columns && table.columns.length > 0 && mappingRows(table)}
        {conflictList(plan.conflicts.filter((conflict) => conflict.table === key && !hasRow(table, conflict.column)))}
        {seed && (
          <div className={fieldClass}>
            <label className="flex items-center gap-2">
              <input
                id={seedId}
                type="checkbox"
                aria-describedby={`${seedId}-note`}
                checked={bindings.tables?.[key]?.seed !== false}
                disabled={table.action === 'requires'}
                onChange={(event) => change(seedId, setSeed(bindings, table, event.target.checked))}
              />
              {t('moduleInstall.seed.label', { name: title })}
            </label>
            <span id={`${seedId}-note`} className={noteClass}>
              {seed.disabled_reason
                ? t('moduleInstall.seed.disabled', { reason: seed.disabled_reason })
                : t('moduleInstall.seed.counts', { insert: seed.insert, existing: seed.existing })}
            </span>
          </div>
        )}
      </>
    );
  };

  const appDetails = (key: string) => {
    const app = plan.apps?.find((entry) => entry.key === key);
    const candidates = space.filter(({ node }) => node.type === 'widget' && node.presetName === app?.preset_name);
    if (!app || app.action === 'existing' || candidates.length === 0) return null;
    const id = `${uid}app-${key}`;
    return (
      <div className={fieldClass}>
        <label htmlFor={id}>{t('moduleInstall.app.label', { name: app.title })}</label>
        <select
          id={id}
          className={selectClass}
          value={app.action === 'adopt' ? String(app.widget_id) : 'create'}
          onChange={(event) => change(id, setApp(bindings, key, event.target.value === 'create' ? null : Number(event.target.value)))}
        >
          <option value="create">{t('moduleInstall.app.create')}</option>
          {candidates.map(({ node, label }) => <option key={node.id} value={node.numericId}>{label}</option>)}
        </select>
      </div>
    );
  };

  const tileDetails = (key: string) => {
    const tile = plan.tiles?.find((entry) => entry.key === key);
    if (!tile || tile.action === 'existing') return null;
    const binding = bindings.tiles?.[key];
    const id = `${uid}tile-${key}`;
    return (
      <div className={fieldClass}>
        <label htmlFor={id}>{t('moduleInstall.tile.label', { name: tile.title })}</label>
        <select
          id={id}
          className={selectClass}
          value={!binding ? '' : 'action' in binding ? 'skip' : String(binding.dashboard_id)}
          onChange={(event) => {
            const { value } = event.target;
            change(id, setTile(bindings, key, value === '' ? null : value === 'skip' ? 'skip' : Number(value)));
          }}
        >
          <option value="">{t('moduleInstall.tile.module')}</option>
          {dashboards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}
          <option value="skip">{t('moduleInstall.tile.skip')}</option>
        </select>
      </div>
    );
  };

  const sectionDetails = (key: string) => {
    if (key === 'menu') {
      return (
        <ul className="space-y-1 text-sm text-[var(--text-primary)]">
          {plan.sidebar.map((entry) => {
            const id = `${uid}menu-${entry.widget}`;
            const name = plan.apps?.find((app) => app.key === entry.widget)?.title || entry.widget;
            return (
              <li key={entry.widget}>
                <label className="flex items-center gap-2">
                  <input
                    id={id}
                    type="checkbox"
                    checked={bindings.sidebar?.[entry.widget] ?? entry.action !== 'skip'}
                    disabled={entry.action === 'existing'}
                    onChange={(event) => change(id, setSidebar(bindings, entry.widget, event.target.checked))}
                  />
                  {t('moduleInstall.menu.pin', { name })}
                </label>
              </li>
            );
          })}
        </ul>
      );
    }
    if (key !== 'agents' && key !== 'automations' && key !== 'services') return null;
    return (
      <ul className="space-y-1 text-sm text-[var(--text-primary)]">
        {(plan[key] ?? []).map((entry) => {
          const spec = blueprint[key]?.find((item) => item.key === entry.key);
          const secrets = key === 'services' ? blueprint.services?.find((service) => service.key === entry.key)?.secrets ?? [] : [];
          return (
            <li key={entry.key}>
              <span>{(spec && 'title' in spec && spec.title) || entry.key}</span>{' '}
              <span className={noteClass}>{entry.action === 'deferred' ? t('moduleInstall.deferred') : entry.action}</span>
              {/* Names only: a secret's value belongs to the space vault and never passes through this screen. */}
              {secrets.length > 0 && <p className={noteClass}>{t('moduleInstall.secrets', { names: secrets.join(', ') })}</p>}
            </li>
          );
        })}
      </ul>
    );
  };

  const details = (node: NavTreeNode): ReactNode => {
    const entry = built.meta.get(node.id);
    if (!entry) return null;
    switch (entry.kind) {
      case 'project': return projectDetails(entry.key, node);
      case 'table': return tableDetails(entry.key);
      case 'app': return appDetails(entry.key);
      case 'tile': return tileDetails(entry.key);
      default: return sectionDetails(entry.key);
    }
  };

  const overlay: SchemaTreeOverlay = {
    renderState: (node) => {
      const state = built.meta.get(node.id)?.state;
      return state ? <span className="flex-shrink-0 text-[10px] text-[var(--text-secondary)]">{t(STATE_KEY[state])}</span> : null;
    },
    renderDetails: (node) => {
      const content = details(node);
      return content ? <div className="space-y-2 py-2 pl-9 pr-2">{content}</div> : null;
    },
    rowClassName: (node) => {
      const state = built.meta.get(node.id)?.state;
      return state ? STATE_CLASS[state] : '';
    },
  };
  const model: SchemaTreeModel = {
    isExpanded: (node) => toggled[node.id] ?? built.open.has(node.id),
    getVisibility: () => 'inherit',
    getTableColumns: () => undefined,
    onToggleExpand: (node) => setToggled((current) => ({ ...current, [node.id]: !(current[node.id] ?? built.open.has(node.id)) })),
    onVisibilityChange: noop,
    onLoadTableRows: noop,
  };

  const blocked = plan.conflicts.some((conflict) => conflict.blocking);
  const hintId = `${uid}hint`;

  // The tree takes the height it needs; whoever shows it scrolls the page, not the plan.
  return (
    <div className="flex flex-col">
      <section
        aria-label={t('moduleInstall.treeLabel', { module: blueprint.title || blueprint.key })}
        aria-busy={busy}
        className="p-2"
      >
        <SchemaTree
          nodes={built.nodes}
          model={model}
          overlay={overlay}
          t={t}
          selectedTables={NO_TABLES}
          selectedProjects={NO_PROJECTS}
          onToggleSelect={noop}
          onToggleProjectSelect={noop}
        />
      </section>

      <footer className="space-y-3 border-t border-[var(--border-primary)] p-3">
        {plan.conflicts.length > 0 && (
          <section aria-labelledby={`${uid}conflicts`}>
            <p id={`${uid}conflicts`} className="text-sm font-medium text-[var(--text-primary)]">
              {t('moduleInstall.conflicts.title', { count: plan.conflicts.length })}
            </p>
            <ul className="mt-1 space-y-1 text-sm text-[var(--text-primary)]">
              {plan.conflicts.map((conflict, index) => {
                const target = conflictTarget(conflict);
                const textId = `${uid}conflict-${index}`;
                return (
                  <li key={`${conflict.kind}:${index}`} className="flex items-start justify-between gap-3">
                    <span id={textId}>{conflictBody(conflict)}</span>
                    {target && (
                      <Button variant="ghost" size="sm" aria-describedby={textId} onClick={() => reveal(target)}>
                        {t('moduleInstall.conflicts.show')}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <p role="status" className="mr-auto text-sm text-[var(--text-secondary)]">
            {t('moduleInstall.summary.changes', { count: plan.changes })}
          </p>
          {blocked && <p id={hintId} className="text-sm text-red-700 dark:text-red-400">{t('moduleInstall.summary.resolve')}</p>}
          {onInstall && (
            <Button disabled={blocked || busy || installing} aria-describedby={blocked ? hintId : undefined} onClick={onInstall}>
              {installing ? t('moduleInstall.summary.installing') : t('moduleInstall.summary.install')}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
