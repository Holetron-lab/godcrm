/**
 * DCD Fast Guardrail (ADR-157) — pre-generation relevance check.
 *
 * DCD's second policy: before spending an expensive generation on retrieved
 * context, run a CHEAP early check on the retrieved head — does anything we
 * pulled back actually support the query? If not, say "no grounding found"
 * instead of letting the model hallucinate over irrelevant context. Most
 * valuable on the public MCP surface, where hallucination is costliest and
 * least supervised.
 *
 * IMPLEMENTATION NOTE (Ponytail / ADR-157): the ADR allows "a cheap model
 * (Haiku) OR a rule-of-thumb threshold". This is the rule-of-thumb: lexical
 * overlap between the query's content terms and the retrieved head. It ships
 * the guardrail in SHADOW mode (the caller logs the verdict, never blocks) with
 * zero new dependency and full offline testability. A Haiku-backed check is a
 * drop-in replacement behind this same signature once shadow telemetry proves
 * the threshold.
 */

// ADAPTIVE HEAD (ADR-157 amendment — adaptive-head replaces fixed-window).
// Instead of a magic 150-token window, the data decides how much to read.
// Lexical overlap is MONOTONIC: reading more head tokens can only ADD matches,
// never remove them. So we can stop as soon as the threshold is met (a relevant
// hit settles cheap) and only declare "not grounded" once we have read the whole
// context (or the MAX safety cap) — otherwise we'd hide support that lives past
// the window. HEAD_START is the first probe; the window doubles until it accepts
// or is exhausted. This is the rule-of-thumb stand-in for the Haiku "needMore"
// loop: same early-stop behaviour, zero latency / key.
const HEAD_START = 40;
const HEAD_MAX = 600;

// Fraction of the query's content terms that must appear in the retrieved head
// for the context to count as grounded. Deliberately low — the guardrail catches
// the "totally unrelated context" case, not fine-grained relevance ranking.
export const GROUNDING_THRESHOLD = 0.3;

const WORD = /[a-z0-9]+/g;

// Tiny stop list — words that carry no topical signal and would inflate overlap.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for',
  'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'how', 'what',
  'why', 'when', 'where', 'who', 'which', 'with', 'about', 'this', 'that',
  'it', 'as', 'by', 'from', 'i', 'you', 'we', 'they', 'me', 'my', 'our',
]);

function contentTerms(text) {
  const all = String(text || '').toLowerCase().match(WORD) || [];
  return all.filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/**
 * Assess whether retrieved memories support the query.
 *
 * @param {string} query
 * @param {Array<{text?: string}>} memories - recall results (only the head is read)
 * @returns {{ grounded: boolean, score: number, inspectedTokens: number, totalTokens: number, reason: string }}
 *   `score` is the fraction of query content-terms found in the inspected head.
 *   `inspectedTokens` / `totalTokens` are the adaptive-head telemetry: how much
 *   of the context we actually had to read to reach the verdict, out of how much
 *   was available. In shadow mode the caller LOGS this and returns results
 *   unchanged; these numbers are what later justify where to set the threshold.
 */
export function assessGrounding(query, memories) {
  const queryTerms = new Set(contentTerms(query));
  const list = Array.isArray(memories) ? memories : [];

  if (list.length === 0) {
    return { grounded: false, score: 0, inspectedTokens: 0, totalTokens: 0, reason: 'no retrieved context' };
  }

  const tokens = list.map((m) => m?.text || '').join(' ').toLowerCase().match(WORD) || [];
  const totalTokens = tokens.length;

  if (queryTerms.size === 0) {
    // Nothing topical to check against → do not flag (cannot assess).
    return { grounded: true, score: 1, inspectedTokens: 0, totalTokens, reason: 'query has no content terms — not assessable' };
  }

  // Adaptive head: probe a small window, accept early on the first threshold hit
  // (overlap only grows with W), otherwise double until the context is exhausted
  // or the MAX cap is reached — only then is a "no grounding" verdict honest.
  let window = Math.min(HEAD_START, totalTokens);
  let hits = 0;
  let inspectedTokens = 0;
  let grounded = false;
  for (;;) {
    const headSet = new Set(tokens.slice(0, window));
    hits = 0;
    for (const term of queryTerms) if (headSet.has(term)) hits += 1;
    inspectedTokens = Math.min(window, totalTokens);
    if (hits / queryTerms.size >= GROUNDING_THRESHOLD) {
      grounded = true;
      break;
    }
    if (window >= totalTokens || window >= HEAD_MAX) break; // exhausted — honest reject
    window = Math.min(window * 2, HEAD_MAX, totalTokens); // never overshoot the cap

  }

  const score = hits / queryTerms.size;

  return {
    grounded,
    score: Number(score.toFixed(3)),
    inspectedTokens,
    totalTokens,
    reason: grounded
      ? `${hits}/${queryTerms.size} query terms supported within first ${inspectedTokens} tokens`
      : `only ${hits}/${queryTerms.size} query terms supported after inspecting ${inspectedTokens}/${totalTokens} tokens — no grounding`,
  };
}
