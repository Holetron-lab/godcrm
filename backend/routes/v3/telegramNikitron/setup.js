// backend/routes/v3/telegramNikitron/setup.js
// GET /setup — register webhook with Telegram
// GET /info — bot status and session info

import { apiLogger } from '../../../utils/logger.js';
import { getBotToken, getTgApi, AUTHORIZED_CHAT_IDS, activeSessions } from './config.js';

export default function registerSetupRoutes(router) {
  // ===== SETUP: Register webhook with Telegram =====

  router.get('/setup', async (req, res) => {
    try {
      const botToken = await getBotToken();
      const tgApi = await getTgApi();
      if (!botToken) {
        return res.status(400).json({ success: false, error: 'NIKITRON_BOT_TOKEN not configured' });
      }

      // Get bot info
      const meResponse = await fetch(`${tgApi}/getMe`);
      const meData = await meResponse.json();
      if (!meData.ok) {
        return res.status(500).json({ success: false, error: 'Invalid bot token', details: meData.description });
      }

      const baseUrl = process.env.PUBLIC_URL || 'https://devcrm.hltrn.cc';
      const webhookUrl = `${baseUrl}/api/v3/telegram/nikitron/webhook`;

      const whResponse = await fetch(`${tgApi}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl, allowed_updates: ['message'] }),
      });
      const whData = await whResponse.json();

      res.json({
        success: whData.ok,
        bot: meData.result.username,
        webhook_url: webhookUrl,
        details: whData,
      });
    } catch (err) {
      apiLogger.error({ err }, '[NikitronBot] Setup error');
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ===== INFO: Bot status =====

  router.get('/info', async (req, res) => {
    try {
      const botToken = await getBotToken();
      const tgApi = await getTgApi();
      if (!botToken) {
        return res.json({ success: false, error: 'NIKITRON_BOT_TOKEN not configured', enabled: false });
      }

      const meResponse = await fetch(`${tgApi}/getMe`);
      const meData = await meResponse.json();

      const whResponse = await fetch(`${tgApi}/getWebhookInfo`);
      const whData = await whResponse.json();

      const sessions = [];
      for (const [chatId, session] of activeSessions.entries()) {
        sessions.push({ chatId, ...session });
      }

      res.json({
        success: true,
        enabled: true,
        bot: meData.ok ? meData.result : null,
        webhook: whData.ok ? whData.result : null,
        active_sessions: sessions,
        authorized_chat_ids: AUTHORIZED_CHAT_IDS,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
}
