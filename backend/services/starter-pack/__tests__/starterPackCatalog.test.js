// ADR-0079 P0 — Catalog integrity tests.
// Pure unit tests: no DB. Verifies the catalog matches ADR §1 / §2 contracts.

import { describe, test, expect } from 'vitest';
import {
  STARTER_TABLES,
  TIER_A_AGENT_SLUGS,
  TIER_B_AGENT_SLUGS,
  TIER_B_UNLOCK_PROMOS,
  WELCOME_WIDGET_PRESET,
  STARTER_PROJECT_NAME,
  FEATURE_FLAG_KEY,
  buildStarterTableSeeds
} from '../starterPackCatalog.js';

describe('ADR-0079 catalog integrity', () => {
  test('§1 — exactly 6 starter tables', () => {
    expect(STARTER_TABLES).toHaveLength(6);
  });

  test('§1 — emoji-prefixed table names (screenshot-worthy)', () => {
    const expectedNames = [
      '📔 Daily Log',
      '🎯 Goals & Projects',
      '🔁 Habits',
      '👥 People',
      '💡 Ideas',
      '📚 Wishlist'
    ];
    expect(STARTER_TABLES.map(t => t.name)).toEqual(expectedNames);
  });

  test('§1 — slugs match frontend starter-pack-copy.json table_slug values', () => {
    const expectedSlugs = ['daily-log', 'goals-and-projects', 'habits', 'people', 'ideas', 'wishlist'];
    expect(STARTER_TABLES.map(t => t.slug)).toEqual(expectedSlugs);
  });

  test('§1 — each table has ≥1 required column', () => {
    for (const t of STARTER_TABLES) {
      const required = t.columns.filter(c => c.is_required);
      expect(required.length, `${t.name} needs ≥1 required column`).toBeGreaterThanOrEqual(1);
    }
  });

  test('§1 — column types respect ADR-0041 canonical taxonomy', () => {
    const allowed = new Set([
      'text', 'textarea', 'number', 'select', 'multi-select',
      'date', 'datetime', 'url', 'checkbox'
    ]);
    for (const t of STARTER_TABLES) {
      for (const c of t.columns) {
        expect(allowed.has(c.type), `${t.name}.${c.name} type "${c.type}" not in ADR-0041`).toBe(true);
      }
    }
  });

  test('§2.1 — Tier-A: 5 default-visible agents (Tor + Journal + Planner + Researcher + Smith)', () => {
    expect(TIER_A_AGENT_SLUGS).toEqual(['tor', 'journal', 'planner', 'researcher', 'agent-smith']);
  });

  test('§2.2 — Tier-B: 4 locked coding agents', () => {
    expect(TIER_B_AGENT_SLUGS).toEqual(['architect', 'developer-ralph', 'frontend-developer', 'sysadmin']);
  });

  test('§2.2 — Tier-A and Tier-B sets are disjoint', () => {
    const intersection = TIER_A_AGENT_SLUGS.filter(s => TIER_B_AGENT_SLUGS.includes(s));
    expect(intersection).toEqual([]);
  });

  test('§2.2 — Promo unlock list matches ADR-0070 known promos', () => {
    expect(TIER_B_UNLOCK_PROMOS).toEqual(['MASTERMIND', 'MESHOK']);
  });

  test('§3 — Welcome widget preset name is canonical', () => {
    expect(WELCOME_WIDGET_PRESET).toBe('welcome_dashboard');
  });

  test('§4 — Project name is "Home" (ADR §4 sequence step 2)', () => {
    expect(STARTER_PROJECT_NAME).toBe('Home');
  });

  test('Feature flag key matches migration 072', () => {
    expect(FEATURE_FLAG_KEY).toBe('starter_pack_enabled');
  });

  describe('buildStarterTableSeeds — sample-row contract', () => {
    const seeds = buildStarterTableSeeds();

    test('returns 5–10 rows for every starter slug', () => {
      for (const t of STARTER_TABLES) {
        const rows = seeds[t.slug];
        expect(rows, `seed rows missing for slug ${t.slug}`).toBeDefined();
        expect(rows.length, `${t.slug}: expected 5–10 rows, got ${rows.length}`)
          .toBeGreaterThanOrEqual(5);
        expect(rows.length).toBeLessThanOrEqual(10);
      }
    });

    test('every seeded select value exists in the column options', () => {
      for (const t of STARTER_TABLES) {
        const rows = seeds[t.slug];
        for (const col of t.columns) {
          if (col.type !== 'select') continue;
          const allowed = new Set((col.config?.options || []).map((o) => o.value));
          for (const row of rows) {
            const v = row[col.name];
            if (v == null || v === '') continue;
            expect(allowed.has(v), `${t.slug}.${col.name}="${v}" not in catalog options`).toBe(true);
          }
        }
      }
    });

    test('date fields are YYYY-MM-DD; multi-select fields are arrays', () => {
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      for (const t of STARTER_TABLES) {
        const rows = seeds[t.slug];
        for (const col of t.columns) {
          for (const row of rows) {
            const v = row[col.name];
            if (v == null) continue;
            if (col.type === 'date') {
              expect(dateRe.test(v), `${t.slug}.${col.name}="${v}" not YYYY-MM-DD`).toBe(true);
            }
            if (col.type === 'multi-select') {
              expect(Array.isArray(v), `${t.slug}.${col.name} must be an array`).toBe(true);
            }
          }
        }
      }
    });
  });
});
