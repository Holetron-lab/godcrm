// ============================================================
// PES Core — Shared Utilities
// ============================================================
// Common helpers used across multiple modules.
// Eliminates duplication of clamp, weightedRandom, etc.
// ============================================================

/**
 * Clamp value between min and max.
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

/**
 * Pick a random element from array.
 * @param {Array} arr
 * @returns {*}
 */
function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Weighted random selection.
 * @param {Array<{ item: *, weight: number }>} items
 * @returns {*}
 */
function weightedRandom(items) {
  if (!items || items.length === 0) return null;
  const total = items.reduce((s, i) => s + (i.weight || 0), 0);
  if (total <= 0) return items[0]?.item || null;
  let r = Math.random() * total;
  for (const { item, weight } of items) {
    r -= weight || 0;
    if (r <= 0) return item;
  }
  return items[items.length - 1].item;
}

/**
 * Generate a short unique ID.
 * @param {string} [prefix]
 * @returns {string}
 */
function uid(prefix = '') {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return prefix ? `${prefix}_${ts}_${rnd}` : `${ts}_${rnd}`;
}

/**
 * Format timestamp to ISO string.
 * @param {number} [ms] — epoch ms (default: now)
 * @returns {string}
 */
function isoNow(ms) {
  return new Date(ms || Date.now()).toISOString();
}

/**
 * Deep-clone a plain object (JSON-safe only).
 * @param {Object} obj
 * @returns {Object}
 */
function deepClone(obj) {
  if (!obj) return obj;
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Sleep for ms. Useful for delays (typing...).
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { clamp, pickRandom, weightedRandom, uid, isoNow, deepClone, sleep };
