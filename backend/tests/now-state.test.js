// @vitest-environment node
/**
 * ADR-171 T1 — NowState read-model + mock endpoint.
 * Contract + route tests. No DB dependency (mock fixture is pure).
 */
import { describe, test, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import Ajv from 'ajv';

import {
  buildMockNowState,
  NOW_STATE_JSON_SCHEMA,
  NOW_STATE_OPTIONAL_KEYS,
  NOW_STATE_TOP_KEYS,
  NOW_STATE_VERSION,
  STAMINA_TRENDS,
} from '../services/nowState/contract.js';
import nowStateRoutes from '../routes/v3/now-state.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  // Mount without the global authenticate middleware — we test the handler.
  app.use('/api/v3', nowStateRoutes);
  return app;
}

describe('NowState contract', () => {
  test('mock fixture has all six frozen top-level keys', () => {
    const s = buildMockNowState();
    for (const key of NOW_STATE_TOP_KEYS) {
      expect(s, `missing top-level key: ${key}`).toHaveProperty(key);
    }
  });

  test('mock fixture is deterministic across calls (stable payload)', () => {
    expect(buildMockNowState()).toEqual(buildMockNowState());
    // ...and byte-stable when serialized (no Date.now() / randomness leaked in).
    expect(JSON.stringify(buildMockNowState())).toBe(JSON.stringify(buildMockNowState()));
  });

  test('each call returns a fresh (independently mutable) object', () => {
    const a = buildMockNowState();
    a.waypoint.trackIds.push(999);
    expect(buildMockNowState().waypoint.trackIds).toEqual([50010, 50011]);
  });

  test('mock fixture validates against the JSON schema', () => {
    // strict:false → the `format: date-time` keyword is ignored (ajv-formats
    // is not a project dep); structure/type/enum validation still applies.
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(NOW_STATE_JSON_SCHEMA);
    const ok = validate(buildMockNowState());
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  test('waypoint carries trackIds as an integer array (ADR-0156 relation shape)', () => {
    const { waypoint } = buildMockNowState();
    expect(Array.isArray(waypoint.trackIds)).toBe(true);
    expect(waypoint.trackIds.every((id) => Number.isInteger(id))).toBe(true);
  });
});

describe('contract v1.1.0 — nullable stamina + additive creature (ADR-0196 D8)', () => {
  const validator = () =>
    new Ajv({ allErrors: true, strict: false }).compile(NOW_STATE_JSON_SCHEMA);

  test('version is bumped to 1.1.0', () => {
    expect(NOW_STATE_VERSION).toBe('1.1.0');
  });

  test('stamina accepts null on every field (no Garmin source yet)', () => {
    const payload = buildMockNowState();
    payload.stamina = { bodyBattery: null, stress: null, trend: null };
    const validate = validator();
    const ok = validate(payload);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  test('stamina keys stay required — null is allowed, a missing key is not', () => {
    // The other half of the D8 loosening: values became nullable, keys did NOT
    // become optional. A consumer must keep reading `stamina.bodyBattery` with
    // no existence check, so dropping the key has to fail validation.
    const payload = buildMockNowState();
    delete payload.stamina.bodyBattery;
    expect(validator()(payload)).toBe(false);
  });

  test("stamina.trend still rejects 'unknown' — absence is null, not a fourth member", () => {
    const payload = buildMockNowState();
    payload.stamina.trend = 'unknown';
    expect(validator()(payload)).toBe(false);
    expect(STAMINA_TRENDS).toEqual(['rising', 'falling', 'steady']);
  });

  test('numeric bounds still apply when stamina is not null', () => {
    const payload = buildMockNowState();
    payload.stamina.bodyBattery = 101;
    expect(validator()(payload)).toBe(false);
  });

  test('creature is optional — a payload without it stays valid', () => {
    const payload = buildMockNowState();
    delete payload.creature;
    expect(validator()(payload)).toBe(true);
  });

  test('additive keys are never required (old consumers keep validating)', () => {
    for (const key of NOW_STATE_OPTIONAL_KEYS) {
      expect(NOW_STATE_JSON_SCHEMA.required).not.toContain(key);
      expect(NOW_STATE_TOP_KEYS).not.toContain(key);
    }
  });

  test('creature vitals are 0..1 floats with a human-readable reason', () => {
    const { creature } = buildMockNowState();
    for (const vital of ['mood', 'hunger', 'energy']) {
      expect(creature[vital]).toBeGreaterThanOrEqual(0);
      expect(creature[vital]).toBeLessThanOrEqual(1);
    }
    expect(typeof creature.reason).toBe('string');
    const payload = buildMockNowState();
    payload.creature.mood = 1.5;
    expect(validator()(payload)).toBe(false);
  });

  test('creature vitals accept null when PES has no state', () => {
    const payload = buildMockNowState();
    payload.creature = { mood: null, hunger: null, energy: null, reason: null };
    expect(validator()(payload)).toBe(true);
  });
});

describe('GET /api/v3/now-state', () => {
  beforeEach(() => {
    delete process.env.NOW_STATE_MOCK; // default → mock ON
  });

  test('returns 200 with all six top-level keys under data', async () => {
    const res = await request(makeApp()).get('/api/v3/now-state');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    for (const key of NOW_STATE_TOP_KEYS) {
      expect(res.body.data).toHaveProperty(key);
    }
    expect(res.body.data.meta.mock).toBe(true);
    expect(res.body.data.meta.version).toBe(NOW_STATE_VERSION);
  });

  test('mock response is stable across repeated calls', async () => {
    const app = makeApp();
    const a = await request(app).get('/api/v3/now-state');
    const b = await request(app).get('/api/v3/now-state');
    expect(a.body.data).toEqual(b.body.data);
  });

  test('with NOW_STATE_MOCK=false the live model is 501 (not silently mocked)', async () => {
    process.env.NOW_STATE_MOCK = 'false';
    const res = await request(makeApp()).get('/api/v3/now-state');
    expect(res.status).toBe(501);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe('NOW_STATE_NOT_IMPLEMENTED');
  });
});
