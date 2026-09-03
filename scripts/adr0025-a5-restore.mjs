#!/usr/bin/env node
// ADR-0025 A.5 — restore agent prompts from snapshot AND prepend §11.1 guard.
// Recovers from earlier mistake where script overwrote system_prompt with guard only.
import { readFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';

const SECRET = 'super-secret-jwt-key-change-this-in-production-abc123xyz';
const BASE = 'https://devcrm.hltrn.cc/api/v3';
const TABLE = 1784;
const GUARD = readFileSync('/tmp/adr0025_a5_guard.md', 'utf8');
const SENTINEL = '## §11.1 — Suicide-PM2 Guard';
const SNAP = JSON.parse(readFileSync('/root/production/business-crm/.cleanup-snapshots/2026-05-02/agent_prompts_pre-11.1.json', 'utf8'));

const token = jwt.sign(
  { userId: 24, email: 'architect@hltrn.cc', role: 'admin' },
  SECRET,
  { expiresIn: '1h' }
);
const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

async function getRow(id) {
  const r = await fetch(`${BASE}/tables/${TABLE}/rows/${id}`, { headers });
  if (!r.ok) throw new Error(`GET ${id}: ${r.status}`);
  const j = await r.json();
  return j.data.row;
}

async function updateRow(id, data) {
  const r = await fetch(`${BASE}/tables/${TABLE}/rows/${id}`, {
    method: 'PUT', headers, body: JSON.stringify({ data }),
  });
  if (!r.ok) throw new Error(`PUT ${id}: ${r.status} ${await r.text()}`);
  return r.json();
}

const report = [];
for (const entry of SNAP) {
  const id = Number(entry.id);
  const original = entry.system_prompt;
  if (typeof original !== 'string' || original.length < 100) {
    report.push({ id, name: entry.name, status: 'SKIP_BAD_SNAPSHOT', orig_len: (original||'').length });
    continue;
  }
  // Confirm current state is broken (length matches just the guard, ~1004 chars).
  const cur = (await getRow(id)).data.system_prompt || '';
  const next = GUARD + original;
  await updateRow(id, { system_prompt: next });
  // Verify write
  const after = (await getRow(id)).data.system_prompt || '';
  report.push({
    id, name: entry.name,
    orig_len: original.length,
    cur_was: cur.length,
    written_len: next.length,
    after_len: after.length,
    sentinel_ok: after.includes(SENTINEL),
    original_preserved: after.endsWith(original.slice(-200)),
  });
}
console.log(JSON.stringify(report, null, 2));
