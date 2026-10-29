/**
 * ADR-204 Stage 2 — reversible value/config adapters, legacy type → new key.
 *
 *   image | audio          → content   (gallery | audio mode)
 *   email | phone          → contact   (one external element)
 *   user  | person         → contact   UNSUPPORTED until the user-value format
 *                                      on the target data is confirmed (open
 *                                      question to the architect, ticket 254364)
 *
 * Pure: nothing here touches the DB. The media kind of a URL is a DB question,
 * so `forward` takes an async `kindOf(url)` resolver (media-kind.js in
 * production, a stub in tests).
 *
 * Reversibility (ADR-204 §Adapter invariants): every forward result carries an
 * `artifact` = { present, value? } — the ORIGINAL JSON value plus whether the
 * key existed at all. `undo(artifact)` returns exactly that. Because the
 * artifact is the untouched original, null / absent key / "" / [] / "  " all
 * survive the round trip; nothing is trimmed, re-joined, or reparsed on the
 * way back. Forward output is the minimal new form; the artifact, not the
 * output, is what carries unknown fields, duplicates, and original ordering.
 *
 * Outcomes:
 *   convertible  — a target value was produced
 *   empty        — null / absent / "" / [] / blank: target value is null
 *   already      — value is already in the target form (idempotent re-run)
 *   ambiguous    — left as legacy; `reason` says why (never silently guessed)
 *   unsupported  — the adapter itself refuses this source type
 */

import { CONTENT_KINDS } from '../../../shared/column-types.js';

export const CONVERTIBLE = 'convertible';
export const EMPTY = 'empty';
export const ALREADY = 'already';
export const AMBIGUOUS = 'ambiguous';
export const UNSUPPORTED = 'unsupported';

const TARGET_BY_SOURCE = Object.freeze({
  image: 'content', audio: 'content',
  email: 'contact', phone: 'contact', user: 'contact', person: 'contact',
});

/** @returns {'content'|'contact'|null} */
export function targetTypeFor(sourceType) {
  return TARGET_BY_SOURCE[sourceType] ?? null;
}

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

const artifactOf = (present, value) => (present ? { present: true, value } : { present: false });

const result = (status, artifact, extra = {}) => ({ status, artifact, ...extra });

function isEmptyLegacy(present, value) {
  if (!present || value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  return Array.isArray(value) && value.length === 0;
}

// ─── content ────────────────────────────────────────────────────────────────

// Same keys as src/features/tables/components/cells/attachmentValue.ts — the
// display parser's address rules, reused rather than re-invented.
const URL_KEYS = ['url', 'path', 'src', 'file', 'filename', 'href'];

function urlFromObject(obj) {
  for (const key of URL_KEYS) {
    const candidate = obj[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

function isContentItem(item) {
  return isPlainObject(item) && typeof item.url === 'string' && item.url.length > 0 &&
    CONTENT_KINDS.includes(item.kind);
}

const isAbsolute = (s) => /^(https?:)?\/\//i.test(s) || s.startsWith('/') || s.startsWith('data:');

/**
 * Split a confirmed comma list. A comma inside a URL (Cloudinary transforms,
 * query strings) cannot be told apart from a separator by the display parser,
 * so the split is accepted only when every segment is a self-contained
 * address: non-empty, no whitespace, and not a relative fragment riding
 * behind an absolute first segment or carrying query syntax.
 * @returns {string[]|null} null = ambiguous
 */
function splitConfirmedList(str) {
  const parts = str.split(',').map((s) => s.trim());
  if (parts.some((p) => p === '' || /\s/.test(p))) return null;
  if (parts.length === 1) return parts;
  const firstAbsolute = isAbsolute(parts[0]);
  for (const p of parts) {
    if (/[?=&]/.test(p) && !isAbsolute(p)) return null;
    if (firstAbsolute && !isAbsolute(p)) return null;
  }
  return parts;
}

/** Legacy image value → ordered list of addresses, or an ambiguity reason. */
function imageAddresses(value) {
  if (typeof value === 'string') {
    const str = value.trim();
    if (str.startsWith('[') || str.startsWith('{')) {
      try { return imageAddresses(JSON.parse(str)); } catch { /* not JSON: fall through to list */ }
    }
    const parts = splitConfirmedList(str);
    return parts ? { urls: parts } : { reason: 'comma-separated string with an ambiguous split' };
  }
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === 'string')) {
      return value.some((v) => !v.trim()) ? { reason: 'array contains an empty address' } : { urls: value.map((v) => v.trim()) };
    }
    if (value.every(isPlainObject)) {
      const ordered = value.map((obj, index) => ({ obj, index })).sort((a, b) => {
        const mainDiff = Number(Boolean(b.obj.main)) - Number(Boolean(a.obj.main));
        if (mainDiff !== 0) return mainDiff;
        const oa = typeof a.obj.order === 'number' ? a.obj.order : Number.POSITIVE_INFINITY;
        const ob = typeof b.obj.order === 'number' ? b.obj.order : Number.POSITIVE_INFINITY;
        return oa !== ob ? oa - ob : a.index - b.index;
      });
      const urls = ordered.map(({ obj }) => urlFromObject(obj));
      return urls.includes(null) ? { reason: 'object without a recognisable address key' } : { urls };
    }
    return { reason: 'array mixes strings, objects or nested values' };
  }
  if (isPlainObject(value)) {
    const url = urlFromObject(value);
    return url ? { urls: [url] } : { reason: 'object without a recognisable address key' };
  }
  return { reason: `${typeof value} is not an address` };
}

async function toContentItems(urls, kindOf, forcedKind) {
  const items = [];
  for (const url of urls) {
    // Reasons never carry the address: they are aggregated into reports.
    const resolved = await kindOf(url);
    if (forcedKind) {
      if (resolved && resolved !== forcedKind) return { reason: `address resolves to ${resolved}, not ${forcedKind}` };
      items.push({ url, kind: forcedKind });
    } else {
      if (!resolved) return { reason: 'media kind cannot be determined (unknown MIME/extension)' };
      items.push({ url, kind: resolved });
    }
  }
  return { items };
}

async function forwardImage(value, present, { kindOf }) {
  const artifact = artifactOf(present, value);
  if (isEmptyLegacy(present, value)) return result(EMPTY, artifact, { value: null });
  if (Array.isArray(value) && value.every(isContentItem)) return result(ALREADY, artifact, { value });
  const addresses = imageAddresses(value);
  if (addresses.reason) return result(AMBIGUOUS, artifact, { reason: addresses.reason });
  const converted = await toContentItems(addresses.urls, kindOf, null);
  if (converted.reason) return result(AMBIGUOUS, artifact, { reason: converted.reason });
  return result(CONVERTIBLE, artifact, { value: converted.items });
}

async function forwardAudio(value, present, { kindOf }) {
  const artifact = artifactOf(present, value);
  if (isEmptyLegacy(present, value)) return result(EMPTY, artifact, { value: null });
  if (Array.isArray(value) && value.every(isContentItem)) return result(ALREADY, artifact, { value });
  // One address, never a comma list: a comma in an audio URL stays a comma.
  if (typeof value !== 'string') return result(AMBIGUOUS, artifact, { reason: `${typeof value} is not an audio address` });
  const converted = await toContentItems([value.trim()], kindOf, 'audio');
  if (converted.reason) return result(AMBIGUOUS, artifact, { reason: converted.reason });
  return result(CONVERTIBLE, artifact, { value: converted.items });
}

// ─── contact ────────────────────────────────────────────────────────────────

const isContactItem = (item) => isPlainObject(item) && (item.kind === 'external' || item.kind === 'linked');

function forwardScalarContact(field) {
  return async (value, present) => {
    const artifact = artifactOf(present, value);
    if (isEmptyLegacy(present, value)) return result(EMPTY, artifact, { value: null });
    if (Array.isArray(value) && value.every(isContactItem)) return result(ALREADY, artifact, { value });
    // Number and string never mix: a numeric-looking phone stored as a number
    // has already lost its leading zeros/plus; it is not ours to re-invent.
    if (typeof value !== 'string') return result(AMBIGUOUS, artifact, { reason: `${typeof value} is not a ${field} string` });
    // The exact stored string: no trim, no lower-case, no user lookup.
    return result(CONVERTIBLE, artifact, { value: [{ kind: 'external', fields: { [field]: value } }] });
  };
}

const USER_UNSUPPORTED = 'user → contact: source, id format, cardinality and referent of user values are not confirmed on target data (ADR-204 §Contact adapter)';

async function forwardUser(value, present) {
  return result(UNSUPPORTED, artifactOf(present, value), { reason: USER_UNSUPPORTED });
}

// ─── config ─────────────────────────────────────────────────────────────────

const forwardContentConfig = (mode) => (config) => {
  const cfg = isPlainObject(config) ? config : {};
  if (isPlainObject(cfg.content) && cfg.content.version === 1) return cfg; // idempotent
  return { ...cfg, content: { version: 1, mode } };
};

const forwardContactConfig = (config) => {
  const cfg = isPlainObject(config) ? config : {};
  if (isPlainObject(cfg.contact) && cfg.contact.version === 1) return cfg;
  return { ...cfg, contact: { version: 1 } };
};

// ─── registry ───────────────────────────────────────────────────────────────

const ADAPTERS = Object.freeze({
  image: { target: 'content', forward: forwardImage, forwardConfig: forwardContentConfig('gallery') },
  audio: { target: 'content', forward: forwardAudio, forwardConfig: forwardContentConfig('audio') },
  email: { target: 'contact', forward: forwardScalarContact('email'), forwardConfig: forwardContactConfig },
  phone: { target: 'contact', forward: forwardScalarContact('phone'), forwardConfig: forwardContactConfig },
  // `unsupported` blocks the column as a whole — even with zero rows there is
  // no mapping to publish.
  user: { target: 'contact', forward: forwardUser, forwardConfig: (c) => c, unsupported: USER_UNSUPPORTED },
  person: { target: 'contact', forward: forwardUser, forwardConfig: (c) => c, unsupported: USER_UNSUPPORTED },
});

/** @returns {{target: string, forward: Function, forwardConfig: Function, unsupported?: string}|null} */
export function getAdapter(sourceType) {
  return ADAPTERS[sourceType] ?? null;
}

/**
 * Forward one cell. `present` distinguishes an absent key from a null value.
 * @param {string} sourceType
 * @param {boolean} present
 * @param {unknown} value
 * @param {{ kindOf: (url: string) => Promise<string|null> }} ctx
 */
export async function forward(sourceType, present, value, ctx) {
  const adapter = getAdapter(sourceType);
  if (!adapter) return result(UNSUPPORTED, artifactOf(present, value), { reason: `no adapter for ${sourceType}` });
  return adapter.forward(value, present, ctx);
}

/** Exact inverse: the original value and whether the key existed. */
export function undo(artifact) {
  return artifact.present ? { present: true, value: artifact.value } : { present: false };
}
