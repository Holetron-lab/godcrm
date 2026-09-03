/**
 * Mail preset type augmentation (MODULE-CONTRACT v1, seam #2 — ADR-195).
 *
 * Core's `PresetWidgetName` union includes `keyof ModulePresetRegistry`, an
 * empty interface core exposes but never populates. This module declares its
 * own key back into that interface from inside its own directory, so the
 * `'mail'` literal is known to the type system without core ever naming it.
 *
 * Delete `src/features/mail/` and this augmentation leaves with it:
 * `ModulePresetRegistry` is empty again, `keyof {}` is `never`, and the core
 * union has no dangling `'mail'` member — the autonomy invariant (AC-3) holds
 * with no core edit. Same shape as `sc-sim.preset.d.ts`.
 */
import type {} from '@/features/widgets/types/widget.types';

declare module '@/features/widgets/types/widget.types' {
  interface ModulePresetRegistry {
    mail: true;
  }
}

export {};
