// @vitest-environment node
/**
 * DCD scope-router contract (ADR-157).
 *
 * The router's only job for memory queries: query → `room` (Collection step) or
 * `null` (widen to domain). These pins lock the contract the caller relies on:
 *  - a confident keyword match routes to that room (confidence ≥ floor)
 *  - a single weak hit widens (room null) rather than mis-scoping
 *  - no/empty match widens
 *  - the router can only ever emit a known room or null
 */
import { describe, it, expect } from 'vitest';
import {
  routeMemoryScope,
  ROOMS,
  ROUTE_CONFIDENCE_FLOOR,
} from '../scopeRouter.js';

describe('routeMemoryScope', () => {
  it('routes a multi-keyword query to its room with high confidence', () => {
    const r = routeMemoryScope('how does the jwt login token session work');
    expect(r.room).toBe('auth');
    expect(r.confidence).toBeGreaterThanOrEqual(ROUTE_CONFIDENCE_FLOOR);
  });

  it('emits only a known room or null', () => {
    const r = routeMemoryScope('deploy the build to the release pipeline server');
    expect(r.room === null || ROOMS.includes(r.room)).toBe(true);
  });

  it('widens to domain (room=null) on a single weak keyword hit', () => {
    const r = routeMemoryScope('what about the api');
    expect(r.room).toBeNull();
    expect(r.confidence).toBeLessThan(ROUTE_CONFIDENCE_FLOOR);
    expect(r.reason).toMatch(/widen/i);
  });

  it('widens to domain when no keyword matches', () => {
    const r = routeMemoryScope('tell me about the weather yesterday');
    expect(r.room).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.reason).toMatch(/no room keywords|widen/i);
  });

  it('widens on an empty query rather than throwing', () => {
    expect(routeMemoryScope('').room).toBeNull();
    expect(routeMemoryScope(undefined).room).toBeNull();
  });

  it('routes infrastructure vocabulary to the infrastructure room', () => {
    const r = routeMemoryScope('the nginx server on the pm2 host keeps crashing');
    expect(r.room).toBe('infrastructure');
    expect(r.confidence).toBeGreaterThanOrEqual(ROUTE_CONFIDENCE_FLOOR);
  });
});
