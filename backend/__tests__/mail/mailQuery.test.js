// @vitest-environment node
/**
 * ADR-175 P1 — mail facade SQL push-down. Pure unit test (no network/DB) for
 * buildMailQuery: space scoping always present, column whitelist for filter +
 * search (unsafe column names can never reach SQL), ILIKE wildcard escaping,
 * searchColumns intersection, and pagination/limit clamping.
 * Boot guard imported per ADR-0009.
 */

import './../../test/setup.js';
import { describe, it, expect } from 'vitest';
import { buildMailQuery } from '../../services/SystemTableService.js';

describe('buildMailQuery — scoping', () => {
  it('always scopes by space_id as the first predicate', () => {
    const q = buildMailQuery({ spaceId: 11 });
    expect(q.whereSql).toBe('WHERE space_id = ?');
    expect(q.params).toEqual([11]);
  });

  it('defaults pagination to page 1 / limit 50', () => {
    const q = buildMailQuery({ spaceId: 11 });
    expect(q.limit).toBe(50);
    expect(q.offset).toBe(0);
  });
});

describe('buildMailQuery — filter whitelist', () => {
  it('accepts whitelisted columns as parameterized equality', () => {
    const q = buildMailQuery({ spaceId: 11, filter: { folder: 'inbox', is_read: false } });
    expect(q.whereSql).toBe('WHERE space_id = ? AND folder = ? AND is_read = ?');
    expect(q.params).toEqual([11, 'inbox', false]);
  });

  it('silently drops non-whitelisted column names (no SQL injection surface)', () => {
    const q = buildMailQuery({ spaceId: 11, filter: { 'body_text; DROP TABLE mail_messages': 'x', ticket_id: 7 } });
    // only the whitelisted ticket_id survives; the malicious key is gone
    expect(q.whereSql).toBe('WHERE space_id = ? AND ticket_id = ?');
    expect(q.params).toEqual([11, 7]);
  });
});

describe('buildMailQuery — search', () => {
  it('searches the full text whitelist with ILIKE by default', () => {
    const q = buildMailQuery({ spaceId: 11, search: 'invoice' });
    expect(q.whereSql).toContain("from_name ILIKE ? ESCAPE '\\'");
    expect(q.whereSql).toContain("from_address ILIKE ? ESCAPE '\\'");
    expect(q.whereSql).toContain("subject ILIKE ? ESCAPE '\\'");
    expect(q.whereSql).toContain("preview ILIKE ? ESCAPE '\\'");
    // space_id param + one bound value per searched column
    expect(q.params).toEqual([11, '%invoice%', '%invoice%', '%invoice%', '%invoice%']);
  });

  it('escapes ILIKE wildcards so a literal % / _ is not treated as a wildcard', () => {
    const q = buildMailQuery({ spaceId: 11, search: '50%_x', searchColumns: 'subject' });
    expect(q.whereSql).toBe("WHERE space_id = ? AND (subject ILIKE ? ESCAPE '\\')");
    expect(q.params).toEqual([11, '%50\\%\\_x%']);
  });

  it('intersects searchColumns with the whitelist (drops unknown columns)', () => {
    const q = buildMailQuery({ spaceId: 11, search: 'x', searchColumns: 'subject,body_text,evil' });
    expect(q.whereSql).toBe("WHERE space_id = ? AND (subject ILIKE ? ESCAPE '\\')");
    expect(q.params).toEqual([11, '%x%']);
  });

  it('ignores empty search', () => {
    const q = buildMailQuery({ spaceId: 11, search: '' });
    expect(q.whereSql).toBe('WHERE space_id = ?');
    expect(q.params).toEqual([11]);
  });
});

describe('buildMailQuery — pagination clamping', () => {
  it('computes offset from page/limit', () => {
    const q = buildMailQuery({ spaceId: 11, page: 3, limit: 25 });
    expect(q.limit).toBe(25);
    expect(q.offset).toBe(50);
  });

  it('clamps limit to [1, 1000] and page to >= 1', () => {
    expect(buildMailQuery({ spaceId: 11, limit: 99999 }).limit).toBe(1000);
    expect(buildMailQuery({ spaceId: 11, limit: 0 }).limit).toBe(50);
    expect(buildMailQuery({ spaceId: 11, page: 0 }).offset).toBe(0);
    expect(buildMailQuery({ spaceId: 11, page: -5 }).offset).toBe(0);
  });
});

describe('buildMailQuery — combined', () => {
  it('composes filter + search + pagination with params in WHERE order', () => {
    const q = buildMailQuery({
      spaceId: 11, filter: { folder: 'inbox' }, search: 'q3', searchColumns: 'subject', page: 2, limit: 10
    });
    expect(q.whereSql).toBe("WHERE space_id = ? AND folder = ? AND (subject ILIKE ? ESCAPE '\\')");
    expect(q.params).toEqual([11, 'inbox', '%q3%']);
    expect(q.limit).toBe(10);
    expect(q.offset).toBe(10);
  });
});

// ADR-175 P1 §drift-guard — on a copied DB missing migs 079/080 the optional
// columns (starred / linked_*) don't exist; a filter on one must be DROPPED, not
// emitted into SQL, or `WHERE starred = ?` 500s. availableColumns carries the set
// present on this DB; when null (prior callers/tests) every whitelisted column is
// assumed present.
describe('buildMailQuery — drift-guard (availableColumns)', () => {
  it('drops a filter on an optional column absent from this DB', () => {
    const present = new Set(['folder', 'is_read', 'from_address']); // no starred/linked_*
    const q = buildMailQuery({
      spaceId: 11, filter: { folder: 'inbox', starred: true }, availableColumns: present
    });
    expect(q.whereSql).toBe('WHERE space_id = ? AND folder = ?');
    expect(q.params).toEqual([11, 'inbox']);
  });

  it('keeps a filter on an optional column when it IS present', () => {
    const present = new Set(['folder', 'starred']);
    const q = buildMailQuery({
      spaceId: 11, filter: { folder: 'inbox', starred: true }, availableColumns: present
    });
    expect(q.whereSql).toBe('WHERE space_id = ? AND folder = ? AND starred = ?');
    expect(q.params).toEqual([11, 'inbox', true]);
  });

  it('null availableColumns preserves prior behaviour (all whitelisted assumed present)', () => {
    const q = buildMailQuery({ spaceId: 11, filter: { starred: true } });
    expect(q.whereSql).toBe('WHERE space_id = ? AND starred = ?');
    expect(q.params).toEqual([11, true]);
  });
});
