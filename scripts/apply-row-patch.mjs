#!/usr/bin/env node
/**
 * Применяет JSON-патч строк к таблице через API (прямые UPDATE в БД запрещены).
 *
 * Вход — массив [{row_id, data}] из stdin или файла: ровно то, что печатает
 * `score-posts.mjs --json`. Пустые (null) поля пропускаются, чтобы патч
 * не затирал уже заполненные значения.
 *
 *   node scripts/score-posts.mjs --json | sed -n '/^\[{/p' > /tmp/patch.json
 *   node scripts/apply-row-patch.mjs --table 100852 --file /tmp/patch.json --only account_type
 *
 * --only <ключ,ключ>  — применить только перечисленные поля.
 * --dry-run           — показать, что уйдёт, и ничего не писать.
 */

import { readFileSync } from 'node:fs';
import { CRM_BASE as BASE, CRM_USER_ID as USER_ID, writeToken } from './lib/crm-target.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return (!v || v.startsWith('--')) ? true : v;
}

const tableId = Number(arg('table'));
if (!tableId) { console.error('Нужен --table <id>'); process.exit(2); }

const file = arg('file');
const raw = (file && file !== true)
  ? readFileSync(file, 'utf8')
  : readFileSync(0, 'utf8');
const patch = JSON.parse(raw);
if (!Array.isArray(patch)) { console.error('Ожидался массив [{row_id, data}]'); process.exit(2); }

const onlyArg = arg('only');
const only = (onlyArg && onlyArg !== true) ? String(onlyArg).split(',').map((s) => s.trim()) : null;
const dryRun = arg('dry-run', false) !== false;

const token = await writeToken(USER_ID);

let ok = 0; let skipped = 0; let failed = 0;
for (const { row_id: rowId, data } of patch) {
  const payload = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (only && !only.includes(k)) continue;
    if (v === null || v === undefined) continue;   // не затираем уже заполненное
    payload[k] = v;
  }
  if (!Object.keys(payload).length) { skipped += 1; continue; }
  if (dryRun) { ok += 1; continue; }

  const res = await fetch(`${BASE}/api/v3/tables/${tableId}/rows/${rowId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data: payload }),
  });
  if (res.ok) ok += 1;
  else {
    failed += 1;
    console.error(`[${res.status}] строка ${rowId}: ${(await res.text()).slice(0, 200)}`);
  }
}

console.log(`${dryRun ? 'DRY RUN — ' : ''}обновлено ${ok}, пропущено (нечего писать) ${skipped}, ошибок ${failed}`);
process.exit(failed ? 1 : 0);
