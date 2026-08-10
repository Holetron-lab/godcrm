// backend/routes/v3/telegramNikitron/shared.js
// Telegram API helpers, auth, and attachment extraction

import { apiLogger } from '../../../utils/logger.js';
import {
  getBotToken, getTgApi, AUTHORIZED_CHAT_IDS,
} from './config.js';

// ===== TELEGRAM API =====

export async function sendMessage(chatId, text, options = {}) {
  const botToken = await getBotToken();
  if (!botToken) return { success: false, error: 'Bot token not configured' };
  try {
    const response = await fetch(`${await getTgApi()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        ...options,
      }),
    });
    const data = await response.json();
    if (!data.ok) {
      apiLogger.error({ chatId, errorCode: data.error_code, description: data.description }, '[NikitronBot] sendMessage failed');
      return { success: false, error: data.description };
    }
    return { success: true, messageId: data.result.message_id };
  } catch (err) {
    apiLogger.error({ chatId, err: err.message }, '[NikitronBot] sendMessage exception');
    return { success: false, error: err.message };
  }
}

export async function sendTyping(chatId) {
  try {
    await fetch(`${await getTgApi()}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
    });
  } catch (_) { /* ignore */ }
}

export function isAuthorizedUser(userId) {
  // If no whitelist configured, allow all users (bot token is the security boundary)
  if (AUTHORIZED_CHAT_IDS.length === 0) return true;
  return AUTHORIZED_CHAT_IDS.includes(String(userId));
}

export async function getFileUrl(fileId) {
  try {
    const response = await fetch(`${await getTgApi()}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    });
    const data = await response.json();
    if (!data.ok || !data.result?.file_path) return null;
    return `https://api.telegram.org/file/bot${await getBotToken()}/${data.result.file_path}`;
  } catch (_) {
    return null;
  }
}

// Extract media attachments from Telegram message
export async function extractAttachments(message) {
  const attachments = [];
  try {
    if (message.photo && message.photo.length > 0) {
      const photo = message.photo[message.photo.length - 1];
      const url = await getFileUrl(photo.file_id);
      if (url) attachments.push({ type: 'image', name: `photo_${photo.file_id}.jpg`, url, size: photo.file_size || 0, telegram_file_id: photo.file_id });
    }
    if (message.document) {
      const url = await getFileUrl(message.document.file_id);
      if (url) attachments.push({ type: message.document.mime_type || 'file', name: message.document.file_name || 'file', url, size: message.document.file_size || 0, telegram_file_id: message.document.file_id });
    }
    if (message.voice) {
      const url = await getFileUrl(message.voice.file_id);
      if (url) attachments.push({ type: 'voice', name: `voice.ogg`, url, size: message.voice.file_size || 0, duration: message.voice.duration, telegram_file_id: message.voice.file_id });
    }
    if (message.video) {
      const url = await getFileUrl(message.video.file_id);
      if (url) attachments.push({ type: 'video', name: message.video.file_name || 'video.mp4', url, size: message.video.file_size || 0, duration: message.video.duration, telegram_file_id: message.video.file_id });
    }
  } catch (err) {
    apiLogger.error({ err }, '[NikitronBot] Failed to extract attachments');
  }
  return attachments;
}
