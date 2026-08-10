// ADR-0079 P4 — StarterPackService unit tests.
//
// Mocks `database/connection.js` so we exercise the service's logic
// (feature flag, idempotency probe, transactional sequence, promo
// unlock) without touching a real DB. Acceptance criteria covered:
//   AC4 — Tier-A agent slugs hard-coded to 5 in catalog (catalog test)
//   AC5 — MASTERMIND / MESHOK promo flips users.agent_config.unlocked_agent_slugs
//   AC6 — Feature-flag-off path returns {skipped, reason:'feature_disabled'} — no writes
//   IDEM — Re-running on an already-provisioned project no-ops

import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../../../../backend/test/setup.js';

const mockDbGet = vi.fn();
const mockDbAll = vi.fn();
const mockDbRun = vi.fn();
const mockWithTransactionAsync = vi.fn();

vi.mock('../../../database/connection.js', () => ({
  dbGet: (...a) => mockDbGet(...a),
  dbAll: (...a) => mockDbAll(...a),
  dbRun: (...a) => mockDbRun(...a),
  withTransactionAsync: (cb) => mockWithTransactionAsync(cb),
  toBool: (v) => (v ? 1 : 0),
  safeJsonParse: (v, d) => {
    try { return typeof v === 'string' ? JSON.parse(v) : v; }
    catch { return d; }
  }
}));

vi.mock('../../../utils/logger.js', () => ({
  authLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

const { applyStarterPack, applyPromoUnlock, __test } =
  await import('../StarterPackService.js');

const { TIER_B_AGENT_SLUGS } = await import('../starterPackCatalog.js');

describe('StarterPackService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isFeatureEnabled (kill-switch)', () => {
    it('returns true when the row is missing (fail-open)', async () => {
      mockDbGet.mockResolvedValueOnce(null);
      await expect(__test.isFeatureEnabled()).resolves.toBe(true);
    });

    it('returns false when value is false', async () => {
      mockDbGet.mockResolvedValueOnce({ value: false });
      await expect(__test.isFeatureEnabled()).resolves.toBe(false);
    });

    it('parses string "true"', async () => {
      mockDbGet.mockResolvedValueOnce({ value: 'true' });
      await expect(__test.isFeatureEnabled()).resolves.toBe(true);
    });

    it('fails open on DB error', async () => {
      mockDbGet.mockRejectedValueOnce(new Error('boom'));
      await expect(__test.isFeatureEnabled()).resolves.toBe(true);
    });
  });

  describe('applyStarterPack — feature flag off', () => {
    it('skips with reason=feature_disabled when flag is false', async () => {
      mockDbGet.mockResolvedValueOnce({ value: false });
      const r = await applyStarterPack(42, 'Test User');
      expect(r).toEqual({ skipped: true, reason: 'feature_disabled' });
      expect(mockWithTransactionAsync).not.toHaveBeenCalled();
    });
  });

  describe('applyStarterPack — missing personal space', () => {
    it('skips when the user has no personal Space yet', async () => {
      mockDbGet
        .mockResolvedValueOnce({ value: true })  // feature flag
        .mockResolvedValueOnce(null);            // findPersonalHome → no space
      const r = await applyStarterPack(42, 'Test User');
      expect(r).toEqual({ skipped: true, reason: 'no_personal_space' });
      expect(mockWithTransactionAsync).not.toHaveBeenCalled();
    });
  });

  describe('applyStarterPack — idempotency', () => {
    it('skips when starter tables already exist (reason=already_provisioned)', async () => {
      mockDbGet
        .mockResolvedValueOnce({ value: true })                                  // feature flag
        .mockResolvedValueOnce({ id: 100, name: 'Personal Space' })              // space row
        .mockResolvedValueOnce({ id: 200, name: 'Home' });                       // project row
      mockDbAll.mockResolvedValueOnce([{ name: '📔 Daily Log' }]);                // already provisioned
      const r = await applyStarterPack(42, 'Test User');
      expect(r).toEqual({ skipped: true, reason: 'already_provisioned' });
      expect(mockWithTransactionAsync).not.toHaveBeenCalled();
    });
  });

  describe('applyStarterPack — happy path', () => {
    it('runs in a transaction and creates 6 tables + welcome widget + Tor conv', async () => {
      mockDbGet
        .mockResolvedValueOnce({ value: true })
        .mockResolvedValueOnce({ id: 100, name: 'Personal Space' })
        .mockResolvedValueOnce({ id: 200, name: 'My Tasks' });
      mockDbAll.mockResolvedValueOnce([]); // no existing starter tables

      // trx fakes: run returns auto-incrementing IDs; get returns the
      // sequence the production code path actually consumes — project
      // dashboard for per-table widgets, six "no existing widget" checks,
      // then space-dashboard + welcome-widget probes, finally the Tor agent.
      let runCount = 0;
      const trxGet = vi.fn()
        .mockResolvedValueOnce({ id: 3300 })                              // pinStarterTableWidgets — project dashboard
        .mockResolvedValueOnce(null)                                      // table 1 — no existing widget
        .mockResolvedValueOnce(null)                                      // table 2
        .mockResolvedValueOnce(null)                                      // table 3
        .mockResolvedValueOnce(null)                                      // table 4
        .mockResolvedValueOnce(null)                                      // table 5
        .mockResolvedValueOnce(null)                                      // table 6
        .mockResolvedValueOnce(null)                                      // pinWelcomeWidget — space dashboard absent → insert
        .mockResolvedValueOnce(null)                                      // existing welcome widget → none
        .mockResolvedValueOnce({ id: 77630, name: 'PES (@tor)' });        // Tor lookup
      const trxRun = vi.fn(async () => ({ lastInsertRowid: ++runCount }));
      mockWithTransactionAsync.mockImplementationOnce(async (cb) =>
        cb({ get: trxGet, run: trxRun, all: vi.fn() })
      );

      const r = await applyStarterPack(42, 'Test User');

      expect(r.success).toBe(true);
      expect(r.tableIds).toHaveLength(6);
      expect(r.spaceId).toBe(100);
      expect(r.projectId).toBe(200);
      expect(mockWithTransactionAsync).toHaveBeenCalledTimes(1);

      // renameToHome should have run UPDATE projects twice
      // (settings flag + name rename when source is "My Tasks").
      const updateProjects = trxRun.mock.calls.filter(([sql]) =>
        /UPDATE\s+projects/i.test(sql)
      );
      expect(updateProjects.length).toBeGreaterThanOrEqual(2);
      // First call must flip is_starter_home in settings JSON.
      expect(updateProjects[0][0]).toMatch(/jsonb_set\([\s\S]*is_starter_home/i);

      // Welcome widget INSERT must carry starter_tables_map (all 6 expected slugs).
      // Per-table widget INSERTs come first in the call sequence; pick the
      // welcome-specific one by matching its config payload, not just the SQL.
      const widgetInsert = trxRun.mock.calls.find(
        ([sql, params]) =>
          /INSERT INTO widgets/i.test(sql) &&
          params.some((p) => typeof p === 'string' && p.includes('starter_tables_map'))
      );
      expect(widgetInsert, 'expected the welcome-widget INSERT to be issued').toBeDefined();
      const widgetConfigJson = widgetInsert[1].find(
        (p) => typeof p === 'string' && p.includes('starter_tables_map')
      );
      expect(widgetConfigJson, 'widget config must serialize starter_tables_map').toBeDefined();
      const parsed = JSON.parse(widgetConfigJson);
      expect(Object.keys(parsed.starter_tables_map).sort()).toEqual(
        ['daily-log', 'goals-and-projects', 'habits', 'ideas', 'people', 'wishlist']
      );
      // Every map entry must point at a numeric table id.
      for (const id of Object.values(parsed.starter_tables_map)) {
        expect(typeof id).toBe('number');
      }
    });
  });

  describe('applyPromoUnlock', () => {
    it('does nothing when no promo code', async () => {
      await expect(applyPromoUnlock(42, null)).resolves.toEqual([]);
      expect(mockDbRun).not.toHaveBeenCalled();
    });

    it('does nothing for unknown promo code', async () => {
      await expect(applyPromoUnlock(42, 'RANDOMCODE')).resolves.toEqual([]);
      expect(mockDbRun).not.toHaveBeenCalled();
    });

    it('unlocks Tier-B for MASTERMIND', async () => {
      mockDbRun.mockResolvedValueOnce({ rowCount: 1 });
      const r = await applyPromoUnlock(42, 'MASTERMIND');
      expect(r).toEqual(TIER_B_AGENT_SLUGS);
      expect(mockDbRun).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDbRun.mock.calls[0];
      expect(sql).toMatch(/UPDATE users\s+SET agent_config = jsonb_set/i);
      expect(params).toEqual([TIER_B_AGENT_SLUGS, 42]);
    });

    it('unlocks Tier-B for MESHOK (case-insensitive)', async () => {
      mockDbRun.mockResolvedValueOnce({ rowCount: 1 });
      const r = await applyPromoUnlock(42, 'meshok');
      expect(r).toEqual(TIER_B_AGENT_SLUGS);
      expect(mockDbRun).toHaveBeenCalledTimes(1);
    });

    it('returns [] when DB write fails (best-effort)', async () => {
      mockDbRun.mockRejectedValueOnce(new Error('boom'));
      await expect(applyPromoUnlock(42, 'MASTERMIND')).resolves.toEqual([]);
    });
  });
});
