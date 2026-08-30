/**
 * DCD Scope Router (ADR-157) — the "narrow scope BEFORE retrieval" step.
 *
 * DCD (Domain → Collection → Document) is a retrieval *policy*, not a storage
 * model — our liquid substrate (ADR-156) already provides the hierarchy
 * physically (Space → Widget/Table/`room` → Row). This module is the explicit
 * router that picks the Collection-level scope for a memory query, so retrieval
 * is constrained before the semantic search instead of filtered after.
 *
 * For Hindsight `memory_recall`, the Collection step IS the `room` filter — the
 * one that already buys +34% precision when applied before search. So the
 * router's whole job here is: query → `room` (or "widen": no room).
 *
 * IMPLEMENTATION NOTE (Ponytail / ADR-157): this is a deterministic lexical
 * router, mirroring `CommandClassifier`. The ADR explicitly allows "a cheap
 * model (Haiku) OR a rule-of-thumb threshold". The rule-of-thumb is chosen for
 * the prototype because it validates the *contract* — `{ room, confidence }` +
 * widen-on-low-confidence — with zero new dependency, zero secret, zero
 * latency, and full offline testability. An LLM structured-output backing is a
 * drop-in replacement behind this same signature; nothing downstream changes.
 */

// Canonical Hindsight room vocabulary (mirrors the `room` enum documented in
// agent-tools/tool-definitions/memory.js). The router can only ever emit one of
// these or null (= widen to domain).
export const ROOMS = [
  'auth', 'pipeline', 'schema', 'tax', 'hr', 'legal', 'compliance',
  'infrastructure', 'ui', 'api', 'deployment', 'monitoring', 'agent', 'general',
];

// Keyword hints per room. A hit is a whole-word match of a hint in the query.
// `general` is intentionally absent — it is the "no specific collection" room,
// reached only as the widen target, never as a positive route.
//
// Exported because ADR-193 gives this map a SECOND point of application: it
// already routes reads, and roomVocabulary.js now also uses it to canonicalise
// the room an agent types on a write (`deploy` → `deployment`). One map, two
// call sites — not a copy that drifts out of sync.
export const ROOM_HINTS = {
  auth: ['auth', 'login', 'token', 'jwt', 'password', 'oauth', 'session', 'permission', 'permissions'],
  pipeline: ['pipeline', 'deal', 'deals', 'stage', 'funnel', 'lead', 'leads'],
  schema: ['schema', 'column', 'columns', 'migration', 'field', 'fields'],
  tax: ['tax', 'taxes', 'vat', 'invoice', 'invoices', 'accounting'],
  hr: ['hr', 'employee', 'employees', 'hire', 'hiring', 'salary', 'payroll', 'vacation'],
  legal: ['legal', 'contract', 'contracts', 'nda', 'gdpr', 'license', 'licensing'],
  compliance: ['compliance', 'audit', 'audits', 'policy', 'regulation', 'regulations'],
  infrastructure: ['infra', 'infrastructure', 'server', 'servers', 'nginx', 'pm2', 'docker', 'vpn', 'host'],
  ui: ['ui', 'button', 'css', 'component', 'components', 'frontend', 'react', 'layout', 'widget'],
  api: ['api', 'endpoint', 'endpoints', 'route', 'routes', 'rest', 'request', 'response'],
  deployment: ['deployment', 'deploy', 'release', 'rollout', 'ci', 'cd', 'build', 'builds'],
  monitoring: ['monitor', 'monitoring', 'log', 'logs', 'metric', 'metrics', 'alert', 'alerts', 'telemetry', 'observability'],
  agent: ['agent', 'agents', 'prompt', 'prompts', 'llm', 'memory', 'hindsight', 'tool', 'tools'],
};

// Confidence below this floor means "do not trust the route" → widen to domain
// (no room). A single weak keyword hit (0.5) widens; ≥2 distinct hits (0.9)
// applies. Exported so the caller's threshold stays in lockstep with the router.
export const ROUTE_CONFIDENCE_FLOOR = 0.6;

const WORD = /[a-z0-9]+/g;

function tokenize(text) {
  return new Set(String(text || '').toLowerCase().match(WORD) || []);
}

/**
 * Route a memory query to a Hindsight `room` (the Collection step of DCD).
 *
 * @param {string} query - the recall query
 * @returns {{ room: string|null, confidence: number, reason: string }}
 *   `room === null` means "widen to domain" — search unscoped. `confidence` is
 *   in [0,1]; the caller applies the route only when it clears
 *   `ROUTE_CONFIDENCE_FLOOR`.
 */
export function routeMemoryScope(query) {
  const tokens = tokenize(query);
  if (tokens.size === 0) {
    return { room: null, confidence: 0, reason: 'empty query → widen to domain' };
  }

  let best = null;
  let bestHits = 0;
  for (const [room, hints] of Object.entries(ROOM_HINTS)) {
    let hits = 0;
    for (const h of hints) if (tokens.has(h)) hits += 1;
    if (hits > bestHits) {
      bestHits = hits;
      best = room;
    }
  }

  if (bestHits === 0) {
    return { room: null, confidence: 0, reason: 'no room keywords matched → widen to domain' };
  }

  const confidence = bestHits >= 2 ? 0.9 : 0.5;
  if (confidence < ROUTE_CONFIDENCE_FLOOR) {
    return {
      room: null,
      confidence,
      reason: `weak match for "${best}" (1 keyword) → widen to domain`,
    };
  }

  return {
    room: best,
    confidence,
    reason: `routed to "${best}" (${bestHits} keyword hits)`,
  };
}
