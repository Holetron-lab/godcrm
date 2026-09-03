#!/usr/bin/env node
// ADR-0025 A.5 — prepend §11.1 guard to 8 active agent prompts (idempotent)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import jwt from 'jsonwebtoken';

const SECRET = 'super-secret-jwt-key-change-this-in-production-abc123xyz';
const BASE = 'https://devcrm.hltrn.cc/api/v3';
const TABLE = 1784;
const GUARD = readFileSync('/tmp/adr0025_a5_guard.md', 'utf8');
const SENTINEL = '## §11.1 — Suicide-PM2 Guard';

const AGENTS = [
  { id: 110507, name: 'Agent Smith' },
  { id: 33491,  name: 'Architect' },
  { id: 31113,  name: 'Developer Ralph' },
  { id: 31114,  name: 'Frontend' },
  { id: 33484,  name: 'SysAdmin' },
  { id: 31115,  name: 'Test Runner' },
  { id: 33485,  name: 'Frontend QA' },
  { id: 31112,  name: 'Orchestrator' },
];

const token = jwt.sign(
  { userId: 24, email: 'architect@hltrn.cc', role: 'admin' },
  SECRET,
  { expiresIn: '1h' }
);

const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

async function getRow(id) {
  const r = await fetch(`${BASE}/tables/${TABLE}/rows/${id}`, { headers });
  if (!r.ok) throw new Error(`GET ${id}: ${r.status}`);
  return r.json();
}

async function updateRow(id, data) {
  const r = await fetch(`${BASE}/tables/${TABLE}/rows/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ data }),
  });
  if (!r.ok) throw new Error(`PUT ${id}: ${r.status} ${await r.text()}`);
  return r.json();
}

const today = new Date().toISOString().slice(0, 10);
const snapDir = `/root/production/business-crm/.cleanup-snapshots/${today}`;
mkdirSync(snapDir, { recursive: true });
const snapPath = `${snapDir}/agent_prompts_pre-11.1.json`;

// Phase 1: snapshot all 8 rows BEFORE any write.
const snapshots = {};
for (const a of AGENTS) {
  const row = await getRow(a.id);
  const cur = row?.data?.system_prompt ?? row?.row?.system_prompt ?? row?.system_prompt ?? '';
  snapshots[a.id] = { name: a.name, system_prompt: cur };
}
writeFileSync(snapPath, JSON.stringify(snapshots, null, 2));

// Phase 2: update only rows that lack the sentinel.
const report = [];
for (const a of AGENTS) {
  const cur = snapshots[a.id].system_prompt;
  if (typeof cur !== 'string') {
    report.push({ id: a.id, name: a.name, status: 'ERROR_NO_STRING', len: 0 });
    continue;
  }
  if (cur.includes(SENTINEL)) {
    report.push({ id: a.id, name: a.name, status: 'ALREADY_PRESENT', len: cur.length });
    continue;
  }
  const next = GUARD + cur;
  await updateRow(a.id, { system_prompt: next });
  report.push({ id: a.id, name: a.name, status: 'PREPENDED', len_before: cur.length, len_after: next.length });
}

console.log(JSON.stringify({ snapshot: snapPath, guard_bytes: GUARD.length, agents: report }, null, 2));
