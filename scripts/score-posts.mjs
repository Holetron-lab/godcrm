#!/usr/bin/env node
/**
 * Скоринг постов конкурентов: таблица «Посты конкурентов» (100852).
 *
 * Читает посты и реестр аккаунтов (100851) только на чтение, считает три метрики
 * и печатает отчёт + JSON-патч для записи через API (писать напрямую в БД нельзя).
 *
 *   ER %        = (лайки + W×комментарии) / подписчики × 100      — вовлечённость
 *   Индекс      = ER поста / медианный ER своего аккаунта          — «выбился из нормы»
 *   View Rate % = просмотры / подписчики × 100                     — только Reels/Video
 *   Score       = round(Индекс × 50)                               — норма аккаунта = 50
 *
 * Почему Индекс, а не ER: ER системно падает с ростом аудитории, поэтому рейтинг
 * по ER — это рейтинг аккаунтов по размеру, а не рейтинг постов. Индекс нормирует
 * пост на собственную норму аккаунта, и мелкий сравним с крупным напрямую.
 *
 * Запуск:
 *   node scripts/score-posts.mjs                 # отчёт
 *   node scripts/score-posts.mjs --json          # + JSON-патч для batch_update_rows
 *   node scripts/score-posts.mjs --top 15        # сколько постов показать с подписями
 */

import { ACCOUNTS_TABLE, POSTS_TABLE, loadRows } from './lib/crm-target.mjs';

/** Вес комментария в реакциях. Комментарии — медианных ~3% от реакций,
 *  на топе W=0..10 ничего не меняет; берём 3 и не спорим. */
const W_COMMENT = 3;
/** Минимум постов на аккаунт для расчёта Индекса: медиана по 1–2 постам
 *  равна самому посту, Индекс вырождается в 1.00. */
const MIN_POSTS = 5;

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return (!v || v.startsWith('--')) ? true : v;
}

const handleFromUrl = (u) => (String(u).match(/instagram\.com\/([^/?#]+)/i)?.[1] || u).toLowerCase();
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null)));

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {

  const accRows = await loadRows(ACCOUNTS_TABLE);
  const followers = new Map();
  const accType = new Map();
  for (const r of accRows) {
    const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    const url = (d.url_профиля || '').trim();
    if (!url) continue;
    followers.set(handleFromUrl(url), num(d.подписчики));
    accType.set(handleFromUrl(url), d.тип_аккаунта || 'Конкурент');
  }

  const postRows = await loadRows(POSTS_TABLE);
  const posts = postRows.map((r) => {
    const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    // source_handle — чья лента (ставит ингест); competitor — автор поста.
    // У коллабов они расходятся, и норма аккаунта считается по ленте, а не по соавтору.
    const handle = String(d.source_handle || d.competitor || '').toLowerCase();
    const likes = num(d.likes);
    const comments = num(d.comments) ?? 0;
    const subs = followers.get(handle) ?? null;
    const reactions = likes === null ? null : likes + W_COMMENT * comments;
    const er = (reactions !== null && subs) ? (reactions / subs) * 100 : null;
    const views = num(d.views);
    return {
      rowId: r.id,
      handle,
      inRegistry: followers.has(handle),
      side: accType.get(handle) ?? null,
      subs,
      type: d.post_type || '—',
      date: d.post_date || null,
      likes,
      comments,
      views,
      url: d.post_url || null,
      caption: d.caption || '',
      er,
      viewRate: (views && subs) ? (views / subs) * 100 : null,
    };
  });

  // Медианный ER по аккаунту — норма, от которой считается Индекс.
  const byAccount = new Map();
  for (const p of posts) {
    if (p.er === null) continue;
    if (!byAccount.has(p.handle)) byAccount.set(p.handle, []);
    byAccount.get(p.handle).push(p.er);
  }
  const norm = new Map();
  for (const [h, ers] of byAccount) {
    if (ers.length >= MIN_POSTS) norm.set(h, median(ers));
  }

  for (const p of posts) {
    p.index = (p.er !== null && norm.has(p.handle) && norm.get(p.handle) > 0)
      ? p.er / norm.get(p.handle) : null;
    p.score = p.index === null ? null : Math.round(p.index * 50);
  }

  // ── Отчёт ────────────────────────────────────────────────────────────────
  const scored = posts.filter((p) => p.index !== null);
  const noSubs = posts.filter((p) => !p.inRegistry);
  const hiddenLikes = posts.filter((p) => p.inRegistry && p.likes === null);
  const thin = posts.filter((p) => p.inRegistry && p.likes !== null && !norm.has(p.handle));

  console.log(`\n=== ПОКРЫТИЕ ===`);
  console.log(`всего постов: ${posts.length} | с Индексом: ${scored.length} | без: ${posts.length - scored.length}`);
  console.log(`  нет в реестре (коллабы): ${noSubs.length} → ${[...new Set(noSubs.map((p) => p.handle))].join(', ') || '—'}`);
  console.log(`  скрытые лайки (-1 → null): ${hiddenLikes.length} → ${[...new Set(hiddenLikes.map((p) => p.handle))].join(', ') || '—'}`);
  console.log(`  мало истории (<${MIN_POSTS} постов): ${thin.length} → ${[...new Set(thin.map((p) => p.handle))].join(', ') || '—'}`);

  console.log(`\n=== НОРМА АККАУНТОВ (медианный ER, порог ≥${MIN_POSTS}) ===`);
  const accStats = [...byAccount.entries()].map(([h, ers]) => ({
    handle: h, posts: ers.length, subs: followers.get(h) ?? null,
    medianER: median(ers), counted: norm.has(h),
  })).sort((a, b) => b.posts - a.posts);
  for (const a of accStats) {
    const side = accType.get(a.handle) === 'Наш' ? '🏠 наш' : (accType.has(a.handle) ? 'конкурент' : '—');
    console.log(`${a.counted ? '✓' : '·'} ${a.handle.padEnd(22)} ${side.padEnd(10)} постов ${String(a.posts).padStart(3)} | подписчиков ${String(a.subs ?? '—').padStart(8)} | медиана ER ${a.medianER.toFixed(3)}%`);
  }

  console.log(`\n=== ТИПЫ ПОСТОВ (медианный Индекс) ===`);
  const byType = new Map();
  for (const p of scored) {
    if (!byType.has(p.type)) byType.set(p.type, []);
    byType.get(p.type).push(p.index);
  }
  for (const [t, xs] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${t.padEnd(10)} n=${String(xs.length).padStart(3)} медиана ${median(xs).toFixed(2)}`);
  }

  const topN = Number(arg('top', 12)) || 12;
  console.log(`\n=== ТОП-${topN} ПО ИНДЕКСУ (все даты) ===`);
  for (const p of [...scored].sort((a, b) => b.index - a.index).slice(0, topN)) {
    console.log(`\n[${p.index.toFixed(2)}] score=${p.score} ${p.type} ${p.date} @${p.handle} ♥${p.likes} 💬${p.comments}${p.viewRate ? ` 👁${p.viewRate.toFixed(0)}%` : ''}`);
    console.log(`  ${p.url}`);
    console.log(`  ${p.caption.replace(/\s+/g, ' ').slice(0, 500)}`);
  }

  if (arg('json')) {
    const updates = posts.map((p) => ({
      row_id: p.rowId,
      data: {
        // Бэкфилл для строк, залитых до появления флага. source_handle не трогаем:
        // у старых строк его не восстановить (в пейлоаде не было inputUrl),
        // и записать туда competitor значило бы зацементировать соавтора коллаба.
        account_type: p.side,
        er_pct: p.er === null ? null : Number(p.er.toFixed(3)),
        index_score: p.index === null ? null : Number(p.index.toFixed(2)),
        view_rate: p.viewRate === null ? null : Number(p.viewRate.toFixed(1)),
        score: p.score,
      },
    }));
    console.log(`\n=== JSON (${updates.length}) ===`);
    console.log(JSON.stringify(updates));
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
