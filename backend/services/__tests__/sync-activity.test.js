/**
 * Sync-agent activity registry — protects live sync agents from the watchdog
 * orphan-reaper (see services/agent-job/watchdog.js orphan branch).
 *
 * Bug: a sync agent (POST /chat, /run) holds conversations.is_processing=true with
 * no agent_jobs row. During one long blocking call (no intermediate saveStepMessage)
 * updated_at goes stale and the watchdog clears the lock of a STILL-WORKING agent,
 * posting «… перестал отвечать». The registry lets the watchdog tell live from dead.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  SYNC_ACTIVITY_MAX_MS,
  markSyncActive,
  markSyncInactive,
  isSyncActive,
  activeSyncCount,
} from '../chat/agent-execution-shared/sync-activity.js';

describe('sync-activity registry', () => {
  beforeEach(() => {
    // Drain any leftover entries between tests (module state is process-global).
    markSyncInactive(101);
    markSyncInactive(202);
    markSyncInactive(303);
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a freshly marked conversation is live → watchdog must skip it', () => {
    expect(isSyncActive(101)).toBe(false); // not yet started
    markSyncActive(101);
    expect(isSyncActive(101)).toBe(true);
    expect(activeSyncCount()).toBe(1);
  });

  it('accepts string conversation ids (route params arrive as strings)', () => {
    markSyncActive('202');
    expect(isSyncActive(202)).toBe(true);   // number lookup
    expect(isSyncActive('202')).toBe(true); // string lookup
  });

  it('markSyncInactive clears the mark → watchdog may reap', () => {
    markSyncActive(101);
    expect(isSyncActive(101)).toBe(true);
    markSyncInactive(101);
    expect(isSyncActive(101)).toBe(false);
    expect(activeSyncCount()).toBe(0);
  });

  it('a genuinely hung agent past the max-age cap is NOT protected (and is evicted)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T00:00:00Z'));
    markSyncActive(303);
    expect(isSyncActive(303)).toBe(true);

    // Just under the cap → still protected.
    vi.advanceTimersByTime(SYNC_ACTIVITY_MAX_MS - 1000);
    expect(isSyncActive(303)).toBe(true);

    // Past the cap → reapable, and the stale entry is removed.
    vi.advanceTimersByTime(2000);
    expect(isSyncActive(303)).toBe(false);
    expect(activeSyncCount()).toBe(0);
  });

  it('null/undefined ids are ignored safely', () => {
    expect(() => markSyncActive(null)).not.toThrow();
    expect(() => markSyncInactive(undefined)).not.toThrow();
    expect(isSyncActive(null)).toBe(false);
    expect(isSyncActive(undefined)).toBe(false);
  });
});
