/**
 * Neo16 preset type augmentation (MODULE-CONTRACT v1, seam #2 — doc 239900 W1).
 *
 * Core's `PresetWidgetName` union includes `keyof ModulePresetRegistry`, an
 * empty interface core exposes but never populates. This module declares its
 * own key back into that interface from inside its own directory, so the
 * `'16neo'` literal is known to the type system without core ever naming it.
 *
 * Delete this directory and the augmentation leaves with it — the core union
 * has no dangling `'16neo'` member and `tsc` stays green. Same shape as
 * `sc-sim.preset.d.ts` and `mail.preset.d.ts`.
 */
import type {} from '@/features/widgets/types/widget.types';

declare module '@/features/widgets/types/widget.types' {
  interface ModulePresetRegistry {
    '16neo': true;
  }
}

export {};
