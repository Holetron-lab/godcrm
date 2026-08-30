// ADR-188 F1 — owner-gate regression tests.
//
// Guards the community-box defect: the original gate looked up `spaces WHERE id=11`
// and 500'd with OWNER_SPACE_MISSING on a from-empty box (dev188 / box 205) where
// that space never exists, so the box owner could never save registration policy.
// The gate now keys on role==='owner' with NO space/DB dependency — these tests
// assert exactly that, and run DB-less (ADR-0009: no combat master touched).
import { describe, it, expect } from 'vitest';
import { requireOwner } from '../registration.js';

// Minimal express-Response double: records the last status()/json() call.
function fakeRes() {
  const rec = { statusCode: null, body: null };
  return {
    rec,
    status(code) { rec.statusCode = code; return this; },
    json(body) { rec.body = body; return this; },
  };
}

describe('ADR-188 F1 — requireOwner gate', () => {
  it('denies unauthenticated callers (403, no DB touched)', async () => {
    const res = fakeRes();
    const ok = await requireOwner({}, res);
    expect(ok).toBe(false);
    expect(res.rec.statusCode).toBe(403);
    expect(res.rec.body.error.code).toBe('FORBIDDEN');
  });

  it('denies a non-owner role (admin is not enough)', async () => {
    const res = fakeRes();
    const ok = await requireOwner({ user: { id: 42, role: 'admin' } }, res);
    expect(ok).toBe(false);
    expect(res.rec.statusCode).toBe(403);
  });

  it('admits role==="owner" with NO space lookup — the from-empty community box', async () => {
    // Only {id, role} present — no space 11, no DB. The original code 500'd here.
    const res = fakeRes();
    const ok = await requireOwner({ user: { id: 1, role: 'owner' } }, res);
    expect(ok).toBe(true);
    expect(res.rec.statusCode).toBeNull();   // gate never wrote an error response
  });
});
