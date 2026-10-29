#!/usr/bin/env node
/**
 * Ручной ингест постов: Apify (apify/instagram-scraper) → CRM.
 *
 * Временный релей на время MVP. Постоянное решение — action_type `apify_ingest`
 * в планировщике (см. ТЗ для @developer). Скрипт ничего не деплоит и не рестартит,
 * пишет только через публичный входящий вебхук таблицы «Посты конкурентов» (100852).
 *
 * Источник аккаунтов — реестр (100851): берутся строки с «Платформа = Instagram»
 * и «Статус парсинга = Активен» — и наши аккаунты, и конкуренты. Кто есть кто,
 * определяет колонка «Тип аккаунта» (Наш / Конкурент); значение переносится
 * в каждую строку постов в поле `account_type`, чтобы бенчмарк «мы vs рынок»
 * считался без ручной разметки. БД читается только на чтение; запись идёт
 * исключительно через вебхук.
 *
 * Запуск:
 *   node scripts/apify-ingest-manual.mjs --newer-than "1 week" --limit 20 --dry-run
 *   node scripts/apify-ingest-manual.mjs --url https://www.instagram.com/<handle>
 *   node scripts/apify-ingest-manual.mjs --only Наш      # прогнать только свои аккаунты
 *
 * --dry-run  — ничего не пишет в CRM, печатает сырые ключи первого item'а,
 *              результат маппинга и разбивку по аккаунтам. Прогонять первым делом.
 */

import { readFileSync } from 'node:fs';
import { ACCOUNTS_TABLE, POSTS_TABLE, SPACE_ID, IS_REMOTE, loadRows } from './lib/crm-target.mjs';

const ACTOR = 'apify~instagram-scraper';
/** Ключ vault с URL входящего вебхука таблицы постов (кладёт владелец спейса). */
const WEBHOOK_SECRET_KEY = 'apify_crm_webhook_url';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return (!v || v.startsWith('--')) ? true : v;
}

/** Vault этой установки (ADR-0040), null если недоступен. Инициализируется один раз. */
let vaultPromise = null;
function openVault() {
  if (!vaultPromise) {
    vaultPromise = (async () => {
      const dotenv = (await import('dotenv')).default;
      dotenv.config({ path: new URL('../.env', import.meta.url).pathname });
      const { getAdapter } = await import('../backend/database/connection.js');
      const vault = (await import('../backend/services/secrets/SecretsVault.js')).default;
      await vault.init({ adapter: await getAdapter() });
      return vault;
    })().catch((e) => {
      console.warn(`[vault] недоступен (${e.message}) — пробуем env`);
      return null;
    });
  }
  return vaultPromise;
}

/**
 * URL входящего вебхука: CRM_WEBHOOK_URL → vault спейса (`apify_crm_webhook_url`).
 * Для чужой установки (IS_REMOTE) vault этого сервера не годится — только env.
 */
async function webhookUrl() {
  if (process.env.CRM_WEBHOOK_URL) return process.env.CRM_WEBHOOK_URL;
  if (IS_REMOTE) return null;
  const vault = await openVault();
  const v = vault ? await vault.getSecret(WEBHOOK_SECRET_KEY, { spaceId: SPACE_ID }) : null;
  if (v) console.log(`[vault] вебхук взят из хранилища спейса ${SPACE_ID} (ключ «${WEBHOOK_SECRET_KEY}»)`);
  return v || null;
}

/**
 * Порядок поиска токена: vault спейса (ADR-0040) → process.env → .env файл.
 * В хранилище ключ `apify_token` (так его завёл владелец); `apify` — имя
 * на прежней установке, оставлено для совместимости.
 */
async function apifyToken() {
  const vault = await openVault();
  if (vault) {
    for (const key of ['apify_token', 'apify']) {
      const v = await vault.getSecret(key, { spaceId: SPACE_ID });
      if (v) {
        console.log(`[vault] токен взят из хранилища спейса ${SPACE_ID} (ключ «${key}»)`);
        return v;
      }
    }
  }

  if (process.env.APIFY_TOKEN) return process.env.APIFY_TOKEN;
  try {
    const m = readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .match(/^APIFY_TOKEN=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* .env может не быть */ }
  return null;
}

/** @handle из URL профиля — таблица аккаунтов хранит URL, Apify отдаёт ownerUsername */
const handleFromUrl = (u) => (u.match(/instagram\.com\/([^/?#]+)/i)?.[1] || u).toLowerCase();

/**
 * Активные Instagram-аккаунты из реестра 100851 (только чтение).
 * `only` — необязательный фильтр по «Типу аккаунта» ('Наш' | 'Конкурент').
 * Пустой тип трактуем как «Конкурент»: реестр заводился до появления флага.
 */
async function loadAccounts(only = null) {
  const rows = await loadRows(ACCOUNTS_TABLE);
  const skipped = [];
  const accounts = [];
  for (const r of rows) {
    const d = r.data;
    const url = (d.url_профиля || '').trim();
    const platform = d.платформа;
    const status = d.статус_парсинга;
    const type = d.тип_аккаунта || 'Конкурент';
    if (!url) { skipped.push(`строка ${r.id}: пустой URL профиля`); continue; }
    if (platform !== 'Instagram') { skipped.push(`${handleFromUrl(url)}: платформа «${platform || '—'}», актор только под Instagram`); continue; }
    if (status !== 'Активен') { skipped.push(`${handleFromUrl(url)}: статус «${status || '—'}»`); continue; }
    if (only && type !== only) { skipped.push(`${handleFromUrl(url)}: тип «${type}», фильтр --only ${only}`); continue; }
    accounts.push({ rowId: r.id, url, handle: handleFromUrl(url), type, followers: d.подписчики ?? null });
  }
  return { accounts, skipped };
}

/** Уже записанные post_url из 100852 — ключ дедупа. */
async function loadExistingUrls() {
  const rows = await loadRows(POSTS_TABLE);
  return new Set(rows.map((r) => r.data.post_url).filter(Boolean));
}

/**
 * Карта полей актора → ключи колонок 100852.
 * likesCount === -1 у Apify означает «лайки скрыты», а не ноль — пишем null,
 * иначе скоринг занизит пост. `videoPlayCount` у этого актора отсутствует,
 * просмотры приходят в `videoViewCount` (подтверждено живым прогоном).
 */
function mapItem(item, collectedAt, typeByHandle) {
  const likes = typeof item.likesCount === 'number' && item.likesCount >= 0 ? item.likesCount : null;
  const type = item.productType === 'clips' ? 'Reel' : (item.type ?? null);
  // Из чьей ленты пост пришёл. У коллабов `ownerUsername` — соавтор, а не тот,
  // кого мы парсили: без source_handle такой пост теряет привязку к реестру
  // (нет подписчиков → нет знаменателя ER) и выпадает из бенчмарка.
  const source = item.inputUrl ? handleFromUrl(item.inputUrl) : null;
  const owner = item.ownerUsername ? String(item.ownerUsername).toLowerCase() : null;
  const handle = (source && typeByHandle.has(source)) ? source
    : ((owner && typeByHandle.has(owner)) ? owner : (source || owner));
  return {
    collected_at: collectedAt,
    competitor: item.ownerUsername ?? null,
    source_handle: handle,
    account_type: typeByHandle.get(handle) ?? null,
    post_type: type,
    post_date: item.timestamp ? String(item.timestamp).split('T')[0] : null,
    likes,
    comments: typeof item.commentsCount === 'number' ? item.commentsCount : null,
    caption: item.caption ?? null,
    post_url: item.url ?? null,
    views: item.videoPlayCount ?? item.videoViewCount ?? null,
  };
}

/** Один синхронный прогон актора по пачке URL'ов. */
async function runActor(token, urls, limit, newerThan) {
  const input = {
    directUrls: urls,
    resultsType: 'posts',
    resultsLimit: limit,
    onlyPostsNewerThan: newerThan,
    addParentData: false,
  };
  const res = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}&timeout=300`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
  );
  if (!res.ok) {
    throw new Error(`Apify HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

async function main() {
  const token = await apifyToken();
  if (!token) {
    console.error(`Токен Apify не найден: заведи ключ \`apify_token\` в хранилище спейса ${SPACE_ID} или положи APIFY_TOKEN в .env.`);
    process.exit(2);
  }
  const WEBHOOK = await webhookUrl();
  if (!WEBHOOK) {
    console.error(`Входящий вебхук не найден: ключ \`${WEBHOOK_SECRET_KEY}\` в хранилище спейса ${SPACE_ID} или CRM_WEBHOOK_URL.`);
    process.exit(2);
  }

  const limit = Number(arg('limit', 20));
  const dryRun = arg('dry-run', false) !== false;
  const newerThan = arg('newer-than', '1 week');
  const batchSize = Number(arg('batch', 4));
  const urlArg = arg('url');
  const onlyArg = arg('only');
  const only = (onlyArg && onlyArg !== true) ? String(onlyArg) : null;
  if (only && !['Наш', 'Конкурент'].includes(only)) {
    console.error(`--only принимает «Наш» или «Конкурент», получено «${only}»`);
    process.exit(2);
  }

  let accounts;
  if (urlArg && urlArg !== true) {
    accounts = [{ rowId: null, url: urlArg, handle: handleFromUrl(urlArg), type: only || 'Конкурент', followers: null }];
  } else {
    const loaded = await loadAccounts(only);
    accounts = loaded.accounts;
    if (loaded.skipped.length) {
      console.log('[аккаунты] пропущены:');
      loaded.skipped.forEach((s) => console.log(`  — ${s}`));
    }
  }
  if (accounts.length === 0) {
    console.error('[аккаунты] нечего парсить: в 100851 нет активных Instagram-строк с URL.');
    process.exit(1);
  }

  const existing = await loadExistingUrls();
  const typeByHandle = new Map(accounts.map((a) => [a.handle, a.type]));
  const ours = accounts.filter((a) => a.type === 'Наш');
  console.log(`[аккаунты] к прогону: ${accounts.length} — наших ${ours.length}, конкурентов ${accounts.length - ours.length}`);
  if (ours.length) console.log(`[аккаунты] наши: ${ours.map((a) => a.handle).join(', ')}`);
  console.log(`[дедуп] в таблице постов уже ${existing.size} ссылок`);
  console.log(`[apify] актор ${ACTOR}, окно «${newerThan}», лимит ${limit}/аккаунт, пачками по ${batchSize}`);
  console.log(`[apify] потолок стоимости ~$${(accounts.length * limit * 0.0023).toFixed(2)} ` +
    `(фактически меньше — окно отсечёт)${dryRun ? ' · DRY RUN, в CRM не пишем' : ''}`);

  const collectedAt = new Date().toISOString().split('T')[0];
  const allItems = [];
  for (let i = 0; i < accounts.length; i += batchSize) {
    const chunk = accounts.slice(i, i + batchSize);
    process.stdout.write(`[apify] пачка ${Math.floor(i / batchSize) + 1}: ${chunk.map((a) => a.handle).join(', ')} … `);
    try {
      const items = await runActor(token, chunk.map((a) => a.url), limit, newerThan);
      console.log(`${items.length} items`);
      allItems.push(...items);
    } catch (e) {
      console.log('ОШИБКА');
      console.error(`  ${e.message}`);
    }
  }

  if (allItems.length === 0) {
    console.error('[apify] датасет пуст — проверь URL профилей и окно onlyPostsNewerThan');
    process.exit(1);
  }

  // Дедуп: против уже записанного в CRM и внутри самого датасета.
  const seen = new Set();
  const fresh = [];
  let dupCrm = 0;
  let dupBatch = 0;
  let noUrl = 0;
  for (const item of allItems) {
    const row = mapItem(item, collectedAt, typeByHandle);
    if (!row.post_url) { noUrl += 1; continue; }
    if (existing.has(row.post_url)) { dupCrm += 1; continue; }
    if (seen.has(row.post_url)) { dupBatch += 1; continue; }
    seen.add(row.post_url);
    fresh.push(row);
  }

  const byAccount = fresh.reduce((acc, r) => {
    const key = `${r.source_handle || '—'}${r.account_type ? '' : ' (не в реестре)'}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const freshOurs = fresh.filter((r) => r.account_type === 'Наш').length;
  console.log(`\n[итог] получено ${allItems.length}, новых ${fresh.length}, ` +
    `дублей в CRM ${dupCrm}, дублей в датасете ${dupBatch}, без URL ${noUrl}`);
  console.log(`[итог] из новых: наших ${freshOurs}, конкурентов ${fresh.filter((r) => r.account_type === 'Конкурент').length}, ` +
    `без привязки к реестру ${fresh.filter((r) => !r.account_type).length}`);
  console.log('[итог] новых постов по аккаунтам:');
  Object.entries(byAccount).sort((a, b) => b[1] - a[1])
    .forEach(([h, n]) => console.log(`  ${h}: ${n}`));

  if (dryRun) {
    console.log('\n--- сырые ключи первого item\'а (сверяем карту полей) ---');
    console.log(Object.keys(allItems[0]).join(', '));
    // inputUrl подтверждён не по схеме актора, а только живым прогоном:
    // если его нет, source_handle падает обратно на ownerUsername и коллабы
    // снова теряют привязку к реестру.
    console.log(`inputUrl в датасете: ${'inputUrl' in allItems[0] ? 'ЕСТЬ' : 'НЕТ — source_handle падает на ownerUsername'}`);
    console.log('\n--- первые 3 строки после маппинга ---');
    console.log(JSON.stringify(fresh.slice(0, 3), null, 2));
    console.log('\nDRY RUN: в CRM ничего не записано. Убери --dry-run для реальной заливки.');
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const row of fresh) {
    const r = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row),
    });
    if (r.ok) ok += 1;
    else {
      failed += 1;
      console.error(`[crm] ${r.status} на ${row.post_url}: ${(await r.text()).slice(0, 200)}`);
    }
  }
  console.log(`[crm] записано строк: ${ok}, ошибок: ${failed}`);
}

// Явный exit: пул БД держит event loop открытым.
main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
