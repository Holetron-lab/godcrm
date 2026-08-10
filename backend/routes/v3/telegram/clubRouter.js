// backend/routes/v3/telegram/clubRouter.js
// Anti-Marketing Marketing Club — internal staging group (chat -1003802092483).
//
// The owner posts into forum topics here instead of straight into the channels.
// This module:
//   1. Auto-learns topic thread_ids into a runtime registry (data/club-topics.json)
//      via a short "marker word" calibration handshake.
//   2. Runs the kitchen automation: any post starting with 🍳 is dubbed to EN
//      and published — RU original → @godcrm, EN dub → @god_crm.
//   3. Swallows everything else so the bot stops spamming the staging group.
//
// Routing marker (frozen with @marketer): 🍳 at the start === kitchen, regardless
// of which topic it lands in. The thread registry is for voice/twitter routing
// and discovery, not a hard gate on the kitchen path.

import fs from 'fs/promises';
import path from 'path';
import { apiLogger, sendMessage } from './shared.js';
import { sendChannelPost, sendChannelPostEN } from '../../../services/TelegramService.js';
import { translateToEnglish } from '../../../services/translate/translateToEnglish.js';

// Staging group chat id. Overridable via env; default is the discovered
// "ANTIMARKETING MARKETING CLUB" supergroup.
export const CLUB_CHAT_ID = process.env.TELEGRAM_CLUB_CHAT_ID || '-1003802092483';

const REGISTRY_PATH = path.resolve(process.cwd(), 'data', 'club-topics.json');

// marker word(s) → topic key. Checked most-specific first so "radar" and
// "twitter-stage" don't collide. A calibration message is a SHORT bare marker
// (not a real post) — see isCalibration().
const CALIBRATION = [
  { key: 'twitter_radar', words: ['radar', 'радар', 'twitter-radar', 'twitter radar'] },
  { key: 'twitter_stage', words: ['twitter-stage', 'twitter stage', 'twitter', 'твиттер'] },
  { key: 'bluesky',       words: ['bluesky', 'блюскай', 'блускай', 'bsky'] },
  { key: 'kitchen_in',    words: ['kitchen', 'кухня', 'кухн'] },
  { key: 'voice_in',      words: ['voice', 'my voice', 'голос', 'личное'] },
];

const KITCHEN_RE = /^\s*🍳/u;

let _registry = null;            // { kitchen_in: 123, ... }
const _processed = new Set();    // chatId:messageId dedup (process lifetime)

async function loadRegistry() {
  if (_registry) return _registry;
  try {
    const raw = await fs.readFile(REGISTRY_PATH, 'utf8');
    _registry = JSON.parse(raw);
  } catch {
    _registry = {};
  }
  return _registry;
}

async function saveRegistry() {
  try {
    await fs.mkdir(path.dirname(REGISTRY_PATH), { recursive: true });
    await fs.writeFile(REGISTRY_PATH, JSON.stringify(_registry, null, 2));
  } catch (err) {
    apiLogger.error({ err: err.message, REGISTRY_PATH }, '[Club] failed to persist topic registry');
  }
}

/**
 * Resolve a calibrated club topic thread_id by registry key (e.g. 'bluesky').
 * Reads FRESH from disk on every call: the MCP-tool process and the webhook
 * process are separate, so the in-memory `_registry` cache can be stale after
 * an out-of-band calibration. The file is the shared source of truth, and this
 * is only hit on manual drips — the re-read cost is negligible.
 * @param {string} key
 * @returns {Promise<number|null>} thread_id, or null if not calibrated
 */
export async function getClubTopicThread(key) {
  try {
    const reg = JSON.parse(await fs.readFile(REGISTRY_PATH, 'utf8'));
    const id = reg[key];
    return typeof id === 'number' ? id : null;
  } catch {
    return null;
  }
}

/** A bare short marker word used to calibrate a topic (not a real post). */
function matchCalibration(text) {
  const t = text.trim().toLowerCase();
  if (t.length === 0 || t.length > 30) return null;
  if (KITCHEN_RE.test(text)) return null; // a 🍳 post is content, not calibration
  for (const { key, words } of CALIBRATION) {
    if (words.some((w) => t === w || t.startsWith(w))) return key;
  }
  return null;
}

/**
 * Handle a message in the Anti-Marketing Marketing Club staging group.
 * Returns true if the message was consumed (caller must stop processing).
 * @param {object} message - Telegram message object
 * @returns {Promise<boolean>}
 */
export async function handleClubMessage(message) {
  const from = message.from || {};
  // Ignore service/bot/channel-signed noise
  if (from.is_bot || message.sender_chat) return true;

  const threadId = message.message_thread_id ?? null;
  const text = (message.text || message.caption || '').trim();
  const dedupKey = `${message.chat.id}:${message.message_id}`;

  // Discovery log — always record the thread_id so topic ids are recoverable.
  apiLogger.info(
    { chatId: String(message.chat.id), threadId, textSample: text.substring(0, 60) },
    '[Club] message in staging group'
  );

  if (!text) return true;
  if (_processed.has(dedupKey)) return true;
  _processed.add(dedupKey);
  if (_processed.size > 2000) _processed.clear(); // crude bound

  const registry = await loadRegistry();

  // ── Kitchen automation: 🍳 anywhere a kitchen post lands ──────────────
  if (KITCHEN_RE.test(text)) {
    if (threadId && registry.kitchen_in !== threadId) {
      registry.kitchen_in = threadId; // bonus: learn the kitchen topic from real use
      await saveRegistry();
    }
    await runKitchen(message, text, threadId);
    return true;
  }

  // ── Calibration handshake: short marker word links a topic ────────────
  const calKey = matchCalibration(text);
  if (calKey) {
    const prev = registry[calKey];
    registry[calKey] = threadId;
    await saveRegistry();
    apiLogger.info({ calKey, threadId, prev }, '[Club] topic calibrated');
    await reply(message,
      `✅ topic ${calKey} linked → thread ${threadId ?? 'general'}` +
      (prev && prev !== threadId ? ` (was ${prev})` : '')
    );
    return true;
  }

  // ── Voice lane: a real post in the voice topic → adapt & publish ──────
  // Symmetric with kitchen, but uses the 'voice' profile (adaptation, no
  // footer). The backend has the FULL text here, so the dub never depends on
  // the agent reading a truncated log. Gated on the calibrated voice topic so
  // stray chatter elsewhere doesn't publish.
  if (threadId != null && registry.voice_in != null && registry.voice_in === threadId) {
    await runVoice(message, text, threadId);
    return true;
  }

  // ── Everything else in the club is staging — swallow, don't spam ──────
  apiLogger.debug({ threadId, textSample: text.substring(0, 40) }, '[Club] staging message — no auto-route');
  return true;
}

/** Run the kitchen pipeline: RU → @godcrm, EN dub → @god_crm. */
async function runKitchen(message, ruText, threadId) {
  apiLogger.info({ threadId, len: ruText.length }, '[Club] kitchen post — translating');

  // Kitchen posts are raw, unfiltered prose — stray *, _, ` chars are routine
  // and would crash Telegram's Markdown parser ("can't find end of entity").
  // Send as plain text (parse_mode dropped); no formatting is expected here.
  const PLAIN = { parse_mode: undefined };

  const ru = await sendChannelPost(ruText, PLAIN);
  const translation = await translateToEnglish(ruText, 'kitchen');

  if (!translation.success) {
    apiLogger.error({ error: translation.error }, '[Club] kitchen translation failed');
    await reply(message,
      `⚠️ RU ${ru.success ? 'опубликован' : 'НЕ опубликован'}, но перевод упал: ${translation.error}`
    );
    return;
  }

  const en = await sendChannelPostEN(translation.text, PLAIN);

  apiLogger.info(
    { ruOk: ru.success, ruMsgId: ru.messageId, enOk: en.success, enMsgId: en.messageId },
    '[Club] kitchen published'
  );

  await reply(message,
    `🍳 кухня улетела:\n` +
    `• RU → @godcrm ${ru.success ? '✅' : '❌ ' + (ru.error || '')}\n` +
    `• EN → @god_crm ${en.success ? '✅' : '❌ ' + (en.error || '')}`
  );
}

/** Run the voice pipeline: RU original → @godcrm, EN adaptation → @god_crm. */
async function runVoice(message, ruText, threadId) {
  apiLogger.info({ threadId, len: ruText.length }, '[Club] voice post — adapting');

  // Voice posts are personal prose — same stray-markdown hazard as kitchen.
  // Send plain text (parse_mode dropped); the channel shows the post as written.
  const PLAIN = { parse_mode: undefined };

  const ru = await sendChannelPost(ruText, PLAIN);
  const translation = await translateToEnglish(ruText, 'voice');

  if (!translation.success) {
    apiLogger.error({ error: translation.error }, '[Club] voice translation failed');
    await reply(message,
      `⚠️ RU ${ru.success ? 'опубликован' : 'НЕ опубликован'}, но адаптация упала: ${translation.error}`
    );
    return;
  }

  const en = await sendChannelPostEN(translation.text, PLAIN);

  apiLogger.info(
    { ruOk: ru.success, ruMsgId: ru.messageId, enOk: en.success, enMsgId: en.messageId },
    '[Club] voice published'
  );

  // Twitter staging: drop a tweet-shaped EN adaptation into the twitter_stage
  // topic so the owner can copy it into X by hand (no autopost API). Best-effort
  // — a twitter hiccup must never mask a successful channel publish, so its
  // status is reported but failure does not abort.
  const tw = await stageTweet(message, ruText, threadId);

  await reply(message,
    `🗣 войс улетел:\n` +
    `• RU → @godcrm ${ru.success ? '✅' : '❌ ' + (ru.error || '')}\n` +
    `• EN → @god_crm ${en.success ? '✅' : '❌ ' + (en.error || '')}\n` +
    `• 🐦 twitter-stage ${tw.staged ? '✅' : tw.skipped ? '— (топик не привязан)' : '❌ ' + (tw.error || '')}`
  );
}

/**
 * Stage a tweet-shaped EN adaptation of a post into the twitter_stage topic.
 * Manual lane: the owner copies it into X himself (Twitter has no autopost API).
 * @returns {Promise<{staged?: boolean, skipped?: boolean, error?: string}>}
 */
async function stageTweet(message, ruText, sourceThreadId) {
  const registry = await loadRegistry();
  const threadId = registry.twitter_stage;
  if (threadId == null) {
    apiLogger.debug('[Club] twitter_stage not calibrated — skipping tweet staging');
    return { skipped: true };
  }
  // Don't echo a tweet back into the twitter topic itself if a voice post ever
  // originates there — avoids a self-feeding loop.
  if (threadId === sourceThreadId) return { skipped: true };

  const tw = await translateToEnglish(ruText, 'twitter');
  if (!tw.success) {
    apiLogger.error({ error: tw.error }, '[Club] twitter staging translation failed');
    return { error: tw.error };
  }

  // Tweet text is raw lowercase prose — stray *, _, ` would crash Markdown.
  // Send plain text into the topic (parse_mode dropped).
  const sent = await sendMessage(
    String(message.chat.id),
    `🐦 твит — скопируй в X:\n\n${tw.text}`,
    { message_thread_id: threadId, parse_mode: undefined }
  );

  if (!sent.success) {
    apiLogger.error({ err: sent.error, threadId }, '[Club] tweet staging send failed');
    return { error: sent.error };
  }
  apiLogger.info({ threadId, len: tw.text.length }, '[Club] tweet staged');
  return { staged: true };
}

/** Reply inside the originating topic (keeps status next to the source post). */
async function reply(message, text) {
  // Plain text: status lines carry channel handles like @god_crm whose '_'
  // opens an unterminated Markdown entity ("can't find end of entity"), which
  // silently dropped the status reply itself. No formatting is needed here.
  const opts = { parse_mode: undefined };
  if (message.message_thread_id) opts.message_thread_id = message.message_thread_id;
  try {
    await sendMessage(String(message.chat.id), text, opts);
  } catch (err) {
    apiLogger.error({ err: err.message }, '[Club] reply failed');
  }
}
