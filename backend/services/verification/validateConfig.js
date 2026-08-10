// ADR-0011 · Verification column — config validator (C-1).
//
// Canonical ADR-0011 config shape (preferred):
//   {
//     available_methods: string[],     // subset of VALID_METHODS — required
//     required_methods:  number,       // N-of-M, 1..|available_methods|
//     cooldown_seconds?: number,       // default 300 — per ADR §Config
//     ttl_seconds?:      number,       // optional, null = no TTL
//     locks_on_statuses?:   string[],
//     unlocks_on_statuses?: string[],
//     guards?: string[],
//     policy?: 'all' | 'any_n',        // default 'any_n'
//     rate_limit?: { window_seconds: number, max_attempts: number },
//     method_config?: object
//   }
//
// Phase A legacy shape (back-compat):
//   {
//     method: 'totp'|'captcha'|'sms'|'email',
//     cooldown_ms?: number,
//     ttl_ms?: number,
//     ...
//   }
// Coerced to canonical as available_methods=[method], required_methods=1.
//
// The validator also normalizes legacy `cooldown_ms`/`ttl_ms` into canonical
// `cooldown_seconds`/`ttl_seconds`. Both are kept on the normalized output
// (`cooldown_ms` derived from `cooldown_seconds`) so downstream code can read
// whichever field it was already using.

const VALID_METHODS = ['totp', 'captcha', 'sms', 'email'];
const VALID_POLICIES = ['all', 'any_n'];
const DEFAULT_COOLDOWN_SECONDS = 300;

/**
 * @param {object} config
 * @returns {{ ok: true, normalized: object } | { ok: false, error: string }}
 */
export function validateVerificationConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { ok: false, error: 'config must be an object' };
  }

  // ---------- available_methods / required_methods (N-of-M) ----------
  let available = config.available_methods;
  let required = config.required_methods;

  if (!Array.isArray(available)) {
    // Legacy: accept single `method`.
    if (typeof config.method === 'string') {
      if (!VALID_METHODS.includes(config.method)) {
        return { ok: false, error: `method must be one of: ${VALID_METHODS.join(', ')}` };
      }
      available = [config.method];
      required = required === undefined || required === null ? 1 : required;
    } else {
      return { ok: false, error: `available_methods (array) is required — one or more of: ${VALID_METHODS.join(', ')}` };
    }
  } else {
    if (available.length === 0) {
      return { ok: false, error: 'available_methods must be a non-empty array' };
    }
    for (const m of available) {
      if (typeof m !== 'string' || !VALID_METHODS.includes(m)) {
        return { ok: false, error: `available_methods entries must be one of: ${VALID_METHODS.join(', ')}` };
      }
    }
  }

  // dedupe while preserving order
  available = Array.from(new Set(available));

  // required_methods default = 1
  if (required === undefined || required === null) required = 1;
  if (typeof required !== 'number' || !Number.isInteger(required)) {
    return { ok: false, error: 'required_methods must be an integer' };
  }
  if (required < 1) {
    return { ok: false, error: 'required_methods must be >= 1' };
  }
  if (required > available.length) {
    return { ok: false, error: `required_methods (${required}) cannot exceed available_methods length (${available.length})` };
  }

  // ---------- cooldown ----------
  let cooldownSeconds = DEFAULT_COOLDOWN_SECONDS;
  if (config.cooldown_seconds !== undefined && config.cooldown_seconds !== null) {
    if (typeof config.cooldown_seconds !== 'number' || config.cooldown_seconds < 0 || !Number.isFinite(config.cooldown_seconds)) {
      return { ok: false, error: 'cooldown_seconds must be a non-negative finite number' };
    }
    cooldownSeconds = config.cooldown_seconds;
  } else if (config.cooldown_ms !== undefined && config.cooldown_ms !== null) {
    // Phase A legacy field
    if (typeof config.cooldown_ms !== 'number' || config.cooldown_ms < 0 || !Number.isFinite(config.cooldown_ms)) {
      return { ok: false, error: 'cooldown_ms must be a non-negative finite number' };
    }
    cooldownSeconds = Math.round(config.cooldown_ms / 1000);
  }

  // ---------- ttl ----------
  let ttlSeconds = null;
  if (config.ttl_seconds !== undefined && config.ttl_seconds !== null) {
    if (typeof config.ttl_seconds !== 'number' || config.ttl_seconds <= 0 || !Number.isFinite(config.ttl_seconds)) {
      return { ok: false, error: 'ttl_seconds must be a positive finite number' };
    }
    ttlSeconds = config.ttl_seconds;
  } else if (config.ttl_ms !== undefined && config.ttl_ms !== null) {
    if (typeof config.ttl_ms !== 'number' || config.ttl_ms <= 0 || !Number.isFinite(config.ttl_ms)) {
      return { ok: false, error: 'ttl_ms must be a positive finite number' };
    }
    ttlSeconds = config.ttl_ms / 1000;
  }

  // ---------- locks / unlocks / guards ----------
  const locks = validateStringArray(config.locks_on_statuses, 'locks_on_statuses');
  if (locks.error) return locks;
  const unlocks = validateStringArray(config.unlocks_on_statuses, 'unlocks_on_statuses');
  if (unlocks.error) return unlocks;
  const guards = validateStringArray(config.guards, 'guards', /* allowEmpty= */ false);
  if (guards.error) return guards;

  // ---------- policy ----------
  let policy = 'any_n';
  if (config.policy !== undefined && config.policy !== null) {
    if (!VALID_POLICIES.includes(config.policy)) {
      return { ok: false, error: `policy must be one of: ${VALID_POLICIES.join(', ')}` };
    }
    policy = config.policy;
  }

  // ---------- rate_limit ----------
  let rateLimit = null;
  if (config.rate_limit !== undefined && config.rate_limit !== null) {
    const rl = config.rate_limit;
    if (typeof rl !== 'object' || Array.isArray(rl)) {
      return { ok: false, error: 'rate_limit must be an object { window_seconds, max_attempts }' };
    }
    if (typeof rl.window_seconds !== 'number' || rl.window_seconds <= 0) {
      return { ok: false, error: 'rate_limit.window_seconds must be a positive number' };
    }
    if (typeof rl.max_attempts !== 'number' || !Number.isInteger(rl.max_attempts) || rl.max_attempts <= 0) {
      return { ok: false, error: 'rate_limit.max_attempts must be a positive integer' };
    }
    rateLimit = { window_seconds: rl.window_seconds, max_attempts: rl.max_attempts };
  }

  // ---------- method_config ----------
  let methodConfig = {};
  if (config.method_config !== undefined && config.method_config !== null) {
    if (typeof config.method_config !== 'object' || Array.isArray(config.method_config)) {
      return { ok: false, error: 'method_config must be an object' };
    }
    methodConfig = config.method_config;
  }

  return {
    ok: true,
    normalized: {
      available_methods: available,
      required_methods: required,
      // legacy mirror for callers that read `method` (first available)
      method: available[0],
      cooldown_seconds: cooldownSeconds,
      cooldown_ms: cooldownSeconds * 1000,
      ttl_seconds: ttlSeconds,
      ttl_ms: ttlSeconds == null ? null : ttlSeconds * 1000,
      locks_on_statuses: locks.value,
      unlocks_on_statuses: unlocks.value,
      guards: guards.value,
      policy,
      rate_limit: rateLimit,
      method_config: methodConfig,
    },
  };
}

function validateStringArray(raw, name, allowEmpty = true) {
  if (raw === undefined || raw === null) return { value: [] };
  if (!Array.isArray(raw)) {
    return { error: `${name} must be an array of strings`, ok: false };
  }
  for (const s of raw) {
    if (typeof s !== 'string') {
      return { error: `${name} entries must be strings`, ok: false };
    }
    if (!allowEmpty && s.length === 0) {
      return { error: `${name} entries must be non-empty strings`, ok: false };
    }
  }
  return { value: raw };
}

export { VALID_METHODS, VALID_POLICIES, DEFAULT_COOLDOWN_SECONDS };
