// TelegramService.js
// Telegram Bot API integration for GOD CRM
// Used by: AutomationTriggerService (notification action), errorHandler (500 alerts)

import { apiLogger } from '../utils/logger.js';
import { getSecret } from './secrets/getSecret.js';

// ADR-0040: lazy resolution. BOT_TOKEN now sourced from vault (env fallback
// during transition); `getBotToken()` / `getTgApi()` resolve on first call
// and cache for the process lifetime. The hardcoded fallback only triggers
// when both vault and env are empty.
const HARDCODED_BOT_TOKEN_FALLBACK = '<TELEGRAM_BOT_TOKEN>';
let _BOT_TOKEN = null;
let _TG_API = null;

async function _ensureBotToken() {
  if (_BOT_TOKEN !== null) return;
  _BOT_TOKEN = (await getSecret('telegram_bot_token', 'TELEGRAM_BOT_TOKEN'))
    || HARDCODED_BOT_TOKEN_FALLBACK;
  _TG_API = `https://api.telegram.org/bot${_BOT_TOKEN}`;
}

export async function getBotToken() {
  await _ensureBotToken();
  return _BOT_TOKEN;
}

export async function getTgApi() {
  await _ensureBotToken();
  return _TG_API;
}

const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '423753027';
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || '@godcrm';
const CHANNEL_EN_ID = process.env.TELEGRAM_CHANNEL_EN_ID || '@god_crm';
const GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID || '-1002668749408';

// Forum topic mapping for AUTISM TEAM group
// Category → message_thread_id
const TOPIC_MAP = {
  // ── Core topics (v2, 2026-03-01) ───────────
  fitness:       858,  // 🏋️ Тренировки
  nutrition:     859,  // 🍽️ Питание
  tasks:         860,  // 📋 Задачи
  schedule:      861,  // ⏰ Расписание
  business:      862,  // 💼 Бизнес
  pets:          863,  // 🐕 Питомцы
  creative:      864,  // 🎵 Музыка/Творчество
  together:      865,  // 💑 Вместе
  notes:         866,  // 📝 Заметки
  // ── New topics (v3, 2026-03-01) ────────────
  news:          876,  // 📰 Новости / News
  ai_news:       877,  // 🤖 AI News
  notifications: 878,  // 🔔 Уведомления / CRM
  trainer:       879,  // 🏋️ Тренер / Trainer
  // ── Legacy / system aliases ────────────────
  wellness:      858,  // alias → fitness
  work:          862,  // alias → business
  hobbies:       864,  // alias → creative
  system:        860,  // alias → tasks
  fortune:       861,  // alias → schedule (fortune wheel in schedule topic)
};

const KNOWN_AGENTS = [
  'orchestrator',
  'developer-ralph',
  'developer',
  'frontend',
  'frontend-qa',
  'architect',
  'test-runner',
  'marketer',
  'table-architect',
  'widget-developer',
  'document-agent'
];

// Telegram commands don't allow hyphens, so map underscore variants
const AGENT_ALIASES = {
  'developer_ralph': 'developer-ralph',
  'frontend_qa': 'frontend-qa',
  'test_runner': 'test-runner'
};

// Telegram hard-rejects (does NOT truncate) any sendMessage text over 4096
// chars. Long kitchen/voice dubs silently failed because of this. sendMessage
// now splits oversized text on paragraph/line boundaries and sends the parts
// in order.
export const TG_MAX_LEN = 4096;

/**
 * Split text into <=limit chunks, breaking on line boundaries so prose stays
 * readable. A single line longer than the limit is hard-sliced as a last
 * resort. Text already within the limit returns as a single chunk unchanged.
 * @param {string} text
 * @param {number} [limit=TG_MAX_LEN]
 * @returns {string[]}
 */
export function splitTelegramText(text, limit = TG_MAX_LEN) {
  if (typeof text !== 'string' || text.length <= limit) return [text];
  const chunks = [];
  let buf = '';
  const flush = () => { if (buf.length) { chunks.push(buf); buf = ''; } };
  for (const line of text.split('\n')) {
    if (line.length > limit) {
      flush();
      for (let i = 0; i < line.length; i += limit) chunks.push(line.slice(i, i + limit));
      continue;
    }
    // +1 accounts for the '\n' re-joined between buffered lines
    if (buf.length + (buf.length ? 1 : 0) + line.length > limit) flush();
    buf = buf.length ? buf + '\n' + line : line;
  }
  flush();
  return chunks;
}

/** Single sendMessage API call (no splitting). Internal. */
async function _sendOnce(chatId, text, options = {}) {
  try {
    apiLogger.info({ chatId, textLength: text.length }, 'Telegram: sending message');

    const response = await fetch(`${await getTgApi()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        ...options
      })
    });

    const data = await response.json();

    if (!data.ok) {
      apiLogger.error(
        { chatId, errorCode: data.error_code, description: data.description },
        'Telegram: sendMessage failed'
      );
      return { success: false, error: data.description || 'Unknown Telegram API error' };
    }

    apiLogger.info(
      { chatId, messageId: data.result.message_id },
      'Telegram: message sent'
    );
    return { success: true, messageId: data.result.message_id };
  } catch (err) {
    apiLogger.error(
      { chatId, err: err.message },
      'Telegram: sendMessage exception'
    );
    return { success: false, error: err.message };
  }
}

/**
 * Send a message to a specific chat. Text over 4096 chars is split across
 * several sends (Telegram rejects oversized messages instead of truncating);
 * the return mirrors the FIRST part, preserving the {success, messageId}
 * contract for every caller. Text within the limit sends as a single message,
 * unchanged.
 * @param {string} chatId - Telegram chat ID
 * @param {string} text - Message text (supports Markdown)
 * @param {Object} options - Additional sendMessage options
 * @returns {Promise<{success: boolean, messageId?: number, error?: string}>}
 */
export async function sendMessage(chatId, text, options = {}) {
  const parts = splitTelegramText(text);
  if (parts.length <= 1) return _sendOnce(chatId, text, options);

  apiLogger.info({ chatId, parts: parts.length, textLength: text.length }, 'Telegram: splitting oversized message');
  let firstId = null;
  for (const part of parts) {
    const res = await _sendOnce(chatId, part, options);
    if (!res.success) return res; // surface the first failed part
    if (firstId == null) firstId = res.messageId;
  }
  return { success: true, messageId: firstId };
}

/**
 * Send alert to admin chat
 * @param {string} text - Alert message
 * @returns {Promise<{success: boolean, messageId?: number, error?: string}>}
 */
export async function sendAdminAlert(text) {
  return sendMessage(ADMIN_CHAT_ID, text);
}

/**
 * Send 500 error alert with formatted details
 * @param {Object} errorContext - Error context object
 * @param {string} errorContext.method - HTTP method (GET, POST, etc.)
 * @param {string} errorContext.path - Request path
 * @param {number} errorContext.statusCode - HTTP status code
 * @param {string} errorContext.message - Error message
 * @param {number|string} [errorContext.userId] - User ID that triggered the error
 * @param {string} [errorContext.requestId] - Unique request ID
 * @param {string} [errorContext.stack] - Error stack trace
 * @returns {Promise<{success: boolean, messageId?: number, error?: string}>}
 */
export async function sendErrorAlert(errorContext) {
  const {
    method = 'UNKNOWN',
    path = '/',
    statusCode = 500,
    message = 'Unknown error',
    userId,
    requestId,
    stack
  } = errorContext;

  const timestamp = new Date().toISOString();

  const lines = [
    `\u{1F534} *${statusCode} Error*`,
    `\`${method} ${path}\``,
    '',
    `*Error:* ${escapeMarkdown(message)}`,
  ];

  if (userId !== undefined && userId !== null) {
    lines.push(`*User:* ${userId}`);
  }

  if (requestId) {
    lines.push(`*RequestID:* \`${requestId}\``);
  }

  lines.push(`*Time:* ${timestamp}`);

  if (stack) {
    // Truncate stack to avoid Telegram 4096-char message limit
    const truncatedStack = stack.length > 500 ? stack.substring(0, 500) + '...' : stack;
    lines.push('', `\`\`\`\n${truncatedStack}\n\`\`\``);
  }

  const text = lines.join('\n');

  apiLogger.warn(
    { method, path, statusCode, userId, requestId },
    'Telegram: sending error alert'
  );

  return sendAdminAlert(text);
}

/**
 * Check if a Telegram user is authorized to send commands.
 * Only ADMIN_CHAT_ID is allowed.
 * @param {string|number} userId - Telegram user ID
 * @returns {boolean}
 */
export function isAuthorizedUser(userId) {
  return String(userId) === String(ADMIN_CHAT_ID);
}

/**
 * Parse agent command from message text.
 * Format: /agent_name message   (e.g., /orchestrator check status)
 * Returns: { agent: 'orchestrator', message: 'check status' } or null
 * @param {string} text - Message text
 * @returns {{agent: string, message: string}|null}
 */
export function parseAgentCommand(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  // Match /command_name with optional message after it
  // Agent names may contain hyphens (e.g., developer-ralph, frontend-qa)
  const match = text.match(/^\/([a-z][a-z0-9-]*)\s*(.*)/s);
  if (!match) {
    return null;
  }

  const rawAgent = match[1];
  const message = match[2] ? match[2].trim() : '';

  // Resolve alias (test_runner → test-runner, etc.)
  const agent = AGENT_ALIASES[rawAgent] || rawAgent;

  if (!KNOWN_AGENTS.includes(agent)) {
    apiLogger.debug({ agent, rawAgent, text }, 'Telegram: unknown agent command');
    return null;
  }

  apiLogger.info({ agent, messageLength: message.length }, 'Telegram: parsed agent command');
  return { agent, message };
}

/**
 * Resolve a Telegram file_id to a publicly accessible download URL.
 * Uses the Telegram Bot API getFile endpoint to obtain the file_path,
 * then constructs the full download URL.
 * @param {string} fileId - Telegram file_id
 * @returns {Promise<string|null>} Full download URL or null on failure
 */
export async function getFileUrl(fileId) {
  try {
    const response = await fetch(`${await getTgApi()}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId })
    });
    const data = await response.json();
    if (!data.ok || !data.result?.file_path) {
      apiLogger.error({ fileId, data }, 'Telegram: getFile failed');
      return null;
    }
    return `https://api.telegram.org/file/bot${await getBotToken()}/${data.result.file_path}`;
  } catch (err) {
    apiLogger.error({ fileId, err: err.message }, 'Telegram: getFile exception');
    return null;
  }
}

/**
 * Set up webhook for receiving Telegram updates
 * @param {string} webhookUrl - Full URL to receive updates (e.g., https://devcrm.hltrn.cc/api/v3/telegram/webhook)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function setWebhook(webhookUrl) {
  try {
    apiLogger.info({ webhookUrl }, 'Telegram: setting webhook');

    const response = await fetch(`${await getTgApi()}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message', 'callback_query']
      })
    });

    const data = await response.json();

    if (!data.ok) {
      apiLogger.error(
        { webhookUrl, errorCode: data.error_code, description: data.description },
        'Telegram: setWebhook failed'
      );
      return { success: false, error: data.description || 'Failed to set webhook' };
    }

    apiLogger.info({ webhookUrl }, 'Telegram: webhook set successfully');
    return { success: true };
  } catch (err) {
    apiLogger.error(
      { webhookUrl, err: err.message },
      'Telegram: setWebhook exception'
    );
    return { success: false, error: err.message };
  }
}

/**
 * Get bot info (for testing connection)
 * @returns {Promise<{success: boolean, username?: string, error?: string}>}
 */
export async function getBotInfo() {
  try {
    apiLogger.info('Telegram: fetching bot info');

    const response = await fetch(`${await getTgApi()}/getMe`, {
      method: 'GET'
    });

    const data = await response.json();

    if (!data.ok) {
      apiLogger.error(
        { errorCode: data.error_code, description: data.description },
        'Telegram: getMe failed'
      );
      return { success: false, error: data.description || 'Failed to get bot info' };
    }

    apiLogger.info(
      { username: data.result.username, botId: data.result.id },
      'Telegram: bot info retrieved'
    );
    return { success: true, username: data.result.username };
  } catch (err) {
    apiLogger.error(
      { err: err.message },
      'Telegram: getMe exception'
    );
    return { success: false, error: err.message };
  }
}

/**
 * Escape special Markdown characters in user-provided strings
 * to prevent Telegram parse errors.
 * @param {string} text - Raw text
 * @returns {string} Escaped text safe for Markdown parse_mode
 */
function escapeMarkdown(text) {
  if (!text) return '';
  // Escape characters that have special meaning in Telegram Markdown v1:
  // _ * ` [
  return text.replace(/([_*`\[])/g, '\\$1');
}

/**
 * Post a message to the GOD CRM Telegram channel (@godcrm).
 * @param {string} text - Message text (supports Markdown)
 * @param {Object} options - Additional sendMessage options (reply_markup, disable_web_page_preview, etc.)
 * @returns {Promise<{success: boolean, messageId?: number, error?: string}>}
 */
export async function sendChannelPost(text, options = {}) {
  apiLogger.info({ channelId: CHANNEL_ID, textLength: text.length }, 'Telegram: posting to channel');
  return sendMessage(CHANNEL_ID, text, options);
}

/**
 * Post to English channel (@god_crm).
 */
export async function sendChannelPostEN(text, options = {}) {
  apiLogger.info({ channelId: CHANNEL_EN_ID, textLength: text.length }, 'Telegram: posting to EN channel');
  return sendMessage(CHANNEL_EN_ID, text, options);
}

/**
 * Send a message to a specific forum topic in the group.
 * @param {string} topic - Topic key from TOPIC_MAP (schedule, fitness, nutrition, etc.)
 * @param {string} text - Message text (supports Markdown)
 * @param {Object} options - Additional sendMessage options
 * @returns {Promise<{success: boolean, messageId?: number, error?: string}>}
 */
export async function sendToTopic(topic, text, options = {}) {
  const threadId = TOPIC_MAP[topic];
  if (!threadId) {
    apiLogger.error({ topic }, 'Telegram: unknown topic key');
    return { success: false, error: `Unknown topic: ${topic}` };
  }
  apiLogger.info({ topic, threadId, textLength: text.length }, 'Telegram: sending to forum topic');
  return sendMessage(GROUP_CHAT_ID, text, { message_thread_id: threadId, ...options });
}

/**
 * Send a message to the group (General topic or specific thread).
 * @param {string} text - Message text (supports Markdown)
 * @param {Object} options - Additional options (can include message_thread_id)
 * @returns {Promise<{success: boolean, messageId?: number, error?: string}>}
 */
export async function sendGroupMessage(text, options = {}) {
  apiLogger.info({ groupId: GROUP_CHAT_ID, textLength: text.length }, 'Telegram: sending to group');
  return sendMessage(GROUP_CHAT_ID, text, options);
}

/**
 * Send a photo to a forum topic.
 * @param {string} topic - Topic key from TOPIC_MAP
 * @param {string} photoUrl - Photo URL or file_id
 * @param {string} caption - Photo caption
 * @param {Object} options - Additional sendPhoto options
 * @returns {Promise<{success: boolean, messageId?: number, error?: string}>}
 */
export async function sendPhotoToTopic(topic, photoUrl, caption = '', options = {}) {
  const threadId = TOPIC_MAP[topic];
  if (!threadId) {
    return { success: false, error: `Unknown topic: ${topic}` };
  }
  try {
    const response = await fetch(`${await getTgApi()}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: GROUP_CHAT_ID,
        photo: photoUrl,
        caption,
        parse_mode: 'Markdown',
        message_thread_id: threadId,
        ...options
      })
    });
    const data = await response.json();
    if (!data.ok) {
      return { success: false, error: data.description };
    }
    return { success: true, messageId: data.result.message_id };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Get available topic keys and their thread IDs.
 * @returns {Object} TOPIC_MAP copy
 */
export function getTopicMap() {
  return { ...TOPIC_MAP };
}

/**
 * Post a photo to the GOD CRM Telegram channel.
 * @param {string} photoUrl - URL or file_id of the photo
 * @param {string} caption - Photo caption (supports Markdown)
 * @param {Object} options - Additional sendPhoto options
 * @returns {Promise<{success: boolean, messageId?: number, error?: string}>}
 */
export async function sendChannelPhoto(photoUrl, caption = '', options = {}) {
  try {
    apiLogger.info({ channelId: CHANNEL_ID, captionLength: caption.length }, 'Telegram: posting photo to channel');

    const response = await fetch(`${await getTgApi()}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHANNEL_ID,
        photo: photoUrl,
        caption,
        parse_mode: 'Markdown',
        ...options
      })
    });

    const data = await response.json();

    if (!data.ok) {
      apiLogger.error(
        { channelId: CHANNEL_ID, errorCode: data.error_code, description: data.description },
        'Telegram: sendPhoto to channel failed'
      );
      return { success: false, error: data.description || 'Unknown Telegram API error' };
    }

    return { success: true, messageId: data.result.message_id };
  } catch (err) {
    apiLogger.error({ err: err.message }, 'Telegram: sendPhoto to channel exception');
    return { success: false, error: err.message };
  }
}

/**
 * Send a photo from buffer to channel (used by ScreenshotService)
 * @param {Buffer} photoBuffer - Photo as Buffer
 * @param {string} caption - Photo caption
 * @param {object} options - Additional options
 * @returns {Promise<{success: boolean, messageId?: number, error?: string}|null>}
 */
export async function sendChannelPhotoBuffer(photoBuffer, caption = '', options = {}) {
  const botToken = await getBotToken();
  if (!botToken) {
    apiLogger.error('Telegram: BOT_TOKEN not set');
    return null;
  }

  try {
    apiLogger.info({ channelId: CHANNEL_ID, captionLength: caption.length, bufferSize: photoBuffer.length }, 'Telegram: posting photo buffer to channel');

    const formData = new FormData();
    formData.append('chat_id', CHANNEL_ID);
    formData.append('photo', new Blob([photoBuffer], { type: 'image/png' }), 'screenshot.png');
    if (caption) {
      formData.append('caption', caption);
      formData.append('parse_mode', options.parseMode || 'HTML');
    }

    const response = await fetch(`${await getTgApi()}/sendPhoto`, {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (!data.ok) {
      apiLogger.error(
        { channelId: CHANNEL_ID, errorCode: data.error_code, description: data.description },
        'Telegram: sendChannelPhotoBuffer failed'
      );
      return { success: false, error: data.description || 'Unknown Telegram API error' };
    }

    apiLogger.info({ messageId: data.result.message_id }, 'Telegram: photo buffer sent to channel');
    return { success: true, messageId: data.result.message_id };
  } catch (err) {
    apiLogger.error({ err: err.message }, 'Telegram: sendChannelPhotoBuffer exception');
    return { success: false, error: err.message };
  }
}

/**
 * Get channel member count for analytics.
 * @returns {Promise<{success: boolean, count?: number, error?: string}>}
 */
export async function getChannelMemberCount() {
  try {
    const response = await fetch(`${await getTgApi()}/getChatMemberCount`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHANNEL_ID })
    });

    const data = await response.json();

    if (!data.ok) {
      return { success: false, error: data.description };
    }

    return { success: true, count: data.result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export default {
  sendMessage,
  sendAdminAlert,
  sendErrorAlert,
  sendChannelPost,
  sendChannelPostEN,
  sendChannelPhoto,
  sendChannelPhotoBuffer,
  sendToTopic,
  sendGroupMessage,
  sendPhotoToTopic,
  getTopicMap,
  getChannelMemberCount,
  isAuthorizedUser,
  parseAgentCommand,
  getFileUrl,
  setWebhook,
  getBotInfo,
  getBotToken,
  getTgApi,
  ADMIN_CHAT_ID,
  CHANNEL_ID,
  CHANNEL_EN_ID,
  GROUP_CHAT_ID,
  TOPIC_MAP
};
