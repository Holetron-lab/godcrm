import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { PresetWidgetProps } from '../types/widget.types';

/**
 * Leaf storage for the autonomous-module preset registry (ADR-165-P).
 *
 * This module imports NOTHING from any `*.module.tsx` registrar, so it is a sink
 * in the import graph: its `registry` Map is guaranteed to initialise before any
 * registrar runs. Module registrars import {@link registerWidgetPreset} from
 * HERE — never from `modulePresetRegistry.tsx` (which runs the eager glob).
 *
 * Why the split exists: previously the Map + register fn lived in
 * `modulePresetRegistry.tsx` alongside the `import.meta.glob(... {eager:true})`.
 * The globbed registrars import the register fn back from that same file, so the
 * two formed a circular import. It worked in dev (native ESM, top-to-bottom) but
 * in the Rollup production build the cycle was concatenated with the
 * `registerWidgetPreset('sc_sim', …)` call hoisted ahead of `const registry =
 * new Map()`, throwing "Cannot access 's' before initialization" during render.
 * Keeping the storage in a dependency-free leaf makes registration order-proof.
 */

export interface ModulePresetEntry {
  /** The widget component rendered for this preset key. */
  component: ComponentType<PresetWidgetProps>;
  /** Optional palette icon, so the icon travels with the module, not core. */
  icon?: LucideIcon;
}

export const registry = new Map<string, ModulePresetEntry>();

/** Called from a module's `*.module.tsx` side-effect file to plug in its preset. */
export function registerWidgetPreset(key: string, entry: ModulePresetEntry): void {
  registry.set(key, entry);
}
