/**
 * ADR-189 — shared owner-role gate (`requireOwnerRole`) regression.
 *
 * `requireOwnerRole(req, res)` is the portable replacement for the
 * `SELECT … spaces WHERE id = 11` + `owner_id === req.user.id` gate that
 * audit.js, owner.js, agent-permissions.js and admin/chatNotifications.js
 * each carried inline. Those gates 500'd `OWNER_SPACE_MISSING` on any
 * from-empty community box (box 205 / devcrm) where space 11 never exists.
 *
 * DB-less by construction: the helper is a pure function of `req.user.role`
 * and never touches the database — which is the whole point of the fix.
 * Locks the branches that matter:
 *   1. role='owner'      → true, no response written
 *   2. role='admin'      → false + 403 (admin alone is NOT sufficient)
 *   3. unauthenticated   → false + 403
 *   4. regression: owner passes with NO space 11 present — never 500
 *
 * NOTE (ADR-189): the gate admits ANY role='owner' principal — a deliberate,
 * reviewed widening on master A. The `_secrets` vault (secrets.js) stays
 * identity-based and is intentionally NOT converged onto this helper.
 */

import { describe, it, expect, vi } from 'vitest';
import { requireOwnerRole } from '../helpers.js';

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = vi.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((payload) => {
    res.body = payload;
    return res;
  });
  return res;
}

describe('requireOwnerRole (ADR-189 owner-gate convergence)', () => {
  it('admits role=owner and writes no response', () => {
    const res = fakeRes();
    const ok = requireOwnerRole({ user: { id: 1, role: 'owner' } }, res);
    expect(ok).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects role=admin with 403 (admin alone is not sufficient)', () => {
    const res = fakeRes();
    const ok = requireOwnerRole({ user: { id: 2, role: 'admin' } }, res);
    expect(ok).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('rejects an unauthenticated request (no req.user) with 403', () => {
    const res = fakeRes();
    const ok = requireOwnerRole({}, res);
    expect(ok).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('admits the owner when no space 11 exists (from-empty community box) — never 500', () => {
    // The convergence removes the `spaces` read entirely, so a from-empty
    // box with no space 11 can no longer 500 OWNER_SPACE_MISSING.
    const res = fakeRes();
    const ok = requireOwnerRole({ user: { id: 1, role: 'owner' } }, res);
    expect(ok).toBe(true);
    expect(res.statusCode).not.toBe(500);
  });
});
