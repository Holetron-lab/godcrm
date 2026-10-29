// ADR-151 — buildOrderClause shared helper.
//
// Pin both modes; the guarded expression must survive connection.js bind
// conversion. Real SQL and pagination coverage lives in row-list-sorting.test.js.

process.env.TEST_MODE = 'true';

import { describe, test, expect } from 'vitest';
import { buildOrderClause } from '../services/orderClause.js';

describe('buildOrderClause: generic list path (guarded)', () => {
  test('uses a numeric guard safe for connection.js placeholder conversion', () => {
    // No '?' inside the SQL regex: the adapter treats it as a bind marker.
    expect(buildOrderClause('order', { mode: 'guarded', tieBreak: 'created_at DESC' }))
      .toBe(
        "(CASE WHEN data::jsonb->>'order' ~ '^-{0,1}[0-9]+([.][0-9]+){0,1}$' " +
        "THEN (data::jsonb->>'order')::numeric END) ASC NULLS LAST, created_at DESC"
      );
  });

  test('guarded is the default mode', () => {
    expect(buildOrderClause('order')).toBe(
      "(CASE WHEN data::jsonb->>'order' ~ '^-{0,1}[0-9]+([.][0-9]+){0,1}$' " +
      "THEN (data::jsonb->>'order')::numeric END) ASC NULLS LAST, created_at DESC"
    );
  });
});

describe('buildOrderClause: legacy doc-content path (coalesce)', () => {
  test('pg form is byte-for-byte the canonical doc sort', () => {
    // Was inline in content.js, renderMarkdown.js, public.js x2.
    expect(buildOrderClause('order', { mode: 'coalesce', tieBreak: 'id' }))
      .toBe("COALESCE((data->>'order')::numeric, 0), id");
  });

  test('sqlite form matches the legacy integer cast', () => {
    expect(buildOrderClause('order', { dialect: 'sqlite', tieBreak: 'id' }))
      .toBe("CAST(json_extract(data, '$.order') AS INTEGER), id");
  });

  test('coalesce:false reproduces the bare doc-tasks cast byte-for-byte', () => {
    // Was inline in tasks.js (ORDER BY (data->>'order')::numeric) — no COALESCE,
    // no tie-break. The pg branch is what runs on every (always-Postgres) host.
    expect(buildOrderClause('order', { mode: 'coalesce', coalesce: false, tieBreak: null }))
      .toBe("(data->>'order')::numeric");
  });
});

describe('buildOrderClause: tie-break handling', () => {
  test('omits the tail when tieBreak is null', () => {
    expect(buildOrderClause('order', { mode: 'coalesce', tieBreak: null }))
      .toBe("COALESCE((data->>'order')::numeric, 0)");
  });
});

describe('buildOrderClause: injection safety', () => {
  test('rejects keys with non-identifier characters', () => {
    expect(() => buildOrderClause("order'; DROP TABLE table_rows;--")).toThrow(/unsafe order key/);
    expect(() => buildOrderClause('data->>x')).toThrow(/unsafe order key/);
    expect(() => buildOrderClause('')).toThrow(/unsafe order key/);
    expect(() => buildOrderClause(null)).toThrow(/unsafe order key/);
  });

  test('accepts plain identifier keys', () => {
    expect(() => buildOrderClause('order_index')).not.toThrow();
    expect(() => buildOrderClause('sortKey2')).not.toThrow();
  });
});
