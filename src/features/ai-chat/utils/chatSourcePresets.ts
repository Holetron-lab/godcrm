/**
 * chatSourcePresets — T-141631 / ADR-0031 follow-up.
 * Loads preset list from shared/chat-source-presets.json and exposes helpers
 * for filtering, resolving (`$find:` patterns), and reverse-detecting which
 * preset (if any) matches an existing manual mapping.
 */
import presetsData from '../../../../shared/chat-source-presets.json';
import type { TasksSourceConfig, FavoritesConfig, FavoriteTable } from '../components/AIChatPanel/types';

export type ChatSourceKind = 'tickets' | 'documents' | 'custom';

export interface ChatSourcePreset {
  id: string;
  name: string;
  emoji: string;
  kind: ChatSourceKind;
  applicable_table_ids: number[] | null;
  mapping: Record<string, string>;
}

export const CHAT_SOURCE_PRESETS: ChatSourcePreset[] = (presetsData.presets as ChatSourcePreset[]) || [];

export function getApplicablePresets(
  kind: ChatSourceKind,
  tableId: number | undefined,
  presets: ChatSourcePreset[] = CHAT_SOURCE_PRESETS,
): ChatSourcePreset[] {
  return presets.filter(p => {
    if (p.kind !== kind) return false;
    if (p.applicable_table_ids === null) return true;
    if (tableId == null) return false;
    return p.applicable_table_ids.includes(tableId);
  });
}

/**
 * Resolve a preset's mapping against a table's actual columns.
 * Plain string → returned if a column with that exact name exists, else undefined.
 * `$find:a|b|c` → first column whose name case-insensitively matches one
 * of the alternatives (in given order).
 *
 * Accepts columns with either `name` (current /tables/:id/columns shape) or
 * `column_name` (legacy/typed shape) — whichever is present is used.
 */
export function resolvePreset(
  preset: ChatSourcePreset,
  availableColumns: Array<{ name?: string; column_name?: string }>,
): Record<string, string | undefined> {
  const lowerToOriginal = new Map<string, string>();
  for (const col of availableColumns) {
    const colName = col.name || col.column_name;
    if (!colName) continue;
    lowerToOriginal.set(colName.toLowerCase(), colName);
  }
  const out: Record<string, string | undefined> = {};
  for (const [key, raw] of Object.entries(preset.mapping)) {
    if (typeof raw !== 'string') {
      out[key] = undefined;
      continue;
    }
    if (raw.startsWith('$find:')) {
      const alts = raw.slice('$find:'.length).split('|').map(s => s.trim()).filter(Boolean);
      let resolved: string | undefined;
      for (const alt of alts) {
        const hit = lowerToOriginal.get(alt.toLowerCase());
        if (hit) { resolved = hit; break; }
      }
      out[key] = resolved;
    } else {
      out[key] = lowerToOriginal.get(raw.toLowerCase()) || undefined;
    }
  }
  return out;
}

/**
 * If `currentMapping` matches one of the applicable presets (after resolving),
 * return that preset id. Only keys defined by the preset are compared — extra
 * fields in currentMapping are ignored. Returns null if no preset matches.
 */
export function detectMatchingPreset(
  currentMapping: Record<string, string | undefined>,
  presets: ChatSourcePreset[],
  kind: ChatSourceKind,
  tableId: number | undefined,
  availableColumns: Array<{ name?: string; column_name?: string }>,
): string | null {
  const applicable = getApplicablePresets(kind, tableId, presets);
  for (const preset of applicable) {
    const resolved = resolvePreset(preset, availableColumns);
    let allMatch = true;
    for (const key of Object.keys(preset.mapping)) {
      const want = resolved[key];
      const have = currentMapping[key];
      // Both undefined = match (preset key unresolvable AND user has no value).
      // Otherwise exact (case-insensitive) compare.
      if ((want || '').toLowerCase() !== (have || '').toLowerCase()) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return preset.id;
  }
  return null;
}

/**
 * Test whether a saved column-name mapping is compatible with a preset's
 * declared mapping — without requiring full column metadata.
 *
 * Plain literal values are compared case-insensitively.
 * `$find:a|b|c` patterns match if the user's saved value is one of the
 * alternatives (case-insensitive).
 *
 * Used by `resolveActivePreset` to recover preset identity from configs
 * that were saved before `.preset` started being persisted explicitly
 * (the dropdown displays the auto-detected preset but doesn't fire
 * onChange unless the user picks a *different* option).
 */
function mappingMatchesPreset(
  mapping: Record<string, string | undefined>,
  preset: ChatSourcePreset,
): boolean {
  for (const [key, raw] of Object.entries(preset.mapping)) {
    const have = (mapping[key] || '').toLowerCase();
    if (typeof raw !== 'string') continue;
    if (raw.startsWith('$find:')) {
      // `$find:` is best-effort — if the user has no value for this key,
      // accept as match (the table likely has none of the alternatives).
      // Mirrors `detectMatchingPreset`'s tolerance for unresolvable $find:
      // patterns; otherwise an auto-detected preset that displays in the
      // settings dropdown can still fail to resolve here, leaving the row
      // chip in legacy mode (T-141631 follow-up).
      if (!have) continue;
      const alts = raw.slice('$find:'.length).split('|').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (!alts.includes(have)) return false;
    } else {
      if (raw.toLowerCase() !== have) return false;
    }
  }
  return true;
}

/**
 * T-141688 / ADR-0031 §Y / WP-22 — resolve the preset currently active for
 * a given (workspace, table) tuple based on the space's saved config.
 *
 * Lookup order against the in-memory space-level config:
 *   1. `tasksSource` (= `_spaces.tickets_config`) — matches if `tableId`
 *      matches AND either `.preset` is set OR the saved mapping matches a
 *      preset's declared mapping.
 *   2. `favoritesConfig.documents` — same.
 *   3. `favoritesConfig.custom[]` — same, first matching entry wins.
 *
 * Falling back to mapping-based detection lets us recover preset identity
 * for pre-WP-22 configs where the user had picked a preset in the UI but
 * the value never persisted (the dropdown auto-detected without firing
 * onChange).
 *
 * Returns the matched preset object, or `null` if nothing applies.
 *
 * NOTE: `workspaceId` is part of the signature for future per-workspace
 * preset registries (currently presets are global / shared).
 */
export function resolveActivePreset(args: {
  workspaceId?: number | null | undefined;
  tableId: number;
  tasksSource?: TasksSourceConfig | null | undefined;
  favoritesConfig?: FavoritesConfig | null | undefined;
  presets?: ChatSourcePreset[];
}): ChatSourcePreset | null {
  const { tableId, tasksSource, favoritesConfig } = args;
  const presets = args.presets ?? CHAT_SOURCE_PRESETS;
  if (!tableId) return null;

  type Slot = { kind: ChatSourceKind; cfg: Record<string, string | undefined> & { preset?: string } };
  const slots: Slot[] = [];

  if (tasksSource && tasksSource.tableId === tableId) {
    slots.push({ kind: 'tickets', cfg: tasksSource as unknown as Slot['cfg'] });
  }
  const docs = favoritesConfig?.documents;
  if (docs && docs.tableId === tableId) {
    slots.push({ kind: 'documents', cfg: docs as unknown as Slot['cfg'] });
  }
  const customs: FavoriteTable[] = favoritesConfig?.custom || [];
  for (const c of customs) {
    if (c.tableId === tableId) {
      slots.push({ kind: 'custom', cfg: c as unknown as Slot['cfg'] });
    }
  }

  if (slots.length === 0) return null;

  for (const { kind, cfg } of slots) {
    // Path 1: explicit `.preset` saved.
    if (cfg.preset) {
      const preset = presets.find(p => p.id === cfg.preset);
      if (preset && (preset.applicable_table_ids === null || preset.applicable_table_ids.includes(tableId))) {
        return preset;
      }
    }
    // Path 2: auto-detect from saved mapping (handles pre-WP-22 configs).
    const applicable = getApplicablePresets(kind, tableId, presets);
    for (const preset of applicable) {
      if (mappingMatchesPreset(cfg, preset)) return preset;
    }
  }

  return null;
}
