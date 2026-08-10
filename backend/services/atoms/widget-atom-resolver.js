// ADR-0003 Phase 2 · T-127902
//
// Resolver for atoms that embed a widget. Given an atom carrying
// `widget_ref` (and optionally `settings_override`), produce the
// {widget, preset, resolved_settings} triple the renderer needs.
//
// Merge rule (ADR-0005 §C-9): shallow object merge, `settings_override`
// wins over `widget.config`. Keeps `widget.config` canonical on the
// widget row — per-embed overrides live only on the atom.
//
// Broken ref (deleted widget, bad id) → { widget:null, fallback:true,
// reason, widget_ref } so the frontend can render a placeholder
// (see T-127905 WidgetAtomRenderer / WidgetAtomPlaceholder).

import { dbGet } from '../../database/connection.js';

function parseWidgetConfig(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

async function defaultLoadWidget(widgetId) {
  return dbGet(
    'SELECT id, preset_name, widget_type, config, title FROM widgets WHERE id = ?',
    [widgetId]
  );
}

/**
 * @param {object} atom - atoms_v2 row data: { widget_ref, settings_override, ... }
 * @param {object} [opts]
 * @param {(id:number) => Promise<object|null>} [opts.loadWidget] - injected
 *   widget loader (DI for tests); defaults to DB lookup.
 * @returns {Promise<
 *   | { widget:object, preset:string, resolved_settings:object, fallback:false }
 *   | { widget:null, fallback:true, reason:string, widget_ref?:number }
 * >}
 */
export async function resolveWidgetAtom(atom, { loadWidget = defaultLoadWidget } = {}) {
  const rawRef = atom?.widget_ref;
  const widgetRef = rawRef == null || rawRef === '' ? null : Number(rawRef);
  if (!widgetRef || !Number.isFinite(widgetRef)) {
    return { widget: null, fallback: true, reason: 'no_widget_ref' };
  }

  const widget = await loadWidget(widgetRef);
  if (!widget) {
    return { widget: null, fallback: true, reason: 'widget_not_found', widget_ref: widgetRef };
  }

  const widgetConfig = parseWidgetConfig(widget.config);
  const override = atom?.settings_override && typeof atom.settings_override === 'object'
    ? atom.settings_override
    : {};

  const resolved_settings = { ...widgetConfig, ...override };
  const preset = widget.preset_name || widgetConfig.preset_name || 'default';

  return {
    widget: { ...widget, config: widgetConfig },
    preset,
    resolved_settings,
    fallback: false,
  };
}
