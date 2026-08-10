// backend/routes/v3/telegramNikitron/config.js
// Shared configuration and constants for NikitronBot

import { apiLogger } from '../../../utils/logger.js';
import { getSecret } from '../../../services/secrets/getSecret.js';

// ===== CONFIGURATION =====
// ADR-0040: NIKITRON_BOT_TOKEN now sourced from vault (env fallback during
// transition). Resolves on first call and caches for the process lifetime.
let _BOT_TOKEN = null;
let _TG_API = null;
let _resolved = false;

async function _ensureBotToken() {
  if (_resolved) return;
  _BOT_TOKEN = (await getSecret('nikitron_bot_token', 'NIKITRON_BOT_TOKEN')) || '';
  _TG_API = `https://api.telegram.org/bot${_BOT_TOKEN}`;
  _resolved = true;
  if (!_BOT_TOKEN) {
    apiLogger.warn('[NikitronBot] nikitron_bot_token not in vault and NIKITRON_BOT_TOKEN not set — bot disabled');
  }
}

export async function getBotToken() {
  await _ensureBotToken();
  return _BOT_TOKEN;
}

export async function getTgApi() {
  await _ensureBotToken();
  return _TG_API;
}

// Merge env whitelist with hardcoded owner IDs (Nikich + GERATRON)
const HARDCODED_IDS = ['331468767', '423753027'];
export const AUTHORIZED_CHAT_IDS = [
  ...(process.env.NIKITRON_CHAT_IDS || process.env.NIKITRON_CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean),
  ...HARDCODED_IDS,
].filter((v, i, a) => a.indexOf(v) === i); // deduplicate
export const BOT_NAME = process.env.NIKITRON_BOT_NAME || 'NikitronBot';
export const NIKITRON_ROOT_ADMIN_ID = String(process.env.NIKITRON_ROOT_ADMIN_ID || '423753027'); // GERATRON
if (AUTHORIZED_CHAT_IDS.length === 0) {
  apiLogger.warn('[NikitronBot] NIKITRON_CHAT_IDS / NIKITRON_CHAT_ID not set — whitelist empty, all users will be allowed');
}

// ===== SESSION STATE =====
export const activeSessions = new Map(); // chatId -> { conversationId, agentUserId, agentName, ... }

// Cache: telegram_user_id → CRM user ID (per-user, NOT singleton)
export const crmUserIdCache = new Map();

// ===== FUN COMMANDS DATA =====
export const JOKES = [
  'Siri, Alexa and Google walk into a bar\nThey start listening.',
  'Why do programmers prefer dark mode?\nBecause light attracts bugs!',
  'There are only 10 types of people in the world:\nthose who understand binary and those who don\'t.',
  'A SQL query walks into a bar, walks up to two tables and asks:\n"Can I join you?"',
  'Why was the JavaScript developer sad?\nBecause he didn\'t Node how to Express himself.',
  'How many programmers does it take to change a light bulb?\nNone, that\'s a hardware problem.',
  'Wife: "Go to the store and buy bread. If they have eggs, buy a dozen."\nProgrammer returned with 12 loaves of bread.',
  'What\'s a programmer\'s favorite hangout place?\nFoo Bar.',
];
