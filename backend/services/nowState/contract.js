/**
 * NowState contract — ADR-171 (T1).
 *
 * THE single backend-computed read-model every surface subscribes to:
 * the CXR-S glasses HUD, the CXR-M companion (Flutter), Garmin, and the
 * phone/desktop web UI all render from this one shape. This module is the
 * source of truth for that shape — JSON Schema for runtime validation, a
 * deterministic mock fixture so consumers can develop before the domain /
 * Garmin sources exist, and `src/shared/types/now-state.types.ts` mirrors it
 * for the TS frontend + Dart companion.
 *
 * FREEZE NOTICE: the top-level keys and every field name below are the
 * frozen contract T2/T3/T4/T5/T9 build against. Extend by ADDITION only
 * (new optional fields) — never rename or repurpose an existing field
 * (Hyrum's Law: HUD firmware will already depend on these names).
 *
 * v1.1.0 (ADR-0196 D8) — the ONE loosening pass, taken while the contract
 * still has zero deployed consumers (the HUD APK is unreleased):
 *   1. `stamina.*` becomes nullable. Without a Garmin source the read-model
 *      (P0.2) has no honest integer to put there, and inventing one is worse
 *      than admitting absence. `trend: 'unknown'` was rejected as the escape
 *      hatch — STAMINA_TRENDS stays three members, absence is `null`.
 *   2. `creature` is added as an OPTIONAL top-level key: the mirror-agent's
 *      own vitals, so P0.3 (PES bio-events) and P0.4 (prompt injection) have
 *      a transport. It is NOT in NOW_STATE_TOP_KEYS — old consumers that
 *      require exactly the six domain keys keep validating unchanged.
 * Loosening a schema always breaks a strict consumer; doing it after T9 ships
 * would mean reflashing glasses. Past this bump the FREEZE NOTICE is literal.
 */

export const NOW_STATE_VERSION = '1.1.0';

/**
 * Provisional shared vocabulary for a unit of work / focus block. The SHAPE
 * (a string drawn from this set) is frozen; the exact member list may grow
 * as T2 wires the domain — treat unknown values as opaque, never crash on them.
 */
export const WORK_TYPES = Object.freeze([
  'deep', // focused creative / cognitively heavy
  'admin', // shallow, transactional
  'body', // physical / training / chores
  'social', // people, calls, comms
  'rest', // deliberate recovery
  'input', // reading / learning / intake
]);

export const ENERGY_LEVELS = Object.freeze(['low', 'medium', 'high']);
export const STAMINA_TRENDS = Object.freeze(['rising', 'falling', 'steady']);

/** The six frozen top-level keys. Order is not significant; presence is. */
export const NOW_STATE_TOP_KEYS = Object.freeze([
  'waypoint',
  'tunnel',
  'stamina',
  'pressure',
  'cleanup',
  'nextUnlock',
]);

/**
 * v1.1.0 additive key — the mirror creature's vitals (ADR-0196 D8).
 * Optional by design: a surface that predates v1.1.0 must keep working, and
 * the read-model omits the key entirely when PES has no state for the space.
 * Vitals mirror PES `mood`/`energy`/`hunger` (0..1 floats, `pes-core/core/pes.js`).
 * `reason` is the human-readable "потому что ты…" line — Law 1 of ADR-0196:
 * a visible creature state that cannot be explained by one fact about the
 * owner does not exist.
 */
export const NOW_STATE_OPTIONAL_KEYS = Object.freeze(['meta', 'creature']);

// A fixed instant so mock mode is byte-stable across calls (acceptance:
// "Mock mode returns stable payload across calls"). NOT `new Date()`.
const MOCK_TUNNEL_SINCE = '2026-07-13T09:00:00.000Z';
const MOCK_GENERATED_AT = '2026-07-13T00:00:00.000Z';

/**
 * Deterministic NowState fixture — no dependency on domain tables or Garmin.
 * Returns a fresh object each call (safe for callers to mutate) but with
 * byte-identical values every time.
 *
 * @returns {object} a fully-populated NowState payload
 */
export function buildMockNowState() {
  return {
    waypoint: {
      taskId: 90001,
      trackIds: [50010, 50011], // relation array — matches ADR-0156 multi_select (row ids)
      type: 'deep',
      energy: 'high',
      phrasing: 'Ship the NowState contract — one clean pass, no side quests.',
      sizeMin: 90,
      elapsedMin: 25,
    },
    tunnel: {
      currentType: 'deep',
      since: MOCK_TUNNEL_SINCE,
    },
    stamina: {
      bodyBattery: 72,
      stress: 28,
      trend: 'falling',
    },
    pressure: {
      boilingCount: 3,
    },
    cleanup: {
      available: true,
      count: 2,
      items: [
        { taskId: 90050, title: 'Archive last week’s done tickets' },
        { taskId: 90051, title: 'Clear the inbox triage lane' },
      ],
    },
    nextUnlock: {
      taskId: 90002,
      gatedBy: 'Finish the current deep waypoint first',
    },
    creature: {
      mood: 0.62,
      hunger: 0.35,
      energy: 0.71,
      reason: 'Ты закрыл два блока подряд, но не ел с утра.',
    },
    meta: {
      version: NOW_STATE_VERSION,
      mock: true,
      generatedAt: MOCK_GENERATED_AT,
    },
  };
}

/**
 * AJV (draft-07) schema. `meta` is additive/optional so a strict consumer can
 * ignore it; the six domain keys are all required. `additionalProperties` is
 * left open at the top level so future ADDITIVE keys don't break old clients.
 */
export const NOW_STATE_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://app.godcrm.ai/schema/now-state/v1.json',
  title: 'NowState',
  type: 'object',
  required: [...NOW_STATE_TOP_KEYS],
  properties: {
    waypoint: {
      type: 'object',
      required: ['taskId', 'trackIds', 'type', 'energy', 'phrasing', 'sizeMin', 'elapsedMin'],
      properties: {
        taskId: { type: ['integer', 'null'] },
        trackIds: { type: 'array', items: { type: 'integer' } },
        type: { type: 'string' },
        energy: { type: 'string', enum: [...ENERGY_LEVELS] },
        phrasing: { type: 'string' },
        sizeMin: { type: 'integer', minimum: 0 },
        elapsedMin: { type: 'integer', minimum: 0 },
      },
    },
    tunnel: {
      type: 'object',
      required: ['currentType', 'since'],
      properties: {
        currentType: { type: 'string' },
        since: { type: 'string', format: 'date-time' },
      },
    },
    // v1.1.0: the three keys stay REQUIRED (a consumer may always read them),
    // but each value is nullable — `null` is the honest answer until T5 wires
    // Garmin. Numeric bounds still apply whenever the value is not null.
    stamina: {
      type: 'object',
      required: ['bodyBattery', 'stress', 'trend'],
      properties: {
        bodyBattery: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
        stress: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
        trend: { type: ['string', 'null'], enum: [...STAMINA_TRENDS, null] },
      },
    },
    pressure: {
      type: 'object',
      required: ['boilingCount'],
      properties: {
        boilingCount: { type: 'integer', minimum: 0 },
      },
    },
    cleanup: {
      type: 'object',
      required: ['available', 'count', 'items'],
      properties: {
        available: { type: 'boolean' },
        count: { type: 'integer', minimum: 0 },
        items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['taskId', 'title'],
            properties: {
              taskId: { type: ['integer', 'null'] },
              title: { type: 'string' },
            },
          },
        },
      },
    },
    nextUnlock: {
      type: 'object',
      required: ['taskId', 'gatedBy'],
      properties: {
        taskId: { type: ['integer', 'null'] },
        gatedBy: { type: ['string', 'null'] },
      },
    },
    // v1.1.0 additive — optional, so pre-1.1.0 payloads stay valid.
    creature: {
      type: 'object',
      required: ['mood', 'hunger', 'energy', 'reason'],
      properties: {
        mood: { type: ['number', 'null'], minimum: 0, maximum: 1 },
        hunger: { type: ['number', 'null'], minimum: 0, maximum: 1 },
        energy: { type: ['number', 'null'], minimum: 0, maximum: 1 },
        reason: { type: ['string', 'null'] },
      },
    },
    meta: {
      type: 'object',
      properties: {
        version: { type: 'string' },
        mock: { type: 'boolean' },
        generatedAt: { type: 'string', format: 'date-time' },
      },
    },
  },
};
