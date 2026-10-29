/**
 * Telegram Tool Handlers
 *
 * Handles: send_telegram_message
 * Wraps TelegramService functions for agent/MCP use.
 */

import { sendChannelPost, sendChannelPostEN, sendToTopic, sendGroupMessage, getTopicMap, sendMessage } from '../TelegramService.js';
import { CLUB_CHAT_ID, getClubTopicThread } from '../../routes/v3/telegram/clubRouter.js';
import { aiLogger } from '../../utils/logger.js';

/**
 * Telegram tool handlers
 */
export const telegramToolHandlers = {
  /**
   * Send a message to a Telegram destination (channel, topic, or group).
   */
  async send_telegram_message({ destination, text, parse_mode = 'Markdown' }) {
    if (!destination) return { error: 'destination is required (e.g. "channel", "group", or a topic key like "news", "notifications")' };
    if (!text) return { error: 'text is required' };

    const options = {};
    if (parse_mode) options.parse_mode = parse_mode;

    try {
      // ── Anti-Marketing Club forum topic (e.g. "club_bluesky") ──────────
      // Drips into a calibrated topic in the club staging group. The thread_id
      // is learned by clubRouter calibration, not hardcoded. Sent as PLAIN text
      // (no parse_mode) — these dead-pan posts carry stray _ * ` that would
      // crash Telegram's Markdown parser, matching the kitchen/voice precedent.
      if (destination.startsWith('club_')) {
        const key = destination.slice('club_'.length);
        const threadId = await getClubTopicThread(key);
        if (threadId == null) {
          return { error: `Club topic "${key}" is not calibrated yet. Post the marker word "${key}" once into that topic so the router learns its thread_id, then retry.` };
        }
        const sent = await sendMessage(CLUB_CHAT_ID, text, { message_thread_id: threadId });
        if (!sent.success) return { error: sent.error || 'Failed to send to club topic' };
        return { success: true, message_id: sent.messageId, destination, text_length: text.length };
      }

      // ── Private chat by numeric chat_id (e.g. "tg:423753027") ──────────
      // On-request reports to a person's DM. Telegram only lets the bot write
      // to users who pressed /start on it; that refusal comes back verbatim.
      if (destination.startsWith('tg:')) {
        const chatId = destination.slice('tg:'.length);
        if (!/^-?\d+$/.test(chatId)) return { error: `"${destination}" is not a numeric Telegram chat id (use "tg:<chat_id>")` };
        let sent = await sendMessage(chatId, text, options);
        if (!sent.success && parse_mode) {
          aiLogger.warn({ destination, error: sent.error }, 'Telegram: Markdown failed, retrying plain');
          sent = await sendMessage(chatId, text, {});
        }
        if (!sent.success) return { error: sent.error || 'Failed to send private message' };
        return { success: true, message_id: sent.messageId, destination, text_length: text.length };
      }

      let result;

      if (destination === 'channel') {
        // Post to @godcrm channel (RU)
        result = await sendChannelPost(text, options);
      } else if (destination === 'channel_en') {
        // Post to @god_crm channel (EN)
        result = await sendChannelPostEN(text, options);
      } else if (destination === 'group') {
        // Post to group general topic
        result = await sendGroupMessage(text, options);
      } else {
        // Treat as a topic key
        const topics = getTopicMap();
        if (!topics[destination]) {
          const available = Object.keys(topics).join(', ');
          return { error: `Unknown topic "${destination}". Available: ${available}` };
        }
        result = await sendToTopic(destination, text, options);
      }

      if (!result.success) {
        // Retry without parse_mode if Markdown fails
        if (result.error && parse_mode) {
          aiLogger.warn({ destination, error: result.error }, 'Telegram: Markdown failed, retrying plain');
          result = destination === 'channel'
            ? await sendChannelPost(text, {})
            : destination === 'channel_en'
              ? await sendChannelPostEN(text, {})
              : destination === 'group'
                ? await sendGroupMessage(text, {})
                : await sendToTopic(destination, text, {});
        }
        if (!result.success) {
          return { error: result.error || 'Failed to send message' };
        }
      }

      return {
        success: true,
        message_id: result.messageId,
        destination,
        text_length: text.length
      };
    } catch (err) {
      aiLogger.error({ err, destination }, 'Telegram send_telegram_message error');
      return { error: err.message };
    }
  }
};
