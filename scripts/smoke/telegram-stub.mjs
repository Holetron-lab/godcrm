// Smoke stub for TelegramService — captures sends instead of hitting the Bot API.
// Used by the dev_report smoke so the full generation pipeline runs end-to-end
// (git log → ADR timings → claude CLI → ---SPLIT--- → markdown sanitize) WITHOUT
// anything reaching the public @godcrm / @god_crm channels.
const captured = [];
globalThis.__SMOKE_TG__ = captured;

export async function sendMessage(chatId, text, options = {}) {
  captured.push({ via: 'sendMessage', chatId, message_thread_id: options.message_thread_id, parse_mode: options.parse_mode, text });
  return { success: true, messageId: 'SMOKE', skipped: false };
}
export async function sendChannelPost(text, options = {}) {
  captured.push({ via: 'sendChannelPost', chatId: process.env.TELEGRAM_CHANNEL_ID || '@godcrm', parse_mode: options.parse_mode, text });
  return { success: true, messageId: 'SMOKE', skipped: false };
}
export async function sendChannelPostEN(text, options = {}) {
  captured.push({ via: 'sendChannelPostEN', chatId: '@god_crm', parse_mode: options.parse_mode, text });
  return { success: true, messageId: 'SMOKE', skipped: false };
}
export async function sendAdminAlert() { return { success: true, skipped: true }; }
export async function sendToTopic() { return { success: true, skipped: true }; }
export default { sendMessage, sendChannelPost, sendChannelPostEN, sendAdminAlert, sendToTopic };
