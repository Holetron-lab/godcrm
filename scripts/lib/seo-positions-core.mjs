/**
 * Чистая логика съёма SEO-позиций через Yandex Cloud Search API v2 (без I/O).
 * Используется scripts/seo-positions.mjs; покрыта scripts/__tests__/seo-positions-core.test.mjs.
 *
 * Регионы — Search API «Search regions»: 213 Москва, 2 Санкт-Петербург.
 * «БГ (без региона)» = параметр region не передаётся вовсе; по докам региональная
 * корректировка ранжирования тогда не применяется. Это не «нейтральная» выдача
 * в смысле IP: фактическая геопривязка на стороне Яндекса не гарантирована.
 */

export const REGIONS = {
  msk: { id: '213', label: 'Москва', pos: 'pos_msk', url: 'url_мск' },
  spb: { id: '2', label: 'Санкт-Петербург', pos: 'pos_spb', url: 'url_спб' },
  bg: { id: null, label: 'без региона', pos: 'pos_bg', url: 'url_бг' },
};

export const MAX_GROUPS_ON_PAGE = 100; // лимит FORMAT_XML по докам (1–100)

/** Тело запроса WebSearch.Search для одной страницы выдачи (нумерация с 0). */
export function buildRequest({ keyword, regionId, page, groupsOnPage }) {
  const body = {
    query: { searchType: 'SEARCH_TYPE_RU', queryText: keyword, page, fixTypoMode: 'FIX_TYPO_MODE_OFF' },
    groupSpec: { groupMode: 'GROUP_MODE_FLAT', groupsOnPage, docsInGroup: 1 },
    responseFormat: 'FORMAT_XML',
  };
  if (regionId) body.region = String(regionId);
  return body;
}

const decodeXml = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/**
 * Разбор XML-ответа: { error: {code, text} | null, docs: [{url, domain}] }.
 * Порядок docs = порядок групп в выдаче (GROUP_MODE_FLAT → 1 документ в группе).
 */
export function parseYandexXml(xml) {
  const err = xml.match(/<error\s+code="(\d+)"[^>]*>([\s\S]*?)<\/error>/);
  if (err) return { error: { code: Number(err[1]), text: decodeXml(err[2]).trim() }, docs: [] };
  const docs = [];
  for (const m of xml.matchAll(/<doc\b[^>]*>([\s\S]*?)<\/doc>/g)) {
    const url = m[1].match(/<url>([\s\S]*?)<\/url>/)?.[1];
    if (!url) continue;
    docs.push({ url: decodeXml(url).trim(), domain: m[1].match(/<domain>([\s\S]*?)<\/domain>/)?.[1]?.trim() ?? null });
  }
  return { error: null, docs };
}

/** Нормализованный hostname: нижний регистр, без завершающей точки и ведущего www. */
export function normalizeHost(input) {
  let host = String(input || '').trim().toLowerCase();
  if (host.includes('/') || host.includes(':')) {
    try { host = new URL(host.includes('://') ? host : `https://${host}`).hostname; } catch { return null; }
  }
  return host.replace(/\.$/, '').replace(/^www\./, '') || null;
}

/**
 * Политика совпадения: точный hostname после нормализации (www прозрачен);
 * поддомены считаются только при subdomains=true. Подстрока не совпадает:
 * notsixtynine.ru ≠ sixtynine.ru.
 */
export function hostMatches(url, domain, { subdomains = false } = {}) {
  const host = normalizeHost(url);
  const target = normalizeHost(domain);
  if (!host || !target) return false;
  return host === target || (subdomains && host.endsWith(`.${target}`));
}

/**
 * Первый документ домена среди docs страницы; offset — число документов на
 * предыдущих страницах. Возвращает { position, url } или null.
 */
export function findPosition(docs, domain, { offset = 0, subdomains = false } = {}) {
  const idx = docs.findIndex((d) => hostMatches(d.url, domain, { subdomains }));
  return idx === -1 ? null : { position: offset + idx + 1, url: docs[idx].url };
}

/** Разбивка глубины на страницы API: depth=150 → [100, 50]. */
export function pagePlan(depth) {
  const d = Math.max(1, Math.floor(Number(depth) || 0));
  const plan = [];
  for (let left = d; left > 0; left -= MAX_GROUPS_ON_PAGE) plan.push(Math.min(left, MAX_GROUPS_ON_PAGE));
  return plan;
}

/** Текст для колонки pos_* таблицы 100854. */
export function formatPos(result) {
  if (result.status === 'found') return String(result.position);
  if (result.status === 'not_found') return `не найдено в ${result.checked}`;
  return `ошибка: ${result.error}`;
}

/** Числовое значение для колонки pos_* (number): позиция или null (не найдено / ошибка). */
export function positionValue(result) {
  return result.status === 'found' ? result.position : null;
}

// ── Динамика и отложенный съём (документ 239321) ─────────────────────────────

export const ASYNC_URL = 'https://searchapi.api.cloud.yandex.net/v2/web/searchAsync';
export const OPERATION_URL = 'https://operation.api.cloud.yandex.net/operations/';

/** Тариф, ₽ с НДС за 1000 запросов — aistudio.yandex.ru/ru/docs/search-api/pricing, проверен 02.10.2026. */
export const PRICE_PER_1000 = { sync: { day: 488, night: 366 }, async: { day: 30.5, night: 25.41 } };

/** Ночное окно тарифа: 00:00:00–07:59:59 по Москве (UTC+3). */
export function isNightMsk(date = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Moscow' }).format(date));
  return hour < 8;
}

/** Оценка расхода до запуска: { requests, mode, slot, rate, rub }. */
export function estimateCost({ requests, mode, date = new Date() }) {
  const slot = isNightMsk(date) ? 'night' : 'day';
  const rate = PRICE_PER_1000[mode][slot];
  return { requests, mode, slot, rate, rub: Math.round((requests * rate) / 10) / 100 };
}

/**
 * Подпись методики замера. Два замера сопоставимы (стрелка считается) только при
 * одинаковой подписи; смена глубины/региона/политики hostname = новая база сравнения.
 */
export function methodSignature({ regionId, depth, subdomains }) {
  return `v2 ru flat/${MAX_GROUPS_ON_PAGE} region=${regionId || '-'} depth=${depth} subdomains=${subdomains ? 1 : 0} www=transparent`;
}

/** Разбор ответа GET operations/{id}: { done:false } | { done:true, error } | { done:true, rawData }. */
export function parseOperation(op) {
  if (!op || typeof op !== 'object' || !op.done) return { done: false };
  if (op.error) return { done: true, error: `operation ${op.error.code ?? '?'}: ${op.error.message ?? JSON.stringify(op.error)}` };
  return { done: true, rawData: op.response?.rawData || '' };
}

/** Служебная ячейка dyn_<регион> (JSON-строка или объект) → объект; мусор → {}. */
export function parseSidecar(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

const COMPLETED = new Set(['found', 'not_found']);

/**
 * Применить результат замера к служебной ячейке региона.
 *
 * Ячейка: { status, position, depth, checked, url, at, received_at, run_id, method,
 *           prev: { position, status, depth, checked, at, run_id } | null,
 *           error, error_at, pending, baseline_reset }
 *
 * Правила (239321): ошибка API не трогает последнюю успешную позицию, только
 * записывает error/error_at; повтор того же run_id и поздний ответ более старого
 * запуска не применяются; prev = последний завершённый сопоставимый замер,
 * при смене методики prev сбрасывается (baseline_reset).
 * meta: { at — время отправки запроса, receivedAt, runId, method, depth }.
 * Возвращает { cell, applied }.
 */
export function applyResult(previous, result, meta) {
  const cell = { ...parseSidecar(previous), pending: null };
  if (result.status === 'api_error') {
    return { cell: { ...cell, error: result.error, error_at: meta.receivedAt ?? meta.at }, applied: false };
  }
  const completed = COMPLETED.has(cell.status);
  if (completed && (cell.run_id === meta.runId || (cell.at && meta.at < cell.at))) return { cell, applied: false };
  const comparable = completed && cell.method === meta.method;
  return {
    applied: true,
    cell: {
      status: result.status,
      position: positionValue(result),
      depth: meta.depth,
      checked: result.checked ?? null,
      url: result.status === 'found' ? result.url : null,
      at: meta.at,
      received_at: meta.receivedAt ?? meta.at,
      run_id: meta.runId,
      method: meta.method,
      prev: comparable
        ? { position: cell.position ?? null, status: cell.status, depth: cell.depth ?? null, checked: cell.checked ?? null, at: cell.at, run_id: cell.run_id }
        : null,
      error: null,
      error_at: null,
      pending: null,
      ...(completed && !comparable ? { baseline_reset: true } : {}),
    },
  };
}
