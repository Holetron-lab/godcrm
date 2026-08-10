// backend/routes/v3/telegram/setup.js
// GET /setup — Set up the webhook
// GET /info — Get bot info, webhook status, and active sessions

import { apiLogger } from './shared.js';
import { activeSessions } from './sessions.js';

/**
 * Register setup and info routes on the given router.
 */
export default function registerSetup(router) {
  /**
   * GET /api/v3/telegram/setup
   * Set up the webhook (admin only, requires auth)
   * Call once to register webhook URL with Telegram
   */
  router.get('/setup', async (req, res) => {
    try {
      const { setWebhook, getBotInfo } = await import('../../../services/TelegramService.js');

      const botInfo = await getBotInfo();
      if (!botInfo.success) {
        return res.status(500).json({ success: false, error: 'Failed to connect to Telegram bot', details: botInfo.error });
      }

      const baseUrl = process.env.PUBLIC_URL || 'https://devcrm.hltrn.cc';
      const webhookUrl = `${baseUrl}/api/v3/telegram/webhook`;

      const result = await setWebhook(webhookUrl);

      res.json({
        success: result.success,
        bot: botInfo.username,
        webhook_url: webhookUrl,
        details: result
      });
    } catch (err) {
      apiLogger.error({ err }, '[Telegram] Setup error');
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/v3/telegram/info
   * Get bot info, webhook status, and active sessions
   */
  router.get('/info', async (req, res) => {
    try {
      const { getBotInfo, getTgApi } = await import('../../../services/TelegramService.js');

      const botInfo = await getBotInfo();

      const whResponse = await fetch(`${await getTgApi()}/getWebhookInfo`);
      const whData = await whResponse.json();

      // Include active session info
      const sessions = [];
      for (const [chatId, session] of activeSessions.entries()) {
        sessions.push({ chatId, ...session });
      }

      res.json({
        success: true,
        bot: botInfo,
        webhook: whData.result,
        active_sessions: sessions,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
}
