/**
 * agent-loop/pricing.js — ADR-165 WP-2b derived-cost pricing.
 *
 * WP-2a proved there is NO uniform `cost_usd` in the agent loop: native
 * Anthropic/OpenAI branches emit only tokens, CLI branches drop their native
 * cost. So cost is DERIVED here from token usage × per-model price — the one
 * signal already universal at the two native emission points.
 *
 * Prices come from the AI Models table (`input_price`/`output_price`, USD per
 * 1e6 tokens, synced from OpenRouter by ModelSyncService), keyed on the
 * `model_id` string sent to the provider (= `resolved.model`).
 *
 * HARD INVARIANT (owner scope-lock): an unknown/unpriced model yields cost 0,
 * so `cost_limit_usd` never trips for it — NO cap, never a wrong or zero-priced
 * cap. `normalizePrice` and `deriveCostUsd` are pure (DB-free) so the invariant
 * is unit-testable without a database.
 */

import { dbGet, isPostgres } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';

const _PER_MILLION = 1_000_000;

// ── In-memory price cache (SecretsVault form, ADR-0040): 60s TTL per model_id.
// Keeps the loop off the DB — resolution is already once-per-run, this also
// dedupes across concurrent/repeated runs of the same model. Value is the
// normalized price object OR null (an unpriced model is a valid, cached answer).
// ponytail (WP-2c): pg_notify cluster-wide eviction is deferred — a cost cap
// tolerates ≤60s price staleness, and instant eviction would need a new DB
// trigger on the AI Models table. Revisit before flipping cost enforce true.
const _PRICE_CACHE_TTL_MS = 60_000;
const _priceCache = new Map();

/**
 * Coerce a raw (input_price, output_price) pair into a usable price object.
 * Returns null unless BOTH are finite, non-negative numbers — a half-priced
 * model would undercount cost and leak the cap, so it counts as "no price".
 */
export function normalizePrice(inputPrice, outputPrice) {
  // Guard null/undefined BEFORE Number(): Number(null) === 0 would silently turn
  // a missing (JSON-null) price into a $0 component — undercounting cost and
  // leaking the cap. A missing half is "no price", never "free".
  if (inputPrice == null || outputPrice == null) return null;
  const i = Number(inputPrice);
  const o = Number(outputPrice);
  if (!Number.isFinite(i) || !Number.isFinite(o) || i < 0 || o < 0) return null;
  return { inputPrice: i, outputPrice: o };
}

/**
 * Derive USD cost for one step from token usage × per-model price.
 * `price` is the object from normalizePrice/getModelPriceUsd, or null.
 * Returns 0 when `price` is null (unknown model → no cost → no cap).
 */
export function deriveCostUsd(usage, price) {
  if (!price) return 0;
  const prompt = Number(usage?.prompt_tokens) || 0;
  const completion = Number(usage?.completion_tokens) || 0;
  if (prompt < 0 || completion < 0) return 0;
  return (prompt * price.inputPrice + completion * price.outputPrice) / _PER_MILLION;
}

/**
 * Look up per-model prices (USD per 1e6 tokens) from the AI Models table,
 * keyed on the `model_id` string. Returns { inputPrice, outputPrice } or null
 * when the model is unknown/unpriced (→ no cap, per invariant). Never throws —
 * a pricing lookup must not break the run; failure fails open to no-cap.
 */
export async function getModelPriceUsd(modelId) {
  if (!modelId || typeof modelId !== 'string') return null;
  const cached = _priceCache.get(modelId);
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  try {
    const row = await dbGet(
      isPostgres()
        ? `SELECT tr.data FROM table_rows tr
           JOIN universal_tables ut ON tr.table_id = ut.id
           WHERE ut.name LIKE '%Models%' AND tr.data->>'model_id' = $1
           LIMIT 1`
        : `SELECT tr.data FROM table_rows tr
           JOIN universal_tables ut ON tr.table_id = ut.id
           WHERE ut.name LIKE '%Models%' AND json_extract(tr.data, '$.model_id') = ?
           LIMIT 1`,
      [modelId]
    );
    let value = null;
    if (row) {
      let data = {};
      try { data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {}); }
      catch { data = {}; }
      value = normalizePrice(data.input_price, data.output_price);
    }
    // Cache the resolved answer (a null = "unpriced model" is a valid cache hit).
    // Transient DB errors below are NOT cached — they retry on the next run.
    _priceCache.set(modelId, { value, expiresAt: Date.now() + _PRICE_CACHE_TTL_MS });
    return value;
  } catch (err) {
    apiLogger.error({ err: err.message, modelId }, 'ADR-165 getModelPriceUsd failed — failing open to no-cap');
    return null;
  }
}

/** Test-only: clear the price cache so each test starts clean. @internal */
export function __resetPriceCacheForTests() { _priceCache.clear(); }
