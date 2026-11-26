// ADR-207 §2.4 — what a blueprint installs, read for the module page: projects, tables, apps, tiles,
// agents, automations and services. A v1 blueprint keeps its `widgets`: without a dashboard they are
// apps, on a dashboard they are tiles (§2.10).
import type { CatalogBlueprint } from './types';

export type CompositionKind = 'projects' | 'tables' | 'requires' | 'apps' | 'tiles' | 'agents' | 'automations' | 'services';

export interface CompositionItem {
  key: string;
  title: string;
  icon?: string;
  /** Preset of an app or a tile, dashboard of a tile, host of a service. */
  hint?: string;
  columns?: number;
}

export interface CompositionGroup {
  kind: CompositionKind;
  items: CompositionItem[];
}

interface Section {
  key: string;
  title?: string;
  name?: string;
  display_name?: string;
  icon?: string;
  preset?: string;
  preset_name?: string;
  url?: string;
  dashboard?: string;
  columns?: unknown[];
  tiles?: unknown[];
}

const sections = (value: unknown): Section[] =>
  (Array.isArray(value) ? value : []).filter((entry): entry is Section => typeof entry === 'object' && entry !== null && typeof (entry as Section).key === 'string');

const titleOf = (section: Section) => section.title || section.display_name || section.name || section.key;

const host = (url?: string) => {
  if (!url) return undefined;
  try { return new URL(url).host; } catch { return url; }
};

const table = (section: Section): CompositionItem => ({
  key: section.key, title: titleOf(section), icon: section.icon,
  columns: Array.isArray(section.columns) ? section.columns.length : undefined,
});
const surface = (section: Section, hint = section.preset || section.preset_name): CompositionItem => ({ key: section.key, title: titleOf(section), icon: section.icon, hint });
const named = (section: Section): CompositionItem => ({ key: section.key, title: titleOf(section), icon: section.icon });

export function composition(blueprint: CatalogBlueprint): CompositionGroup[] {
  const widgets = sections(blueprint.widgets);
  const groups: CompositionGroup[] = [
    { kind: 'projects', items: sections(blueprint.projects).map(named) },
    { kind: 'tables', items: sections(blueprint.tables).map(table) },
    { kind: 'requires', items: sections(blueprint.requires?.tables).map(table) },
    { kind: 'apps', items: [...sections(blueprint.apps), ...widgets.filter(widget => !widget.dashboard)].map(entry => surface(entry)) },
    {
      kind: 'tiles',
      items: [
        ...sections(blueprint.dashboards).flatMap(dashboard => sections(dashboard.tiles).map(tile => surface(tile, titleOf(dashboard)))),
        ...widgets.filter(widget => widget.dashboard).map(widget => surface(widget)),
      ],
    },
    { kind: 'agents', items: sections(blueprint.agents).map(named) },
    { kind: 'automations', items: sections(blueprint.automations).map(named) },
    { kind: 'services', items: sections(blueprint.services).map(service => ({ ...named(service), hint: host(service.url) })) },
  ];
  return groups.filter(group => group.items.length > 0);
}
