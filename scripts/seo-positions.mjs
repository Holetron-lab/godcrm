#!/usr/bin/env node
/**
 * Съём SEO-позиций через Yandex Cloud Search API v2 → CRM.
 * Задания (widget 134): 239259 — ручной съём; 239321 — четыре колонки, динамика, отложенный режим.
 * Проект «69 level», Space 7826. Ключ API — vault этого спейса (`yandex_search_api`, ADR-0040);
 * folderId не требуется ни для sync, ни для async (проверено живыми вызовами 2026-10-01/02).
 *
 * Таблица 100854 (seo_positions). Основной вид — четыре колонки:
 *   «Ключевой запрос» | «Позиция МСК» (region 213) | «Позиция СПБ» (region 2) | «Без региона» (region не передан).
 *   pos_*  — number: позиция или null (не найдено / ещё не измерено) → сортировка числовая;
 *   dyn_*  — скрытая служебная JSON-ячейка региона: текущий замер, предыдущий сопоставимый, ошибка,
 *            ожидающая операция (см. applyResult в lib/seo-positions-core.mjs). Фронт рисует из неё «4 ↑1»;
 *   домен / проверено / заметка_замера — скрытые: настройка строки и сводка последнего запуска.
 * Таблица 100857 (seo_position_history) — одна строка на (run_id, запрос, регион).
 *
 * Режимы:
 *   отложенный (по умолчанию, ~16× дешевле): POST …/searchAsync → operation_id хранится в dyn_*.pending →
 *     GET operations/{id}. «done=false» — не ошибка: результат забирается тем же запуском с --wait
 *     или позже через --resume; поисковый POST никогда не повторяется.
 *   --sync — обычный запрос, дорого; явный выбор, оценка стоимости печатается до отправки.
 *
 *   node scripts/seo-positions.mjs --estimate                 # сколько запросов и рублей; ничего не отправлять
 *   node scripts/seo-positions.mjs                            # отправить отложенные запросы и выйти
 *   node scripts/seo-positions.mjs --wait 1800                # … и ждать результаты до 30 минут
 *   node scripts/seo-positions.mjs --resume [--wait 600]      # только забрать ожидающие операции
 *   node scripts/seo-positions.mjs --sync --row 239280        # срочный синхронный съём одной строки
 *   node scripts/seo-positions.mjs --rebuild                  # пересобрать pos_* и dyn_* из истории 100857
 *
 * --run-id X         метка замера (по умолчанию seo-ГГГГ-ММ-ДД). Один run_id = один замер на строку/регион:
 *                    повтор того же run_id ничего не измеряет заново и не трогает текущую позицию.
 * --depth N          глубина (документов), по умолчанию 50, страницы по ≤100. Смена глубины = новая база сравнения.
 * --regions a,b      msk | spb | bg (по умолчанию все три)
 * --row ID[,ID]      только эти строки 100854
 * --domain D         домен для всех строк (иначе колонка «Домен»)
 * --subdomains       считать поддомены совпадением (по умолчанию только host и www)
 * --dry-run          не отправлять поиск и ничего не писать (опрос ожидающих операций разрешён)
 */

import { CRM_BASE, CRM_USER_ID, IS_REMOTE, SPACE_ID, loadRows, writeToken } from './lib/crm-target.mjs';
import {
  REGIONS, ASYNC_URL, OPERATION_URL, buildRequest, parseYandexXml, findPosition, pagePlan, formatPos,
  normalizeHost, methodSignature, applyResult, parseSidecar, parseOperation, estimateCost,
} from './lib/seo-positions-core.mjs';

const SYNC_URL = 'https://searchapi.api.cloud.yandex.net/v2/web/search';
const SECRET_KEY = 'yandex_search_api';
const POSITIONS_TABLE = Number(process.env.CRM_SEO_TABLE || 100854);
const HISTORY_TABLE = Number(process.env.CRM_SEO_HISTORY_TABLE || 100857);
const DYN = { msk: 'dyn_msk', spb: 'dyn_spb', bg: 'dyn_bg' };
const COMPLETED = new Set(['found', 'not_found']);

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return (!v || v.startsWith('--')) ? true : v;
}
const flag = (name) => arg(name, false) !== false;

const depth = Number(arg('depth', 50));
const regions = String(arg('regions', 'msk,spb,bg')).split(',').map((s) => s.trim()).filter(Boolean);
const onlyRows = arg('row') ? String(arg('row')).split(',').map(Number) : null;
const domainOverride = arg('domain') && arg('domain') !== true ? String(arg('domain')) : null;
const subdomains = flag('subdomains');
const dryRun = flag('dry-run');
const mode = flag('sync') ? 'sync' : 'async';
const resume = flag('resume');
const estimateOnly = flag('estimate');
const rebuild = flag('rebuild');
const waitSec = Number(arg('wait', 0)) || 0;
const runId = String(arg('run-id', `seo-${new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })}`)); // дата по Москве

if (!Number.isInteger(depth) || depth < 1 || depth > 250) { console.error('--depth: целое 1..250 (документированный предел выдачи)'); process.exit(2); }
const unknown = regions.filter((r) => !REGIONS[r]);
if (unknown.length) { console.error(`--regions: неизвестно ${unknown.join(',')} (msk|spb|bg)`); process.exit(2); }

const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rub = (c) => `${c.requests} запр. ≈ ${c.rub.toFixed(2)} ₽ (${c.mode === 'sync' ? 'обычный' : 'отложенный'}, ${c.slot === 'night' ? 'ночь' : 'день'}, ${c.rate} ₽/1000)`;

/** Ключ API: YANDEX_SEARCH_API_KEY в env → vault спейса (только для своей установки). */
async function apiKey() {
  if (process.env.YANDEX_SEARCH_API_KEY) return process.env.YANDEX_SEARCH_API_KEY;
  if (IS_REMOTE) return null;
  const dotenv = (await import('dotenv')).default;
  dotenv.config({ path: new URL('../.env', import.meta.url).pathname });
  const { getAdapter } = await import('../backend/database/connection.js');
  const vault = (await import('../backend/services/secrets/SecretsVault.js')).default;
  await vault.init({ adapter: await getAdapter() });
  const v = await vault.getSecret(SECRET_KEY, { spaceId: SPACE_ID });
  if (v) console.log(`[vault] ключ взят из хранилища спейса ${SPACE_ID} («${SECRET_KEY}»)`);
  return v;
}

let key = null;
/** Вызов Yandex: { json } | { error } — сеть и не-2xx не бросают. */
async function yandex(url, init = {}) {
  let res;
  try {
    res = await fetch(url, { ...init, headers: { Authorization: `Api-Key ${key}`, 'Content-Type': 'application/json' } });
  } catch (e) { return { error: `сеть: ${e.message}` }; }
  if (!res.ok) return { error: `HTTP ${res.status} ${(await res.text()).slice(0, 120)}` };
  return { json: await res.json() };
}

/** Страница выдачи → { error } | { docs } | { empty: true } (код 15 — ничего не найдено). */
function pageDocs(rawData) {
  const { error, docs } = parseYandexXml(Buffer.from(rawData || '', 'base64').toString('utf8'));
  if (error && error.code === 15) return { empty: true };
  if (error) return { error: `API ${error.code}: ${error.text}` };
  return { docs };
}

/**
 * Синхронный съём одного региона: страницы до глубины, пока домен не найден.
 * not_found означает полный обход: либо вся глубина проверена, либо выдача кончилась раньше (short).
 */
async function measureSync(keyword, domain, regionId) {
  const plan = pagePlan(depth);
  let seen = 0;
  for (let page = 0; page < plan.length; page++) {
    const { json, error } = await yandex(SYNC_URL, { method: 'POST', body: JSON.stringify(buildRequest({ keyword, regionId, page, groupsOnPage: plan[page] })) });
    if (error) return { status: 'api_error', error };
    const p = pageDocs(json.rawData);
    if (p.error) return { status: 'api_error', error: p.error };
    if (p.empty) return { status: 'not_found', checked: depth, short: seen };
    const hit = findPosition(p.docs, domain, { offset: seen, subdomains });
    seen += p.docs.length;
    if (hit) return { status: 'found', ...hit, checked: seen };
    if (p.docs.length < plan[page]) return { status: 'not_found', checked: depth, short: seen };
  }
  return { status: 'not_found', checked: depth };
}

/** Отложенный запрос одной страницы → { operationId, submittedAt } | { error }. */
async function submitPage(keyword, regionId, page, groupsOnPage) {
  const { json, error } = await yandex(ASYNC_URL, { method: 'POST', body: JSON.stringify(buildRequest({ keyword, regionId, page, groupsOnPage })) });
  if (error) return { error };
  if (!json?.id) return { error: `нет operation id: ${JSON.stringify(json).slice(0, 120)}` };
  return { operationId: json.id, submittedAt: json.createdAt || now() };
}

/**
 * Опрос ожидающей операции региона: { state: 'waiting' } | { state: 'next', pending } | { state: 'done', result }.
 * Следующая страница отправляется только когда текущая полностью просмотрена и домена в ней нет.
 */
async function pollPending(keyword, domain, regionId, pending) {
  const { json, error } = await yandex(OPERATION_URL + pending.operation_id);
  if (error) return { state: 'done', result: { status: 'api_error', error } };
  const op = parseOperation(json);
  if (!op.done) return { state: 'waiting' };
  if (op.error) return { state: 'done', result: { status: 'api_error', error: op.error } };
  const p = pageDocs(op.rawData);
  if (p.error) return { state: 'done', result: { status: 'api_error', error: p.error } };
  if (p.empty) return { state: 'done', result: { status: 'not_found', checked: pending.depth, short: pending.checked } };
  const plan = pagePlan(pending.depth);
  const hit = findPosition(p.docs, domain, { offset: pending.checked, subdomains: Boolean(pending.subdomains) });
  const seen = pending.checked + p.docs.length;
  if (hit) return { state: 'done', result: { status: 'found', ...hit, checked: seen } };
  const next = pending.page + 1;
  if (p.docs.length < plan[pending.page] || next >= plan.length) {
    return { state: 'done', result: { status: 'not_found', checked: pending.depth, short: p.docs.length < plan[pending.page] ? seen : undefined } };
  }
  const s = await submitPage(keyword, regionId, next, plan[next]);
  if (s.error) return { state: 'done', result: { status: 'api_error', error: s.error } };
  return { state: 'next', pending: { ...pending, operation_id: s.operationId, page: next, checked: seen, page_submitted_at: s.submittedAt } };
}

const headers = (token) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });
async function putRow(token, tableId, rowId, data) {
  const res = await fetch(`${CRM_BASE}/api/v3/tables/${tableId}/rows/${rowId}`, { method: 'PUT', headers: headers(token), body: JSON.stringify({ data }) });
  if (!res.ok) throw new Error(`PUT ${tableId}/${rowId} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
async function postRow(token, tableId, data) {
  const res = await fetch(`${CRM_BASE}/api/v3/tables/${tableId}/rows`, { method: 'POST', headers: headers(token), body: JSON.stringify({ data }) });
  if (!res.ok) throw new Error(`POST ${tableId} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const rowTarget = (row) => ({
  keyword: String(row.data.keyword || '').trim(),
  domain: normalizeHost(domainOverride || row.data.домен),
});
const histKey = (rid, keyword, code) => `${rid}|${keyword}|${code}`;
const regionLabel = (code) => `${REGIONS[code].label}${REGIONS[code].id ? ` (region ${REGIONS[code].id})` : ' (region не передан)'}`;
const latest = (...dates) => dates.filter(Boolean).sort().pop();

const rows = (await loadRows(POSITIONS_TABLE)).filter((r) => !onlyRows || onlyRows.includes(r.id));
if (!rows.length) { console.error(`В ${POSITIONS_TABLE} нет строк для съёма`); process.exit(1); }
const history = await loadRows(HISTORY_TABLE);
const written = new Set(history.map((h) => histKey(h.data.run_id, h.data.keyword, h.data.region)));
const token = dryRun ? null : await writeToken(CRM_USER_ID);

// ── --rebuild: pos_* и dyn_* заново из истории (источник истины — 100857) ──────
if (rebuild) {
  for (const row of rows) {
    const { keyword, domain } = rowTarget(row);
    const patch = {};
    const summary = [];
    for (const code of regions) {
      const entries = history.map((h) => h.data)
        .filter((h) => h.keyword === keyword && normalizeHost(h.domain) === domain && h.region === code && COMPLETED.has(h.status))
        .sort((a, b) => String(a.checked_at || '').localeCompare(String(b.checked_at || '')));
      let cell = null;
      for (const h of entries) {
        const d = Number(h.depth) || depth;
        const result = h.status === 'found'
          ? { status: 'found', position: Number(h.position), url: h.url, checked: Number(h.params?.match(/проверено (\d+)/)?.[1]) || d }
          : { status: 'not_found', checked: d };
        ({ cell } = applyResult(cell, result, {
          at: h.checked_at, receivedAt: h.received_at || h.checked_at, runId: h.run_id, depth: d,
          method: h.method || methodSignature({ regionId: REGIONS[code].id, depth: d, subdomains: /поддомены да/.test(h.params || '') }),
        }));
      }
      patch[DYN[code]] = cell;
      patch[REGIONS[code].pos] = cell?.position ?? null;
      patch.проверено = latest(patch.проверено, cell?.at);
      summary.push(`${REGIONS[code].label}: ${entries.length} замер(ов)${cell ? `, текущая ${cell.position ?? `>${cell.checked}`} от ${cell.at}` : ''}`);
    }
    patch.заметка_замера = `rebuild из истории ${now()} · ${summary.join(' · ')}`;
    console.log(`${row.id} · «${keyword}» · ${domain}: ${summary.join(' · ')}`);
    if (!dryRun) await putRow(token, POSITIONS_TABLE, row.id, patch);
  }
  console.log(`${dryRun ? 'DRY RUN — ' : ''}rebuild: строк ${rows.length}`);
  process.exit(0);
}

// ── оценка расхода до отправки (верхняя граница: все страницы глубины) ───────
let newRequests = 0;
for (const row of rows) {
  const { keyword, domain } = rowTarget(row);
  if (!keyword || !domain) continue;
  for (const code of regions) {
    if (parseSidecar(row.data[DYN[code]]).pending?.operation_id || written.has(histKey(runId, keyword, code))) continue;
    newRequests += pagePlan(depth).length;
  }
}
const est = estimateCost({ requests: resume ? 0 : newRequests, mode });
console.log(`run ${runId} · режим ${mode === 'sync' ? 'обычный (дорого)' : 'отложенный'} · максимум ${rub(est)}`);
if (mode === 'sync') console.log(`  тот же объём отложенно: ${rub(estimateCost({ requests: newRequests, mode: 'async' }))}`);
if (estimateOnly) process.exit(0);

key = await apiKey();
if (!key) { console.error('Нет ключа Yandex Search API: ни YANDEX_SEARCH_API_KEY, ни vault'); process.exit(2); }

// ── один проход: опросить ожидающие операции; при submit — отправить новые замеры ──
async function pass({ submit }) {
  const fresh = submit ? rows : (await loadRows(POSITIONS_TABLE)).filter((r) => !onlyRows || onlyRows.includes(r.id));
  const stats = { pending: 0, failures: 0, submitted: 0, applied: 0 };
  for (const row of fresh) {
    const { keyword, domain } = rowTarget(row);
    if (!keyword || !domain) { console.warn(`строка ${row.id}: пропуск — нет ${!keyword ? 'запроса' : 'домена'}`); continue; }
    const patch = {};
    const notes = [];
    const tag = `${row.id} · «${keyword}» · ${domain}`;

    /** Завершённый результат региона → dyn_*, pos_*, «Проверено», история. */
    const apply = async (code, result, meta) => {
      const region = REGIONS[code];
      const { cell, applied } = applyResult(row.data[DYN[code]], result, meta);
      patch[DYN[code]] = cell;
      if (applied) {
        patch[region.pos] = cell.position;
        patch.проверено = latest(patch.проверено, cell.at);
        stats.applied += 1;
      }
      if (result.status === 'api_error') { stats.failures += 1; notes.push(`${region.label}: ошибка ${result.error}`); }
      else if (!applied) notes.push(`${region.label}: результат ${meta.runId} не применён (повтор run_id или поздний ответ)`);
      else if (result.short !== undefined) notes.push(`${region.label}: выдача короче глубины (${result.short} из ${meta.depth})`);
      console.log(`${tag} · ${regionLabel(code)}: ${formatPos(result)}${result.url ? ` ${result.url}` : ''}${applied || result.status === 'api_error' ? '' : ' (не применено)'}`);

      const k = histKey(meta.runId, keyword, code);
      if (dryRun || written.has(k)) return;
      await postRow(token, HISTORY_TABLE, {
        keyword, domain, region: code, status: result.status,
        position: result.status === 'found' ? result.position : null,
        url: result.status === 'found' ? result.url : '',
        depth: meta.depth, checked_at: meta.at, received_at: meta.receivedAt, run_id: meta.runId,
        method: meta.method, operation_id: meta.operationId || '',
        params: `${regionLabel(code)}; ${meta.mode}; depth ${meta.depth}; поддомены ${meta.subdomains ? 'да' : 'нет'}; www прозрачен; проверено ${result.checked ?? '-'}${result.error ? `; ${result.error}` : ''}`,
      });
      written.add(k);
    };

    for (const code of regions) {
      const region = REGIONS[code];
      const cell = parseSidecar(row.data[DYN[code]]);
      const p = cell.pending;
      if (p?.operation_id) {
        const r = await pollPending(keyword, domain, region.id, p);
        if (r.state === 'waiting') {
          stats.pending += 1;
          notes.push(`${region.label}: ожидает ${p.operation_id} (отправлено ${p.submitted_at})`);
          console.log(`${tag} · ${regionLabel(code)}: ожидает ${p.operation_id}`);
          continue;
        }
        if (r.state === 'next') {
          stats.pending += 1; stats.submitted += 1;
          patch[DYN[code]] = { ...cell, pending: r.pending };
          notes.push(`${region.label}: страница ${r.pending.page + 1}, ${r.pending.operation_id}`);
          continue;
        }
        await apply(code, r.result, { at: p.submitted_at, receivedAt: now(), runId: p.run_id, method: p.method, depth: p.depth, subdomains: p.subdomains, operationId: p.operation_id, mode: 'async' });
        continue;
      }
      if (!submit) continue;
      if (written.has(histKey(runId, keyword, code))) { console.log(`${tag} · ${regionLabel(code)}: уже измерено в ${runId}, пропуск`); continue; }
      const method = methodSignature({ regionId: region.id, depth, subdomains });
      if (mode === 'sync') {
        const at = now();
        await apply(code, await measureSync(keyword, domain, region.id), { at, receivedAt: now(), runId, method, depth, subdomains, mode: 'sync' });
        continue;
      }
      if (dryRun) { console.log(`${tag} · ${regionLabel(code)}: DRY RUN — searchAsync не отправлен`); continue; }
      const s = await submitPage(keyword, region.id, 0, pagePlan(depth)[0]);
      if (s.error) { await apply(code, { status: 'api_error', error: s.error }, { at: now(), receivedAt: now(), runId, method, depth, subdomains, mode: 'async' }); continue; }
      stats.submitted += 1; stats.pending += 1;
      patch[DYN[code]] = { ...cell, pending: { run_id: runId, operation_id: s.operationId, page: 0, checked: 0, submitted_at: s.submittedAt, method, depth, subdomains } };
      notes.push(`${region.label}: отправлено ${s.operationId}`);
      console.log(`${tag} · ${regionLabel(code)}: отправлено ${s.operationId}`);
    }
    if (!Object.keys(patch).length) continue;
    patch.заметка_замера = [`run ${runId}`, mode === 'sync' ? 'обычный' : 'отложенный', `оценка ${rub(est)}`, ...notes].join(' · ');
    if (!dryRun) await putRow(token, POSITIONS_TABLE, row.id, patch);
  }
  return stats;
}

let stats = await pass({ submit: !resume });
const started = Date.now();
for (let delay = 15; stats.pending && Date.now() - started < waitSec * 1000; delay = Math.min(delay * 2, 60)) {
  console.log(`ожидают ${stats.pending}; следующий опрос через ${delay} с`);
  await sleep(delay * 1000);
  const next = await pass({ submit: false });
  stats = { ...next, failures: stats.failures + next.failures, submitted: stats.submitted + next.submitted, applied: stats.applied + next.applied };
}

console.log(`${dryRun ? 'DRY RUN — ' : ''}run ${runId}: строк ${rows.length}, регионов ${regions.length}, отправлено ${stats.submitted}, применено ${stats.applied}, ошибок ${stats.failures}, ожидают ${stats.pending}`);
if (stats.pending) console.log('Результаты хранятся у Яндекса до 12 часов: заберите их `node scripts/seo-positions.mjs --resume [--wait 600]`');
process.exit(stats.failures ? 1 : 0);
