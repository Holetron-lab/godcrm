/**
 * Unified widget display name builder.
 *
 * Format: `{PresetLabel}{subtype ? ": " + subtype : ""} #{widget.id}`
 *
 * Examples:
 *   - tickets_list, config.filter = {column:'adr_ref', ...} → "Tickets List: adr_ref #219"
 *   - task_list,   config.bdd_criteria = true               → "Task List: bdd_criteria #217"
 *   - documents (no subtype)                                 → "Documents #218"
 *   - unknown / legacy preset → fallback widget.title if user-set, else "Widget #{id}"
 *
 * Respects user-customised titles: if `widget.title` is non-default
 * (not empty / null / "Widget" / "Виджет" / "Виджет N"), it wins.
 */
import type { Widget } from '../types/widget.types';
import { getPresetConfig } from '../config/widget-presets.config';

const DEFAULT_TITLE_RE = /^(Widget|Виджет)(\s+\d+)?$/;

function isUserSetTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  const trimmed = title.trim();
  if (!trimmed) return false;
  if (DEFAULT_TITLE_RE.test(trimmed)) return false;
  return true;
}

function toTitleCase(snake: string): string {
  return snake
    .split('_')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function getPresetLabel(presetName: string): string {
  const cfg = getPresetConfig(presetName);
  if (cfg?.name) return cfg.name;
  return toTitleCase(presetName);
}

function getSubtype(widget: Widget): string | null {
  const cfg = (widget.config ?? {}) as Record<string, unknown>;

  switch (widget.preset_name) {
    case 'task_list': {
      if (cfg.bdd_criteria === true) return 'bdd_criteria';
      return null;
    }
    case 'tickets_list': {
      const filter = cfg.filter as { column?: unknown } | undefined;
      if (filter && typeof filter === 'object' && typeof filter.column === 'string' && filter.column) {
        return filter.column;
      }
      return null;
    }
    default:
      return null;
  }
}

export function getWidgetDisplayName(widget: Widget): string {
  // No preset → respect user title if set, else generic fallback.
  if (!widget.preset_name) {
    if (isUserSetTitle(widget.title)) {
      return `${widget.title} #${widget.id}`;
    }
    return `Widget #${widget.id}`;
  }

  // User explicitly named the widget — honour it.
  if (isUserSetTitle(widget.title)) {
    return `${widget.title} #${widget.id}`;
  }

  const label = getPresetLabel(widget.preset_name);
  const subtype = getSubtype(widget);
  const head = subtype ? `${label}: ${subtype}` : label;
  return `${head} #${widget.id}`;
}
