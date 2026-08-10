// ADR-0012 Phase 8.5 — frontend port of backend's WidgetService.mergeWidgetConfig.
// Semantics MUST stay byte-equivalent with the backend resolver:
//   - plain objects merge deep (key-by-key, recursive),
//   - arrays replace wholesale,
//   - primitives (and explicit null) replace.
// This lets the renderer compute the effective config locally from a raw
// template + an atom's settings_override, so /widgets/:id no longer needs
// `?atom_id=` to ship a pre-merged response.

type Plain = Record<string, unknown>;

function isPlainObject(v: unknown): v is Plain {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined) return base;
  if (!isPlainObject(override)) return override;
  if (!isPlainObject(base)) return override;
  const out: Plain = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = deepMerge(base[k], v);
  }
  return out;
}

export function mergeWidgetConfig(
  widgetConfig: unknown,
  override: unknown,
): Plain {
  const base = isPlainObject(widgetConfig) ? widgetConfig : {};
  if (!isPlainObject(override)) return base;
  return deepMerge(base, override) as Plain;
}

// ADR-0005 C-4 — derive the dot-paths of every leaf field touched by an
// atom-level `settings_override`. Used by the settings rail to mark fields
// as "locked by document author" — leaf scalars + arrays + null are leaves;
// nested plain objects descend so e.g. `{filter:{column:'x'}}` yields
// ['filter.column']. The empty path '' is never returned.
export function getLockedPaths(override: unknown): string[] {
  if (!isPlainObject(override)) return [];
  const out: string[] = [];
  const walk = (node: unknown, prefix: string) => {
    if (!isPlainObject(node)) {
      if (prefix) out.push(prefix);
      return;
    }
    const entries = Object.entries(node);
    if (entries.length === 0 && prefix) {
      out.push(prefix);
      return;
    }
    for (const [k, v] of entries) {
      const next = prefix ? `${prefix}.${k}` : k;
      walk(v, next);
    }
  };
  walk(override, '');
  return out;
}

// Helper: given a list of locked dot-paths, return true if `field` (or any
// of its ancestors) is locked. Lets callers query at object-granularity
// ("filter") OR field-granularity ("filter.column").
export function isFieldLocked(lockedPaths: string[], field: string): boolean {
  if (!field || lockedPaths.length === 0) return false;
  for (const p of lockedPaths) {
    if (p === field) return true;
    if (p.startsWith(`${field}.`)) return true; // ancestor lock
    if (field.startsWith(`${p}.`)) return true; // descendant of locked subtree
  }
  return false;
}
