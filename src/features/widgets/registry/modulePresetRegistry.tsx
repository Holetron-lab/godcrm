import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { PresetWidgetProps } from '../types/widget.types';
import { registry, type ModulePresetEntry } from './presetRegistryStore';

/**
 * Autonomous-module preset registry — public resolver + module bootstrap
 * (MODULE-CONTRACT v1, ADR-165-P).
 *
 * Core never names a module. Each pluggable module ships a single side-effect
 * `*.module.tsx` that calls `registerWidgetPreset` (imported from the leaf
 * `presetRegistryStore`, NOT from here) to plug its widget preset in. The glob
 * at the bottom eager-imports every such file at load time, so registration
 * happens before any widget renders.
 *
 * The autonomy invariant falls out for free: delete a module's directories and
 * its `*.module.tsx` leaves with them → the glob matches nothing → the registry
 * stays empty → core renders the "not installed" fallback and type-checks clean.
 * No core edit is ever required to add or remove a module.
 *
 * NOTE: the storage lives in `presetRegistryStore` (a dependency-free leaf) so
 * that this file — which imports the registrars via the glob — is never part of
 * a cycle with them. See that file for the TDZ regression this split fixed.
 */

export type { ModulePresetEntry };

/** Resolve a module-provided preset component, or `undefined` if not installed. */
export function getWidgetPreset(
  key: string | null | undefined,
): ComponentType<PresetWidgetProps> | undefined {
  if (!key) return undefined;
  return registry.get(key)?.component;
}

/** Palette icons contributed by installed modules, keyed by preset id. */
export function getModulePresetIcons(): Record<string, LucideIcon> {
  const icons: Record<string, LucideIcon> = {};
  for (const [key, entry] of registry) {
    if (entry.icon) icons[key] = entry.icon;
  }
  return icons;
}

// Eager-import every module registrar so each self-registers at load. Each
// registrar imports `registerWidgetPreset` from the leaf `presetRegistryStore`,
// whose `registry` Map is already initialised by the time this glob runs them —
// so there is no circular-import ordering hazard (dev or production build).
import.meta.glob('/src/**/*.module.tsx', { eager: true });
