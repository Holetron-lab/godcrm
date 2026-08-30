/**
 * Room vocabulary (ADR-193) — canonicalise the room an agent typed.
 *
 * The problem this closes: an agent writes `room: "деплой"` and the engine
 * stores it verbatim (`classify_room_hall()` only runs when `room is None`), so
 * a room comes into existence because somebody typed it and the next caller
 * never finds out. The store already shows the drift — 17 rooms in circulation,
 * five of them outside every dictionary we have.
 *
 * The decision (ADR-193, Variant C): the column stays canonical, what the agent
 * actually typed rides along as a tag. This module is only the resolver; tag
 * minting lives next to the author tags in memory-tools.js.
 *
 * The synonym map is NOT invented here — `ROOM_HINTS` already maps
 * `deploy → deployment`, it just never had a write-side call site.
 */

import { ROOMS, ROOM_HINTS } from './scopeRouter.js';

/**
 * Rooms that exist in the live store but are absent from `ROOMS`. They are
 * legitimate — agents created them deliberately and 1 350 facts live in
 * `shared` alone — so resolution must recognise them instead of flagging every
 * write to them as a brand-new room.
 *
 * Note `shared`, `orchestrator` and `chat` are identity/visibility words rather
 * than topics; ADR-193 keeps them readable but does not promote them into the
 * canonical topic vocabulary.
 */
export const LIVE_ROOMS = ['shared', 'marketing', 'orchestrator', 'gateway', 'chat'];

/**
 * Russian synonyms — a hand-written list, deliberately NOT transliteration.
 * Transliteration (`деплой` → `deploy`) fires on words that are not rooms at
 * all, and a mis-route is irreversible: the engine has no path to move a fact
 * between rooms. ~30 hand-checked pairs cover the traffic we actually see.
 */
export const RU_ALIASES = {
  деплой: 'deployment', деплоймент: 'deployment', выкатка: 'deployment', раскатка: 'deployment', релиз: 'deployment',
  инфра: 'infrastructure', инфраструктура: 'infrastructure', сервер: 'infrastructure', сервера: 'infrastructure',
  схема: 'schema', миграция: 'schema', миграции: 'schema',
  авторизация: 'auth', аутентификация: 'auth', доступ: 'auth', вход: 'auth',
  фронт: 'ui', фронтенд: 'ui', интерфейс: 'ui', вёрстка: 'ui', верстка: 'ui',
  апи: 'api', эндпоинт: 'api',
  мониторинг: 'monitoring', логи: 'monitoring', метрики: 'monitoring',
  агент: 'agent', агенты: 'agent', промпт: 'agent', промпты: 'agent', память: 'agent',
  налоги: 'tax', ндс: 'tax', бухгалтерия: 'tax',
  юридическое: 'legal', договор: 'legal', договоры: 'legal',
  кадры: 'hr', найм: 'hr', зарплата: 'hr',
  комплаенс: 'compliance', аудит: 'compliance',
  пайплайн: 'pipeline', воронка: 'pipeline', сделка: 'pipeline', сделки: 'pipeline',
  маркетинг: 'marketing', общее: 'general',
};

// hint → room, inverted once from ROOM_HINTS. A hint that is itself a canonical
// room name is skipped: step 1 resolves it first, so keeping it here would only
// make the map look like it decides something it never decides.
//
// Prototype-free on purpose. A plain object answers `map['constructor']` with
// Object.prototype.constructor — a truthy function — so `room: "constructor"`
// would resolve to a function, JSON.stringify would drop it, and the write
// would silently land with no room at all. Same reason lookups below go
// through Object.hasOwn().
const HINT_ALIASES = Object.create(null);
for (const [room, hints] of Object.entries(ROOM_HINTS)) {
  for (const hint of hints) {
    if (ROOMS.includes(hint)) continue;
    if (!(hint in HINT_ALIASES)) HINT_ALIASES[hint] = room; // first room wins, deterministically
  }
}

/**
 * Unicode-safe room normalisation.
 *
 * `normaliseAuthor()` cannot be reused: its `[^a-z0-9]+` collapses `деплой`
 * into the empty string — the exact case ADR-193 exists for. So: NFC, trim,
 * lowercase, whitespace/underscores → `-`, and nothing is stripped for being
 * non-ASCII.
 *
 * Case folding is not cosmetic. The tag corpus already carries the twins this
 * prevents — `adr-165` 1782 vs `ADR-165` 210.
 */
export function normaliseRoom(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .normalize('NFC')
    .trim()
    .replace(/^[@#/]+/, '')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** True when `a` and `b` are at most one insert/delete/substitution apart. */
function withinOneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    if (edits) return false;
    edits = 1;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else { i += 1; j += 1; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Resolve a typed room to its canonical form.
 *
 * The ladder runs deterministic → risky, first hit wins:
 *   1. `canon`  — exact match against ROOMS
 *   2. `hint`   — ROOM_HINTS synonym (deploy → deployment)
 *   3. `live`   — a room that exists in the store but not in the dictionary
 *   4. `ru`     — hand-written Russian synonym
 *   5. `fuzzy`  — one edit away, ≥5 chars, UNAMBIGUOUS — off unless asked for
 *   6. `new`    — nothing matched: the string becomes its own room, and the
 *                 caller is expected to mark it `room-new:` and warn. Flexibility
 *                 is real and stays; what changes is that creating a room is now
 *                 a visible act rather than a silent one.
 *
 * Fuzzy is off by default on purpose: resolution happens at write time and the
 * engine cannot move a fact between rooms afterwards, so a wrong guess is
 * permanent. `room-alias:` will accumulate the real typo distribution first;
 * then a threshold can be set on data instead of on taste.
 *
 * @param {string} typed - the room as the caller wrote it
 * @param {{liveRooms?: string[], fuzzy?: boolean}} [opts]
 * @returns {{room: string|null, alias: string|null, source: string}}
 *   `alias` is the normalised typed form, and is set ONLY when it differs from
 *   the resolved room — an exact canonical write leaves no alias trail.
 */
export function resolveRoom(typed, opts = {}) {
  const normalised = normaliseRoom(typed);
  if (!normalised) return { room: null, alias: null, source: 'empty' };

  const liveRooms = opts.liveRooms || LIVE_ROOMS;
  const decided = (room, source) => ({
    room,
    alias: room === normalised ? null : normalised,
    source,
  });

  if (ROOMS.includes(normalised)) return decided(normalised, 'canon');
  if (Object.hasOwn(HINT_ALIASES, normalised)) return decided(HINT_ALIASES[normalised], 'hint');
  if (liveRooms.includes(normalised)) return decided(normalised, 'live');
  if (Object.hasOwn(RU_ALIASES, normalised)) return decided(RU_ALIASES[normalised], 'ru');

  if (opts.fuzzy && normalised.length >= 5) {
    const hits = new Set();
    for (const [candidate, room] of [
      ...ROOMS.map((r) => [r, r]),
      ...liveRooms.map((r) => [r, r]),
      ...Object.entries(HINT_ALIASES),
      ...Object.entries(RU_ALIASES),
    ]) {
      if (candidate.length >= 5 && withinOneEdit(normalised, candidate)) hits.add(room);
    }
    // Two plausible targets is not a typo we get to guess at.
    if (hits.size === 1) return decided([...hits][0], 'fuzzy');
  }

  return decided(normalised, 'new');
}
