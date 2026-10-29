#!/usr/bin/env node
/**
 * Бенчмарк «мы vs рынок»: работает ли контент-стратегия.
 *
 * Читает те же две таблицы, что и скоринг (реестр 100851 + посты 100852), делит
 * аккаунты по колонке «Тип аккаунта» (Наш / Конкурент) и отвечает на три вопроса:
 *
 *   1. ГДЕ МЫ СТОИМ   — медианный ER наших аккаунтов против распределения
 *                       конкурентов. Отдельно — против «своей весовой»: ER
 *                       системно падает с ростом аудитории, поэтому сравнение
 *                       с аккаунтом в 100 раз крупнее ничего не значит.
 *   2. ДВИНУЛИСЬ ЛИ   — посты до и после даты --since (старт стратегии):
 *                       медианный ER, медианный Индекс, View Rate у Reels.
 *   3. ЗА СЧЁТ ЧЕГО   — разбивка по типам постов, наши против рынка.
 *
 * Осторожно с выводами: на десятке постов разница в медианах — это шум.
 * Скрипт сам проставляет пометку «мало данных» там, где n меньше порога,
 * и не выдаёт «стратегия работает» за факт, если выборка не тянет.
 *
 * Запуск:
 *   node scripts/benchmark-own.mjs --since 2026-09-01
 *   node scripts/benchmark-own.mjs --since 2026-09-01 --weight-class 3
 */

import { ACCOUNTS_TABLE, POSTS_TABLE, loadRows } from './lib/crm-target.mjs';

const W_COMMENT = 3;      // вес комментария в реакциях — как в score-posts.mjs
const MIN_POSTS = 5;      // порог истории для нормы аккаунта
const MIN_SAMPLE = 8;     // ниже этого выборку считаем нерепрезентативной

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return (!v || v.startsWith('--')) ? true : v;
}

const handleFromUrl = (u) => (String(u).match(/instagram\.com\/([^/?#]+)/i)?.[1] || u).toLowerCase();
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v
  : (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null)));

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Доля значений выборки, которые меньше x (0..100). */
function percentile(xs, x) {
  if (!xs.length) return null;
  return (xs.filter((v) => v < x).length / xs.length) * 100;
}

const fmt = (v, d = 2, suffix = '') => (v === null || v === undefined ? '—' : v.toFixed(d) + suffix);

function delta(before, after) {
  if (before === null || after === null || before === 0) return null;
  return ((after - before) / before) * 100;
}

async function main() {
  const since = arg('since');
  if (!since || since === true || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    console.error('Нужна дата старта стратегии: --since YYYY-MM-DD');
    process.exit(2);
  }
  const weightClass = Number(arg('weight-class', 3)) || 3;


  // ── Реестр ───────────────────────────────────────────────────────────────
  const accRows = await loadRows(ACCOUNTS_TABLE);
  const accounts = new Map();
  for (const r of accRows) {
    const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    const url = (d.url_профиля || '').trim();
    if (!url) continue;
    accounts.set(handleFromUrl(url), {
      handle: handleFromUrl(url),
      subs: num(d.подписчики),
      side: d.тип_аккаунта || 'Конкурент',
    });
  }
  const ourHandles = [...accounts.values()].filter((a) => a.side === 'Наш').map((a) => a.handle);
  if (!ourHandles.length) {
    console.error(`В реестре ${ACCOUNTS_TABLE} нет ни одной строки с «Тип аккаунта = Наш».`);
    console.error('Заведи свой аккаунт в реестре и проставь тип — без этого бенчмарк не с чем сравнивать.');
    process.exit(1);
  }

  // ── Посты ────────────────────────────────────────────────────────────────
  const postRows = await loadRows(POSTS_TABLE);
  const posts = [];
  for (const r of postRows) {
    const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    const handle = String(d.source_handle || d.competitor || '').toLowerCase();
    const acc = accounts.get(handle);
    if (!acc) continue;                       // коллабы и чужие ленты — вне бенчмарка
    const likes = num(d.likes);
    const comments = num(d.comments) ?? 0;
    const views = num(d.views);
    const reactions = likes === null ? null : likes + W_COMMENT * comments;
    posts.push({
      handle,
      side: acc.side,
      subs: acc.subs,
      type: d.post_type || '—',
      date: d.post_date || null,
      er: (reactions !== null && acc.subs) ? (reactions / acc.subs) * 100 : null,
      viewRate: (views && acc.subs) ? (views / acc.subs) * 100 : null,
    });
  }

  // Норма аккаунта считается по ВСЕЙ истории — иначе «после» сравнивается сам с собой.
  const norm = new Map();
  for (const acc of accounts.values()) {
    const ers = posts.filter((p) => p.handle === acc.handle && p.er !== null).map((p) => p.er);
    if (ers.length >= MIN_POSTS) norm.set(acc.handle, median(ers));
  }
  for (const p of posts) {
    p.index = (p.er !== null && norm.get(p.handle) > 0) ? p.er / norm.get(p.handle) : null;
  }

  const ourPosts = posts.filter((p) => p.side === 'Наш');
  const rivalPosts = posts.filter((p) => p.side !== 'Наш');

  console.log(`\n╔═ БЕНЧМАРК «МЫ vs РЫНОК» ═ старт стратегии: ${since}`);
  console.log(`║ наши аккаунты: ${ourHandles.join(', ')}`);
  console.log(`║ постов в выборке: наших ${ourPosts.length}, конкурентских ${rivalPosts.length}`);
  console.log(`╚═ ER = (лайки + ${W_COMMENT}×комментарии) / подписчики × 100; Индекс = ER поста / медиана аккаунта\n`);

  // ── 1. Где мы стоим ──────────────────────────────────────────────────────
  console.log('=== 1. ГДЕ МЫ СТОИМ ===');
  const rivalMedians = [...accounts.values()]
    .filter((a) => a.side !== 'Наш' && norm.has(a.handle))
    .map((a) => ({ handle: a.handle, subs: a.subs, medianER: norm.get(a.handle) }));

  for (const h of ourHandles) {
    const acc = accounts.get(h);
    const mine = posts.filter((p) => p.handle === h && p.er !== null).map((p) => p.er);
    if (mine.length < MIN_POSTS) {
      console.log(`🏠 ${h}: постов ${mine.length} — меньше порога ${MIN_POSTS}, норма не считается.`);
      console.log('   Спарси свою историю за 3 месяца, иначе сравнивать нечего.\n');
      continue;
    }
    const myER = median(mine);
    const all = rivalMedians.map((r) => r.medianER);
    const peers = rivalMedians.filter((r) => r.subs && acc.subs
      && r.subs <= acc.subs * weightClass && r.subs >= acc.subs / weightClass);

    console.log(`🏠 ${h} · ${acc.subs ?? '—'} подписчиков · постов ${mine.length} · медиана ER ${fmt(myER, 3, '%')}`);
    console.log(`   весь рынок (${all.length} аккаунтов): медиана ${fmt(median(all), 3, '%')} · мы выше ${fmt(percentile(all, myER), 0, '%')} конкурентов`);
    if (peers.length) {
      const pm = peers.map((p) => p.medianER);
      console.log(`   своя весовая ±×${weightClass} (${peers.length}): медиана ${fmt(median(pm), 3, '%')} · мы выше ${fmt(percentile(pm, myER), 0, '%')}`);
      console.log(`   в весовой: ${peers.sort((a, b) => b.medianER - a.medianER).map((p) => `${p.handle} ${p.medianER.toFixed(2)}%`).join(' · ')}`);
    } else {
      console.log(`   своя весовая ±×${weightClass}: пусто — в реестре нет конкурентов сопоставимого размера.`);
      console.log('   Сравнение «весь рынок» тут мало что значит: ER падает с ростом аудитории.');
    }
    console.log('');
  }

  // ── 2. Двинулись ли ──────────────────────────────────────────────────────
  console.log(`=== 2. ДВИНУЛИСЬ ЛИ (до / после ${since}) ===`);
  const split = (arr, key) => ({
    before: arr.filter((p) => p.date && p.date < since && p[key] !== null).map((p) => p[key]),
    after: arr.filter((p) => p.date && p.date >= since && p[key] !== null).map((p) => p[key]),
  });

  for (const [label, arr] of [['🏠 мы', ourPosts], ['🎯 рынок', rivalPosts]]) {
    const er = split(arr, 'er');
    const idx = split(arr, 'index');
    const vr = split(arr.filter((p) => p.type === 'Reel' || p.type === 'Video'), 'viewRate');
    const d = delta(median(er.before), median(er.after));
    console.log(`${label}: постов до ${er.before.length} / после ${er.after.length}`);
    console.log(`   ER      ${fmt(median(er.before), 3, '%')} → ${fmt(median(er.after), 3, '%')}` +
      `${d === null ? '' : `  (${d >= 0 ? '+' : ''}${d.toFixed(0)}%)`}`);
    console.log(`   Индекс  ${fmt(median(idx.before))} → ${fmt(median(idx.after))}   (1.00 = собственная норма)`);
    console.log(`   ViewRate ${fmt(median(vr.before), 0, '%')} → ${fmt(median(vr.after), 0, '%')} (Reels)`);
    if (arr === ourPosts && er.after.length < MIN_SAMPLE) {
      console.log(`   ⚠️  после старта всего ${er.after.length} постов (порог ${MIN_SAMPLE}). ` +
        'Разница в медианах на такой выборке — шум, а не результат стратегии.');
    }
    console.log('');
  }
  console.log('Читать так: «рынок» — контрольная группа. Если ER вырос и у нас, и у рынка —');
  console.log('это сезон или алгоритм Instagram, а не стратегия. Считается только отрыв от рынка.\n');

  // ── 3. За счёт чего ──────────────────────────────────────────────────────
  console.log('=== 3. ЗА СЧЁТ ЧЕГО (медианный Индекс по типам) ===');
  const types = [...new Set(posts.map((p) => p.type))];
  console.log(`${'тип'.padEnd(10)} ${'наши'.padStart(14)} ${'рынок'.padStart(14)}`);
  for (const t of types) {
    const mine = ourPosts.filter((p) => p.type === t && p.index !== null).map((p) => p.index);
    const theirs = rivalPosts.filter((p) => p.type === t && p.index !== null).map((p) => p.index);
    if (!mine.length && !theirs.length) continue;
    console.log(`${t.padEnd(10)} ${`${fmt(median(mine))} (n=${mine.length})`.padStart(14)} ${`${fmt(median(theirs))} (n=${theirs.length})`.padStart(14)}`);
  }
  console.log('\nИндекс нормирован на собственную норму аккаунта, поэтому медиана по рынку ≈1.00');
  console.log('по построению. Смысл несёт разброс по типам: где наш Индекс заметно выше 1 —');
  console.log('там формат вытягивает нас за пределы нашей же нормы.\n');

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
