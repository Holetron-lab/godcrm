// ADR-0011 · Phase E · tighten-only override validator (C-8).
//
// Per ADR-0011 §Consumers → ADR-0003:
//   Document-level override (`verification_settings` atom) may tighten a
//   column's effective config but MAY NOT loosen any value set by the
//   column itself. Loosening = reject.
//
// Tightening rules (explicitly called out by C-8 + ADR-0003 §override):
//   - `cooldown_seconds`    may only RAISE (override ≥ base)
//   - `required_methods`    may only RAISE (override ≥ base, capped at
//                           length(available_methods) of the override itself)
//   - `guards`              must be a SUPERSET of base (no guard removal)
//
// Inferred tightening rules (same spirit — all loosening forbidden):
//   - `available_methods`   must be a SUBSET of base (removing options with
//                           the same `required_methods` makes verify strictly
//                           harder; adding new options is loosening)
//   - `ttl_seconds`         may only SHORTEN. null means "no expiry". So:
//                             base=null → override may set any positive TTL (tighten)
//                             base=N    → override may set M where M <= N
//                             override=null with base=N → REJECT (loosen)
//   - `rate_limit`          tightening = FEWER attempts in a given wall-clock
//                           span. Reject if override raises max_attempts or
//                           shrinks window_seconds. (Removing rate_limit when
//                           base has one = loosen → reject.)
//
// Not policed here (free to override / add):
//   - `locks_on_statuses`, `unlocks_on_statuses` — per-document workflow
//     controls, not a tightening axis.
//   - `policy` — a transition from `any_n` → `all` strictly tightens, but
//     `all` → `any_n` strictly loosens. Reject the latter.
//   - Extra fields not in ADR-0011 (`required_reviewer_ids`,
//     `screenshot_atom`, `diff_hash_match` from ADR-0003) — pass through
//     unchanged; they add constraints and are tightening by construction.
//
// Input: both `base` and `override` must already be normalized through
// validateVerificationConfig (so cooldown_ms/cooldown_seconds etc. are
// canonical). The `override` config is partial — any field omitted means
// "inherit base".

const TIGHTEN_ONLY_POLICIES = { all: 2, any_n: 1 };

/**
 * @param {object} base      Normalized column config (validateVerificationConfig output)
 * @param {object} override  Partial override atom payload (may be unnormalized)
 * @returns {{ ok: true, effective: object } | { ok: false, error: string, field?: string }}
 */
export function validateVerificationOverride(base, override) {
  if (!base || typeof base !== 'object') {
    return { ok: false, error: 'base config is required' };
  }
  if (override === null || override === undefined) {
    return { ok: true, effective: { ...base } };
  }
  if (typeof override !== 'object' || Array.isArray(override)) {
    return { ok: false, error: 'override must be an object' };
  }

  const effective = { ...base };

  // ---------- cooldown_seconds — may only RAISE ----------
  const overrideCooldown = readNumber(override, ['cooldown_seconds', 'cooldown_ms']);
  if (overrideCooldown.present) {
    const nextSec = overrideCooldown.key === 'cooldown_ms'
      ? Math.round(overrideCooldown.value / 1000)
      : overrideCooldown.value;
    if (nextSec < base.cooldown_seconds) {
      return {
        ok: false,
        field: 'cooldown_seconds',
        error: `override cooldown_seconds (${nextSec}) must be >= base (${base.cooldown_seconds})`,
      };
    }
    effective.cooldown_seconds = nextSec;
    effective.cooldown_ms = nextSec * 1000;
  }

  // ---------- available_methods — must be SUBSET of base ----------
  if (Array.isArray(override.available_methods)) {
    if (override.available_methods.length === 0) {
      return { ok: false, field: 'available_methods', error: 'override.available_methods must not be empty' };
    }
    const baseSet = new Set(base.available_methods || []);
    for (const m of override.available_methods) {
      if (!baseSet.has(m)) {
        return {
          ok: false,
          field: 'available_methods',
          error: `override.available_methods adds '${m}' which is not in base — only subsets allowed`,
        };
      }
    }
    effective.available_methods = Array.from(new Set(override.available_methods));
  }

  // ---------- required_methods — may only RAISE ----------
  if (override.required_methods !== undefined && override.required_methods !== null) {
    if (typeof override.required_methods !== 'number' || !Number.isInteger(override.required_methods)) {
      return { ok: false, field: 'required_methods', error: 'required_methods must be an integer' };
    }
    if (override.required_methods < base.required_methods) {
      return {
        ok: false,
        field: 'required_methods',
        error: `override required_methods (${override.required_methods}) must be >= base (${base.required_methods})`,
      };
    }
    if (override.required_methods > effective.available_methods.length) {
      return {
        ok: false,
        field: 'required_methods',
        error: `override required_methods (${override.required_methods}) exceeds available_methods length (${effective.available_methods.length})`,
      };
    }
    effective.required_methods = override.required_methods;
  } else if (effective.required_methods > effective.available_methods.length) {
    // Base required_methods carries over but available_methods shrank → infeasible.
    return {
      ok: false,
      field: 'required_methods',
      error: `override shrinks available_methods below base required_methods (${base.required_methods}) — raise required_methods or expand available_methods`,
    };
  }

  // ---------- guards — must be SUPERSET of base ----------
  if (Array.isArray(override.guards)) {
    const overrideSet = new Set(override.guards);
    for (const g of base.guards || []) {
      if (!overrideSet.has(g)) {
        return {
          ok: false,
          field: 'guards',
          error: `override.guards drops base guard '${g}' — guards may only be added, not removed`,
        };
      }
    }
    effective.guards = Array.from(new Set(override.guards));
  }

  // ---------- ttl_seconds — may only SHORTEN (null = looser than any finite) ----------
  if ('ttl_seconds' in override || 'ttl_ms' in override) {
    let nextTtl;
    if ('ttl_seconds' in override) {
      nextTtl = override.ttl_seconds;
    } else {
      nextTtl = override.ttl_ms == null ? null : override.ttl_ms / 1000;
    }
    if (nextTtl !== null && (typeof nextTtl !== 'number' || !Number.isFinite(nextTtl) || nextTtl <= 0)) {
      return { ok: false, field: 'ttl_seconds', error: 'ttl_seconds must be a positive number or null' };
    }
    if (nextTtl === null && base.ttl_seconds !== null && base.ttl_seconds !== undefined) {
      return { ok: false, field: 'ttl_seconds', error: 'override cannot clear ttl_seconds once base sets it' };
    }
    if (nextTtl !== null && base.ttl_seconds != null && nextTtl > base.ttl_seconds) {
      return {
        ok: false,
        field: 'ttl_seconds',
        error: `override ttl_seconds (${nextTtl}) must be <= base (${base.ttl_seconds})`,
      };
    }
    effective.ttl_seconds = nextTtl;
    effective.ttl_ms = nextTtl == null ? null : nextTtl * 1000;
  }

  // ---------- rate_limit — fewer attempts per longer window is tighter ----------
  if ('rate_limit' in override) {
    const rl = override.rate_limit;
    if (rl === null) {
      if (base.rate_limit) {
        return { ok: false, field: 'rate_limit', error: 'override cannot clear rate_limit once base sets it' };
      }
      effective.rate_limit = null;
    } else {
      if (typeof rl !== 'object' || Array.isArray(rl)) {
        return { ok: false, field: 'rate_limit', error: 'rate_limit must be an object { window_seconds, max_attempts } or null' };
      }
      if (typeof rl.window_seconds !== 'number' || rl.window_seconds <= 0) {
        return { ok: false, field: 'rate_limit', error: 'rate_limit.window_seconds must be a positive number' };
      }
      if (typeof rl.max_attempts !== 'number' || !Number.isInteger(rl.max_attempts) || rl.max_attempts <= 0) {
        return { ok: false, field: 'rate_limit', error: 'rate_limit.max_attempts must be a positive integer' };
      }
      if (base.rate_limit) {
        if (rl.max_attempts > base.rate_limit.max_attempts) {
          return {
            ok: false,
            field: 'rate_limit.max_attempts',
            error: `override rate_limit.max_attempts (${rl.max_attempts}) must be <= base (${base.rate_limit.max_attempts})`,
          };
        }
        if (rl.window_seconds < base.rate_limit.window_seconds) {
          return {
            ok: false,
            field: 'rate_limit.window_seconds',
            error: `override rate_limit.window_seconds (${rl.window_seconds}) must be >= base (${base.rate_limit.window_seconds}) — shorter window = more bursts allowed`,
          };
        }
      }
      effective.rate_limit = { window_seconds: rl.window_seconds, max_attempts: rl.max_attempts };
    }
  }

  // ---------- policy — 'all' > 'any_n' ----------
  if (override.policy !== undefined && override.policy !== null) {
    const baseRank = TIGHTEN_ONLY_POLICIES[base.policy];
    const overrideRank = TIGHTEN_ONLY_POLICIES[override.policy];
    if (overrideRank === undefined) {
      return { ok: false, field: 'policy', error: `policy must be 'all' or 'any_n'` };
    }
    if (baseRank !== undefined && overrideRank < baseRank) {
      return {
        ok: false,
        field: 'policy',
        error: `override policy '${override.policy}' is looser than base '${base.policy}'`,
      };
    }
    effective.policy = override.policy;
  }

  // ---------- pass-through (ADR-0003 additions, lock statuses, method_config) ----------
  for (const k of ['locks_on_statuses', 'unlocks_on_statuses']) {
    if (Array.isArray(override[k])) effective[k] = [...override[k]];
  }
  if (override.method_config && typeof override.method_config === 'object' && !Array.isArray(override.method_config)) {
    effective.method_config = { ...(base.method_config || {}), ...override.method_config };
  }
  for (const k of ['required_reviewer_ids', 'screenshot_atom', 'diff_hash_match']) {
    if (k in override) effective[k] = override[k];
  }

  return { ok: true, effective };
}

function readNumber(obj, keys) {
  for (const key of keys) {
    if (obj[key] === undefined || obj[key] === null) continue;
    if (typeof obj[key] === 'number' && Number.isFinite(obj[key])) {
      return { present: true, key, value: obj[key] };
    }
  }
  return { present: false };
}
