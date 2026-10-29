/**
 * NowState — shared contract type (ADR-171 T1).
 *
 * Mirror of `backend/services/nowState/contract.js` (the runtime source of
 * truth). The web frontend (T3) imports this; the Flutter companion (CXR-M)
 * and the HUD APK (T9) mirror the same field names by hand. Extend by
 * ADDITION only — never rename a field.
 *
 * Wire shape: `GET /api/v3/now-state` → `{ success, data: NowState, timestamp }`.
 * `NowState` is the `data` object.
 *
 * Contract v1.1.0 (ADR-0196 D8): `stamina.*` is nullable and the optional
 * `creature` block exists. Keep this file in step with `contract.js` — the
 * JSON Schema there is what actually validates at runtime.
 */

/** Provisional shared work/focus-block vocabulary. Treat unknown as opaque. */
export type WorkType = 'deep' | 'admin' | 'body' | 'social' | 'rest' | 'input' | string;
export type EnergyLevel = 'low' | 'medium' | 'high';
export type StaminaTrend = 'rising' | 'falling' | 'steady';

/** The single "what to do now" the HUD renders. */
export interface Waypoint {
  taskId: number | null;
  /** Ordered relation array of track row-ids (ADR-0156 multi_select). */
  trackIds: number[];
  type: WorkType;
  energy: EnergyLevel;
  /** Human-facing line shown on the glasses. */
  phrasing: string;
  sizeMin: number;
  elapsedMin: number;
}

export interface Tunnel {
  currentType: WorkType;
  /** ISO-8601 instant the current tunnel started. */
  since: string;
}

/**
 * v1.1.0: every field is nullable. `null` means "no Garmin source yet" (T5) —
 * consumers must render absence, not a fabricated number.
 */
export interface Stamina {
  /** Garmin Body Battery, 0–100 (T5). */
  bodyBattery: number | null;
  /** 0–100. */
  stress: number | null;
  trend: StaminaTrend | null;
}

export interface Pressure {
  boilingCount: number;
}

export interface CleanupItem {
  taskId: number | null;
  title: string;
}

export interface Cleanup {
  available: boolean;
  count: number;
  items: CleanupItem[];
}

export interface NextUnlock {
  taskId: number | null;
  gatedBy: string | null;
}

/**
 * v1.1.0 additive (ADR-0196 D8) — the mirror creature's vitals, mirroring PES
 * `mood`/`energy`/`hunger` (0..1). Optional at the top level: absent when PES
 * has no state for the space.
 */
export interface Creature {
  /** 0..1 */
  mood: number | null;
  /** 0..1 */
  hunger: number | null;
  /** 0..1 */
  energy: number | null;
  /** Human-readable "потому что ты…" — why the creature looks the way it does. */
  reason: string | null;
}

export interface NowStateMeta {
  version: string;
  mock: boolean;
  /** ISO-8601. */
  generatedAt: string;
}

/** The six frozen domain keys (+ additive `creature` and `meta`). */
export interface NowState {
  waypoint: Waypoint;
  tunnel: Tunnel;
  stamina: Stamina;
  pressure: Pressure;
  cleanup: Cleanup;
  nextUnlock: NextUnlock;
  creature?: Creature;
  meta?: NowStateMeta;
}
