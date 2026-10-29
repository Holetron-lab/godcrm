// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildRequest, parseYandexXml, normalizeHost, hostMatches, findPosition, pagePlan, formatPos,
} from '../lib/seo-positions-core.mjs';

const doc = (url) => `<group><doccount>1</doccount><doc id="Z1"><url>${url}</url><domain>${new URL(url).hostname}</domain><title>t</title></doc></group>`;
const wrap = (inner) => `<?xml version="1.0"?><yandexsearch version="1.0"><response><results><grouping mode="flat"><page first="1" last="3">0</page>${inner}</grouping></results></response></yandexsearch>`;

describe('parseYandexXml', () => {
  it('returns docs in SERP order with decoded urls', () => {
    const xml = wrap(doc('https://www.ozon.ru/a?x=1&amp;y=2') + doc('https://sixtynine.ru/catalog') + doc('https://m.sixtynine.ru/'));
    const { error, docs } = parseYandexXml(xml);
    expect(error).toBeNull();
    expect(docs.map((d) => d.url)).toEqual(['https://www.ozon.ru/a?x=1&y=2', 'https://sixtynine.ru/catalog', 'https://m.sixtynine.ru/']);
    expect(docs[0].domain).toBe('www.ozon.ru');
  });

  it('surfaces the API error element instead of an empty page', () => {
    const xml = '<yandexsearch><response><error code="15">Искомая комбинация слов нигде не встречается</error></response></yandexsearch>';
    const { error, docs } = parseYandexXml(xml);
    expect(error).toEqual({ code: 15, text: 'Искомая комбинация слов нигде не встречается' });
    expect(docs).toEqual([]);
  });
});

describe('hostname policy', () => {
  it('normalizes www, case, trailing dot and full urls', () => {
    expect(normalizeHost('WWW.SixtyNine.ru.')).toBe('sixtynine.ru');
    expect(normalizeHost('https://www.sixtynine.ru/x?y')).toBe('sixtynine.ru');
    expect(normalizeHost('')).toBeNull();
  });

  it('matches exact host and www, rejects substrings and subdomains by default', () => {
    expect(hostMatches('https://www.sixtynine.ru/p', 'sixtynine.ru')).toBe(true);
    expect(hostMatches('https://notsixtynine.ru/p', 'sixtynine.ru')).toBe(false);
    expect(hostMatches('https://sixtynine.ru.evil.com/', 'sixtynine.ru')).toBe(false);
    expect(hostMatches('https://m.sixtynine.ru/', 'sixtynine.ru')).toBe(false);
  });

  it('counts subdomains only when the policy allows', () => {
    expect(hostMatches('https://m.sixtynine.ru/', 'sixtynine.ru', { subdomains: true })).toBe(true);
    expect(hostMatches('https://notsixtynine.ru/', 'sixtynine.ru', { subdomains: true })).toBe(false);
  });
});

describe('findPosition / pagination', () => {
  const docs = [{ url: 'https://a.ru/' }, { url: 'https://notsixtynine.ru/' }, { url: 'https://www.sixtynine.ru/c' }];

  it('returns 1-based position plus page offset and the matched url', () => {
    expect(findPosition(docs, 'sixtynine.ru')).toEqual({ position: 3, url: 'https://www.sixtynine.ru/c' });
    expect(findPosition(docs, 'sixtynine.ru', { offset: 100 })).toEqual({ position: 103, url: 'https://www.sixtynine.ru/c' });
  });

  it('returns null when the domain is absent', () => {
    expect(findPosition(docs, 'absent.ru')).toBeNull();
  });

  it('splits depth into API pages of at most 100 groups', () => {
    expect(pagePlan(50)).toEqual([50]);
    expect(pagePlan(100)).toEqual([100]);
    expect(pagePlan(150)).toEqual([100, 50]);
    expect(pagePlan(0)).toEqual([1]);
  });
});

describe('buildRequest', () => {
  it('omits region for the no-region mode and pins flat grouping + XML', () => {
    const msk = buildRequest({ keyword: 'q', regionId: '213', page: 1, groupsOnPage: 50 });
    expect(msk.region).toBe('213');
    expect(msk.query).toMatchObject({ searchType: 'SEARCH_TYPE_RU', queryText: 'q', page: 1 });
    expect(msk.groupSpec).toEqual({ groupMode: 'GROUP_MODE_FLAT', groupsOnPage: 50, docsInGroup: 1 });
    expect(msk.responseFormat).toBe('FORMAT_XML');
    expect('region' in buildRequest({ keyword: 'q', regionId: null, page: 0, groupsOnPage: 10 })).toBe(false);
  });
});

describe('formatPos', () => {
  it('distinguishes found / not found in N / api error', () => {
    expect(formatPos({ status: 'found', position: 7 })).toBe('7');
    expect(formatPos({ status: 'not_found', checked: 50 })).toBe('не найдено в 50');
    expect(formatPos({ status: 'api_error', error: 'HTTP 429' })).toBe('ошибка: HTTP 429');
  });
});

// ── динамика, отложенный режим, стоимость (документ 239321) ──────────────────
import {
  methodSignature, applyResult, parseSidecar, parseOperation, estimateCost, isNightMsk, positionValue,
} from '../lib/seo-positions-core.mjs';

const M = methodSignature({ regionId: '213', depth: 50, subdomains: false });
const meta = (at, runId = `run-${at}`, extra = {}) => ({ at, receivedAt: at, runId, method: M, depth: 50, ...extra });

describe('methodSignature', () => {
  it('changes with region, depth and the subdomain policy', () => {
    expect(methodSignature({ regionId: '213', depth: 50, subdomains: false })).toBe(M);
    expect(methodSignature({ regionId: '2', depth: 50, subdomains: false })).not.toBe(M);
    expect(methodSignature({ regionId: '213', depth: 100, subdomains: false })).not.toBe(M);
    expect(methodSignature({ regionId: '213', depth: 50, subdomains: true })).not.toBe(M);
    expect(methodSignature({ regionId: null, depth: 50, subdomains: false })).toContain('region=-');
  });
});

describe('applyResult (служебная ячейка dyn_*)', () => {
  const found = (position, checked = 50) => ({ status: 'found', position, url: 'https://sixtynine.ru/p', checked });
  const notFound = (checked = 50) => ({ status: 'not_found', checked });

  it('first measurement has no previous value', () => {
    const { cell, applied } = applyResult(null, found(5), meta('2026-10-01T20:00:00Z'));
    expect(applied).toBe(true);
    expect(cell).toMatchObject({ status: 'found', position: 5, prev: null, pending: null, error: null, at: '2026-10-01T20:00:00Z', method: M });
  });

  it('shifts the last completed comparable measurement into prev', () => {
    const a = applyResult(null, found(5), meta('2026-10-01T20:00:00Z')).cell;
    const b = applyResult(a, found(4), meta('2026-10-02T20:00:00Z')).cell;
    expect(b.position).toBe(4);
    expect(b.prev).toEqual({ position: 5, status: 'found', depth: 50, checked: 50, at: '2026-10-01T20:00:00Z', run_id: 'run-2026-10-01T20:00:00Z' });
  });

  it('starts a new baseline when the method changes', () => {
    const a = applyResult(null, found(5), meta('2026-10-01T20:00:00Z')).cell;
    const b = applyResult(a, found(4), meta('2026-10-02T20:00:00Z', 'r2', { method: 'other' })).cell;
    expect(b.prev).toBeNull();
    expect(b.baseline_reset).toBe(true);
  });

  it('keeps the last successful position on api_error and records the error', () => {
    const a = applyResult(null, found(5), meta('2026-10-01T20:00:00Z')).cell;
    const { cell, applied } = applyResult(a, { status: 'api_error', error: 'HTTP 429' }, meta('2026-10-02T20:00:00Z'));
    expect(applied).toBe(false);
    expect(cell).toMatchObject({ status: 'found', position: 5, at: '2026-10-01T20:00:00Z', error: 'HTTP 429', error_at: '2026-10-02T20:00:00Z', pending: null });
  });

  it('ignores a late response of an older run', () => {
    const a = applyResult(null, found(5), meta('2026-10-02T20:00:00Z')).cell;
    const { cell, applied } = applyResult(a, found(9), meta('2026-10-01T20:00:00Z'));
    expect(applied).toBe(false);
    expect(cell.position).toBe(5);
    expect(cell.prev).toBeNull();
  });

  it('treats a replay of the same run_id as no new measurement', () => {
    const a = applyResult(null, found(3), meta('2026-10-01T20:00:00Z', 'same')).cell;
    const { cell, applied } = applyResult(a, found(4), meta('2026-10-01T20:00:05Z', 'same'));
    expect(applied).toBe(false);
    expect(cell.position).toBe(3);
  });

  it('clears pending and stores not_found with the checked depth', () => {
    const pending = { ...parseSidecar(null), pending: { operation_id: 'op1', page: 0, checked: 0 } };
    const { cell } = applyResult(pending, notFound(37), meta('2026-10-02T20:00:00Z'));
    expect(cell).toMatchObject({ status: 'not_found', position: null, checked: 37, pending: null });
  });

  it('parseSidecar tolerates strings, objects and junk', () => {
    expect(parseSidecar('{"position":3}')).toEqual({ position: 3 });
    expect(parseSidecar({ position: 3 })).toEqual({ position: 3 });
    expect(parseSidecar('nope')).toEqual({});
    expect(parseSidecar(null)).toEqual({});
  });

  it('positionValue is a number only for found results', () => {
    expect(positionValue(found(7))).toBe(7);
    expect(positionValue(notFound())).toBeNull();
    expect(positionValue({ status: 'api_error' })).toBeNull();
  });
});

describe('parseOperation', () => {
  it('distinguishes running, failed and finished operations', () => {
    expect(parseOperation({ id: 'x', done: false })).toEqual({ done: false });
    expect(parseOperation({ id: 'x', done: true, error: { code: 7, message: 'denied' } })).toEqual({ done: true, error: 'operation 7: denied' });
    expect(parseOperation({ id: 'x', done: true, response: { rawData: 'QUJD' } })).toEqual({ done: true, rawData: 'QUJD' });
    expect(parseOperation(null)).toEqual({ done: false });
  });
});

describe('cost estimate', () => {
  it('knows the Moscow night window 00:00–07:59:59', () => {
    expect(isNightMsk(new Date('2026-10-02T21:30:00Z'))).toBe(true);  // 00:30 МСК
    expect(isNightMsk(new Date('2026-10-02T04:59:59Z'))).toBe(true);  // 07:59:59 МСК
    expect(isNightMsk(new Date('2026-10-02T05:00:00Z'))).toBe(false); // 08:00 МСК
    expect(isNightMsk(new Date('2026-10-02T12:00:00Z'))).toBe(false);
  });

  it('prices by mode and slot per 1000 requests', () => {
    expect(estimateCost({ requests: 90000, mode: 'sync', date: new Date('2026-10-02T12:00:00Z') })).toMatchObject({ slot: 'day', rate: 488, rub: 43920 });
    expect(estimateCost({ requests: 90000, mode: 'async', date: new Date('2026-10-02T22:00:00Z') })).toMatchObject({ slot: 'night', rate: 25.41, rub: 2286.9 });
    expect(estimateCost({ requests: 3, mode: 'async', date: new Date('2026-10-02T12:00:00Z') }).rub).toBe(0.09);
  });
});
