import { z } from 'zod';

export const BROWSER_SUITES = Object.freeze({
  'computed-contrast-v1': 'computed_styles',
  'axe-v1': 'axe',
  'trace-metrics-v1': 'trace_metrics',
  'clipboard-v1': 'isolated_clipboard',
});
export const browserRequestSchema = z.object({ suite_id: z.enum(Object.keys(BROWSER_SUITES)) }).strict();
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const browserPinsSchema = z.object({
  executor: digestSchema, image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  dependencies: digestSchema, seccomp: digestSchema, egress: digestSchema,
  suites: digestSchema, installation: digestSchema,
}).strict();
export const browserCapabilitiesSchema = z.object({
  sandbox: z.literal(true), non_root: z.literal(true), tls_verified: z.literal(true),
  network_enforced: z.literal(true), durable_reaper: z.literal(true),
  computed_styles: z.literal(true), axe: z.literal(true), trace_metrics: z.literal(true),
  isolated_clipboard: z.literal(true), sanitized_artifacts: z.literal(true),
  cleanup_ms: z.number().int().positive().max(10000),
}).strict();
// Only typed aggregates and content-addressed descriptors cross the agent boundary.
// Raw trace/DOM/clipboard/headers/URLs never travel in tool output or audit JSON.
export const browserReportSchema = z.object({
  passed: z.boolean(),
  checks: z.array(z.object({
    kind: z.enum(['contrast','axe','lcp','inp','cls','clipboard','sandbox','tls','egress','cleanup']),
    passed: z.boolean(), value: z.number().finite().min(0).max(1e9).optional(),
    count: z.number().int().min(0).max(100000).optional(),
  }).strict()).max(100),
  artifacts: z.array(z.object({
    id: z.string().uuid(), kind: z.enum(['contrast','axe','metrics','sanitized_trace','clipboard']),
    sha256: digestSchema, bytes: z.number().int().min(0).max(1048576),
    sanitized: z.literal(true),
  }).strict()).max(8),
}).strict().refine(r => r.artifacts.reduce((n, a) => n + a.bytes, 0) <= 2097152, 'artifact quota');
export const browserBindingSchema = z.object({
  id: z.number().int().positive(), job_id: z.string().regex(/^[1-9][0-9]*$/),
  agent_id: z.number().int().positive(), space_id: z.literal(11),
  role: z.enum(['sysadmin','developer-ralph','developer','frontend-developer','frontend-qa']),
  repo: z.string().regex(/^\/root\/wt-[A-Za-z0-9._-]+$/),
  candidate_sha: z.string().regex(/^[a-f0-9]{40}$/),
  suite_ids: z.array(z.enum(Object.keys(BROWSER_SUITES))).min(1).max(4),
  pins: browserPinsSchema, deadline_seconds: z.number().int().min(1).max(300).default(180),
  expires_at: z.coerce.date(), revoked_at: z.null(),
}).passthrough();

export const browserArtifactRequestSchema = z.object({ run_id: z.string().uuid(), artifact_id: z.string().uuid() }).strict();
// Published trace is a projection onto fixed actions/timings, never a raw zip/HAR.
export const browserArtifactSchema = z.object({
  kind: z.enum(['contrast','axe','metrics','sanitized_trace','clipboard']),
  checks: z.array(z.object({
    target: z.enum(['table','schema_drawer','access','clipboard']),
    rule: z.enum(['contrast','axe','lcp','inp','cls','clipboard']),
    passed: z.boolean(), value: z.number().finite().min(0).max(1e9).optional(),
    count: z.number().int().min(0).max(100000).optional(),
  }).strict()).max(1000),
  trace: z.array(z.object({
    action: z.enum(['navigate','open_drawer','switch_tab','scroll','expand_access','clipboard_roundtrip']),
    start_ms: z.number().finite().min(0).max(300000), duration_ms: z.number().finite().min(0).max(300000),
  }).strict()).max(1000),
}).strict();
